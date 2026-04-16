import { tool } from "ai";
import crypto from "crypto";
import type { CatalogService } from "../services/catalog.service.js";
import type { PdfService, CompanyDetails } from "../services/pdf.service.js";
import type { AttachmentStore } from "../../../domain/ports/attachment-store.js";
import type { OrganizationRepository } from "../../../domain/ports/repositories/organization.repository.js";
import type { QuoteRepository } from "../../../domain/ports/repositories/quote.repository.js";
import type { QuoteStrategyRegistry } from "../strategies/index.js";
import type { QuoteFooterSettings } from "../services/pdf.service.js";
import { quoteConfig } from "../config/quote.config.js";
import { getAgentContextValue } from "../../../application/agent-context.js";
import { logger } from "../../../shared/logger.js";

/**
 * Idempotency window: if the same user re-invokes calculateBudget with
 * IDENTICAL inputs within this window, return the cached quote instead of
 * regenerating. This protects against:
 *   - LLM re-invoking the tool for the same request across turns
 *   - User resending the same WhatsApp message
 *   - Webhook deduplication races
 *
 * Different inputs (any field changed) produce a different hash → fresh quote.
 */
const IDEMPOTENCY_WINDOW_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Build a deterministic hash of the calculateBudget input. Keys are sorted
 * alphabetically and string values are normalized (trim + lowercase) so that
 * "Carlos Ruiz" and "carlos ruiz " produce the same hash. Numbers and booleans
 * are stringified directly.
 */
function buildInputHash(input: Record<string, unknown>): string {
  const sortedKeys = Object.keys(input).sort();
  const normalized: Record<string, unknown> = {};
  for (const key of sortedKeys) {
    const value = input[key];
    if (typeof value === "string") {
      normalized[key] = value.trim().toLowerCase();
    } else if (value === null || value === undefined) {
      // skip — undefined fields shouldn't affect the hash
    } else {
      normalized[key] = value;
    }
  }
  const serialized = JSON.stringify(normalized);
  return crypto.createHash("sha256").update(serialized).digest("hex");
}

export interface CalculateBudgetDeps {
  catalogService: CatalogService;
  pdfService: PdfService;
  attachmentStore: AttachmentStore;
  organizationRepo: OrganizationRepository;
  quoteRepo: QuoteRepository;
  strategyRegistry: QuoteStrategyRegistry;
}

/** Build QuoteFooterSettings from org.quoteSettings, falling back to quoteConfig defaults. */
function resolveQuoteFooter(
  org: { quoteSettings?: import("../../../domain/entities/index.js").QuoteSettings | null } | null,
): QuoteFooterSettings {
  const qs = org?.quoteSettings;
  return {
    paymentTerms: qs?.paymentTerms ?? quoteConfig.paymentTerms,
    quoteValidityDays: qs?.quoteValidityDays ?? quoteConfig.quoteValidityDays,
    companyRegistration: qs?.companyRegistration ?? quoteConfig.companyRegistration,
  };
}

/** Build CompanyDetails from org record, falling back to quoteConfig defaults. */
function resolveCompanyDetails(
  org: { name: string | null; address: string | null; phone: string | null; email: string | null; nif: string | null; logo: string | null; web: string | null; vatRate: string | null; currency: string } | null,
): CompanyDetails {
  return {
    name:     org?.name    ?? quoteConfig.companyName,
    address:  org?.address ?? quoteConfig.companyAddress,
    phone:    org?.phone   ?? quoteConfig.companyPhone,
    email:    org?.email   ?? quoteConfig.companyEmail,
    nif:      org?.nif     ?? quoteConfig.companyNif,
    logo:     org?.logo    ?? null,
    web:      org?.web     ?? "",
    vatRate:  org?.vatRate  ? Number(org.vatRate) : quoteConfig.vatRate,
    currency: org?.currency ?? quoteConfig.currency,
  };
}

export function createCalculateBudgetTool({ catalogService, pdfService, attachmentStore, organizationRepo, quoteRepo, strategyRegistry }: CalculateBudgetDeps) {
  // Default strategy provides the initial schema/description at tool creation time.
  // At runtime, the actual strategy is resolved per-org (local or remote).
  const defaultStrategy = strategyRegistry.getDefault();

  return tool({
    description: defaultStrategy.getToolDescription(),

    inputSchema: defaultStrategy.getInputSchema(),

    execute: async (input, { experimental_context }) => {
      logger.info(
        { inputKeys: Object.keys((input as Record<string, unknown>) ?? {}), inputPreview: JSON.stringify(input).slice(0, 400) },
        "[calculateBudget] execute() ENTRY",
      );

      const orgId = getAgentContextValue({ experimental_context }, "orgId");
      if (!orgId) {
        logger.error("[calculateBudget] EARLY EXIT — missing orgId in context");
        return {
          success: false, clientName: "", rows: [], pdfGenerated: false, filename: "",
          error: "Missing orgId in request context",
        };
      }

      const userId = getAgentContextValue({ experimental_context }, "userId");
      const strategyInput = input as Record<string, unknown>;
      const clientName = (strategyInput["clientName"] as string) ?? "";
      const clientAddress = (strategyInput["clientAddress"] as string) ?? "";
      const province = (strategyInput["province"] as string) ?? "";

      logger.info({ orgId, userId, clientName, clientAddress, hasProvince: !!province }, "[calculateBudget] context resolved");

      // ── Idempotency check: short-circuit if an identical quote was just made.
      // Deterministic short-circuit BEFORE invoking the business function — this
      // is the safety net against the LLM (any sub-agent) re-invoking the tool
      // for the same logical request across turns.
      const inputHash = buildInputHash(strategyInput);
      if (userId) {
        const recent = await quoteRepo.findRecentByUserAndHash(
          userId,
          inputHash,
          IDEMPOTENCY_WINDOW_MS,
        );
        if (recent) {
          logger.info(
            {
              orgId,
              userId,
              inputHash,
              quoteId: recent.id,
              filename: recent.filename,
              ageMs: Date.now() - recent.createdAt.getTime(),
            },
            "[calculateBudget] IDEMPOTENT HIT — returning cached quote, skipping business function",
          );
          // Re-publish the cached PDF to the AttachmentStore in case the cache
          // entry expired. The DB row holds the canonical pdfBase64.
          if (recent.pdfBase64) {
            try {
              await attachmentStore.store({
                orgId,
                userId,
                filename: recent.filename,
                attachment: {
                  base64: recent.pdfBase64,
                  mimetype: "application/pdf",
                  filename: recent.filename,
                },
                docType: "quote",
                sourceId: recent.id,
              });
            } catch (err) {
              logger.warn({ err, filename: recent.filename }, "[calculateBudget] re-store of cached PDF failed");
            }
          }
          // Return the same shape as a fresh result. The LLM cannot tell the
          // difference; the webhook will deliver the cached PDF as usual.
          const cachedRows = Array.isArray((recent.quoteData as { rows?: unknown[] } | null)?.rows)
            ? ((recent.quoteData as { rows: unknown[] }).rows)
            : [];
          return {
            success: true,
            clientName: recent.clientName,
            sectionTitle: undefined,
            notes: undefined,
            rows: cachedRows,
            representativeTotals: {
              subtotal: Number(recent.subtotal),
              vat: Number(recent.vatAmount),
              total: Number(recent.total),
            },
            extraColumns: undefined,
            pdfGenerated: true,
            filename: recent.filename,
            idempotent: true,
          };
        }
      }

      // Fetch org data and catalog in parallel
      const [org, activeCatalog] = await Promise.all([
        organizationRepo.findByOrgId(orgId),
        catalogService.getActiveCatalog(orgId),
      ]);

      logger.info(
        {
          orgId,
          hasOrg: !!org,
          hasBusinessLogicUrl: !!org?.businessLogicUrl,
          hasActiveCatalog: !!activeCatalog,
          catalogId: activeCatalog?.id,
          catalogBusinessType: activeCatalog?.businessType,
        },
        "[calculateBudget] org+catalog loaded",
      );

      if (!activeCatalog) {
        logger.error({ orgId, hasBusinessLogicUrl: !!org?.businessLogicUrl }, "[calculateBudget] EARLY EXIT — no active catalog");
        return {
          success: false, clientName, rows: [], pdfGenerated: false, filename: "",
          error: "No active catalog found for this organization",
        };
      }

      // Resolve strategy: remote (if org has businessLogicUrl) or local (by catalog businessType)
      const activeStrategy = await strategyRegistry.resolveForOrg(org, activeCatalog.businessType);
      const company = resolveCompanyDetails(org);
      const footer = resolveQuoteFooter(org);

      logger.info(
        {
          orgId,
          userId,
          strategy: activeStrategy.businessType,
          isRemote: !!(org?.businessLogicUrl && org.businessLogicApiKey),
          catalogBusinessType: activeCatalog.businessType,
        },
        "[calculateBudget] strategy resolved",
      );

      // Delegate calculation to the strategy — it knows its own input fields
      let result;
      try {
        result = await activeStrategy.calculate({
          input: strategyInput,
          company,
          catalogId: activeCatalog.id,
          catalogService,
          catalogSettings: activeCatalog.settings,
        });
        logger.info(
          {
            orgId,
            rowsCount: result.rows.length,
            firstRow: result.rows[0],
            representativeTotals: result.representativeTotals,
          },
          "[calculateBudget] calculate() returned",
        );
      } catch (err) {
        logger.error({ err, orgId }, "[calculateBudget] calculate() failed");
        return {
          success: false, clientName, rows: [], pdfGenerated: false, filename: "",
          error: err instanceof Error ? err.message : String(err),
        };
      }

      // Generate quote number and filename
      const now = new Date();
      const quoteNumber = `PRES-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}-${Date.now().toString().slice(-4)}`;
      const dateStr = `${now.getDate()}/${now.getMonth() + 1}/${now.getFullYear()}`;
      const filename = `${quoteNumber}.pdf`;

      // Delegate PDF generation to the strategy
      let pdfBase64: string | undefined;
      try {
        pdfBase64 = await activeStrategy.generatePdf({
          quoteNumber,
          date: dateStr,
          company,
          clientName,
          clientAddress,
          province,
          result,
          pdfService,
          footer,
        });
        logger.info(
          {
            orgId,
            userId,
            quoteNumber,
            filename,
            pdfKB: pdfBase64 ? Math.round(pdfBase64.length / 1024) : 0,
          },
          "[calculateBudget] generatePdf() returned",
        );
      } catch (err) {
        logger.error({ err, orgId, quoteNumber }, "[calculateBudget] generatePdf() failed");
        return {
          success: false, clientName, rows: [], pdfGenerated: false, filename: "",
          error: err instanceof Error ? `PDF error: ${err.message}` : String(err),
        };
      }

      // Persist quote to DB FIRST (we need quote.id as sourceId for the attachment)
      let quoteId: string | undefined;
      if (userId && orgId) {
        try {
          const quote = await quoteRepo.create({
            orgId,
            userId,
            quoteNumber,
            clientName,
            clientAddress,
            lineItems: [], // comparison quotes don't use line items
            subtotal: String(result.representativeTotals.subtotal),
            vatAmount: String(result.representativeTotals.vat),
            total: String(result.representativeTotals.total),
            pdfBase64: pdfBase64 ?? null,
            filename,
            quoteData: result.quoteData as Record<string, unknown>,
            inputHash,
            ...result.extraColumns,
          });
          quoteId = quote.id;
          logger.info({ quoteId, quoteNumber, filename }, "[calculateBudget] quote persisted to DB");
        } catch (err) {
          logger.error({ err, quoteNumber }, "[calculateBudget] Failed to persist quote");
        }
      } else {
        logger.warn({ orgId, userId }, "[calculateBudget] skipping quote persist — missing userId/orgId");
      }

      // Store in AttachmentStore (persistent: memory + DB) — critical for WhatsApp delivery
      let attachmentStored = false;
      if (pdfBase64 && userId) {
        try {
          const pdfAttachment = { base64: pdfBase64, mimetype: "application/pdf", filename };
          await attachmentStore.store({
            orgId,
            userId,
            filename,
            attachment: pdfAttachment,
            docType: "quote",
            ...(quoteId ? { sourceId: quoteId } : {}),
          });
          attachmentStored = true;
          logger.info(
            { orgId, userId, filename, quoteId },
            "[calculateBudget] PDF stored in AttachmentStore (cache + DB)",
          );
        } catch (err) {
          logger.error(
            { err, orgId, userId, filename },
            "[calculateBudget] attachmentStore.store failed — PDF will NOT be deliverable via WhatsApp",
          );
        }
      } else {
        logger.warn(
          { hasPdf: !!pdfBase64, userId },
          "[calculateBudget] skipping attachmentStore — no PDF or no userId",
        );
      }

      // Build response — flatten breakdown onto row so the LLM has direct access to
      // strategy-specific fields (pricePerM2, etc.) without nested lookup. This keeps
      // the summary the agent produces detailed enough (e.g. "TESSA25: 3.807,93 €").
      const rows = result.rows.map((r) => ({
        itemName: r.itemName,
        ...r.breakdown,
        subtotal: r.subtotal,
        vat: r.vat,
        total: r.total,
      }));

      logger.info(
        {
          orgId,
          userId,
          success: true,
          pdfGenerated: !!pdfBase64,
          attachmentStored,
          filename,
          rowsCount: rows.length,
        },
        "[calculateBudget] tool returning result",
      );

      return {
        success: true,
        clientName,
        sectionTitle: result.sectionTitle,
        notes: result.notes,
        rows,
        representativeTotals: result.representativeTotals,
        extraColumns: result.extraColumns,
        pdfGenerated: !!pdfBase64,
        filename,
      };
    },
  });
}
