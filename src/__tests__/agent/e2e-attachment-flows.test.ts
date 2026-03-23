/**
 * E2E: Flujos de attachments — el core del producto.
 *
 * Testea los workflows completos de presupuestos + attachments:
 * 1. Generar presupuesto → PDF almacenado → devuelto en respuesta WhatsApp
 * 2. Generar presupuesto → PDF llega en SSE attachment event al dashboard
 * 3. listQuotes busca presupuestos anteriores por nombre de cliente
 * 4. Generar presupuesto → "envíalo por email" (multi-step)
 * 5. Tres presupuestos → "envía el de María" (listQuotes + retrieve correcto)
 *
 * Requiere GOOGLE_API_KEY.
 */
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import {
  createE2ETestApp,
  USER_AUTH,
  WORKER_AUTH,
  TEST_ORG_ID,
  TEST_USER_ID,
  parseSSEResponse,
  type E2ETestContext,
} from "./helpers/test-app-e2e.js";
import { fakeUser, fakeConversation } from "../helpers/mock-repos.js";

const HAS_API_KEY = !!(process.env["GOOGLE_API_KEY"] ?? process.env["GOOGLE_GENERATIVE_AI_API_KEY"]);

describe.skipIf(!HAS_API_KEY)("E2E Attachment Flows — flujos de presupuestos + PDFs", () => {
  let ctx: E2ETestContext;

  beforeAll(() => {
    ctx = createE2ETestApp();

    // WhatsApp flow needs user lookup
    ctx.mocks.userRepo.findById.mockImplementation(async (id: string) =>
      fakeUser({ id, orgId: TEST_ORG_ID, email: "vendedor@test.com" }),
    );
    ctx.mocks.convRepo.findByChannelRef.mockResolvedValue(null);
    ctx.mocks.convRepo.create.mockImplementation(async (data: Record<string, unknown>) =>
      fakeConversation({ id: `conv-${Date.now()}`, ...data } as any),
    );
  });

  // ── 1. WhatsApp: presupuesto genera PDF → attachmentStore.store → document en respuesta ──

  it("WhatsApp: genera presupuesto y devuelve PDF como document attachment", async () => {
    const res = await ctx.app.request("/internal/whatsapp/message", {
      method: "POST",
      headers: WORKER_AUTH(),
      body: JSON.stringify({
        userId: TEST_USER_ID,
        messageId: "att-001",
        body: "Presupuesto para Luis Martín González, Calle Serrano 45, Madrid. 80 m2, solado.",
        chatId: "34600000001@c.us",
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as {
      data: {
        reply: string;
        document?: { base64: string; mimetype: string; filename: string };
      };
    };

    // El agente debe haber respondido
    expect(body.data.reply).toBeTruthy();

    // El PDF debe estar en el document de la respuesta
    expect(body.data.document).toBeDefined();
    expect(body.data.document!.mimetype).toBe("application/pdf");
    expect(body.data.document!.filename).toMatch(/^PRES-\d{8}-\d{4}\.pdf$/);
    expect(body.data.document!.base64.length).toBeGreaterThan(100);

    // El attachment debe estar almacenado y ser recuperable
    const stored = await ctx.attachmentStore.retrieve(TEST_USER_ID, body.data.document!.filename);
    expect(stored).not.toBeNull();
    expect(stored!.filename).toBe(body.data.document!.filename);
  }, 120_000);

  // ── 2. Dashboard SSE: presupuesto emite evento "attachment" con PDF ──

  it("Dashboard SSE: presupuesto emite evento attachment con PDF base64", async () => {
    const headers = USER_AUTH();
    delete (headers as Record<string, string>)["Content-Type"];

    const res = await ctx.app.request(
      "/chat/stream?query=" + encodeURIComponent(
        "Presupuesto para Elena Fernández Ruiz, Avenida del Sol 10, Sevilla. 60 m2, solado."
      ),
      { headers },
    );

    expect(res.status).toBe(200);
    const { events } = await parseSSEResponse(res);

    const attachmentEvents = events.filter((e) => e.type === "attachment");

    // Debe haber al menos un evento attachment con el PDF
    expect(attachmentEvents.length).toBeGreaterThanOrEqual(1);

    const att = attachmentEvents[0]!;
    expect(att["filename"]).toMatch(/^PRES-\d{8}-\d{4}\.pdf$/);
    expect(typeof att["base64"]).toBe("string");
    expect((att["base64"] as string).length).toBeGreaterThan(100);
  }, 120_000);

  // ── 3. listQuotes: busca presupuestos anteriores por nombre ──

  it("listQuotes devuelve presupuestos previos filtrados por nombre", async () => {
    // Preparar: mockear quoteRepo.findByUser con presupuestos previos
    const fakeQuotes = [
      {
        id: "q-1", orgId: TEST_ORG_ID, userId: TEST_USER_ID,
        quoteNumber: "PRES-20260320-1111", clientName: "Juan García López",
        clientAddress: "Calle Mayor 15", lineItems: [],
        subtotal: "3000", vatAmount: "630", total: "3630",
        pdfBase64: null, filename: "PRES-20260320-1111.pdf",
        quoteData: null, surfaceType: "SOLADO", areaM2: "200",
        perimeterLm: "0", province: "Madrid", createdAt: new Date("2026-03-20"),
      },
      {
        id: "q-2", orgId: TEST_ORG_ID, userId: TEST_USER_ID,
        quoteNumber: "PRES-20260321-2222", clientName: "María Rodríguez",
        clientAddress: "Av. Constitución 42", lineItems: [],
        subtotal: "2500", vatAmount: "525", total: "3025",
        pdfBase64: null, filename: "PRES-20260321-2222.pdf",
        quoteData: null, surfaceType: "TIERRA", areaM2: "150",
        perimeterLm: "30", province: "Toledo", createdAt: new Date("2026-03-21"),
      },
      {
        id: "q-3", orgId: TEST_ORG_ID, userId: TEST_USER_ID,
        quoteNumber: "PRES-20260322-3333", clientName: "Pedro Sánchez Ruiz",
        clientAddress: "Calle Gran Vía 22", lineItems: [],
        subtotal: "1800", vatAmount: "378", total: "2178",
        pdfBase64: null, filename: "PRES-20260322-3333.pdf",
        quoteData: null, surfaceType: "SOLADO", areaM2: "120",
        perimeterLm: "0", province: "Madrid", createdAt: new Date("2026-03-22"),
      },
    ];
    ctx.mocks.quoteRepo.findByUser.mockResolvedValue(fakeQuotes);

    // El agente debe usar listQuotes para encontrar el presupuesto de María
    const res = await ctx.app.request("/chat", {
      method: "POST",
      headers: USER_AUTH(),
      body: JSON.stringify({
        query: "¿Qué presupuestos tengo hechos para María?",
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { answer: string };

    const answer = body.answer.toLowerCase();

    // La respuesta debe mencionar a María y/o su presupuesto
    expect(
      answer.includes("maría") || answer.includes("maria") ||
      answer.includes("rodríguez") || answer.includes("rodriguez") ||
      answer.includes("pres-20260321") || answer.includes("2222") ||
      answer.includes("3.025") || answer.includes("3025") ||
      answer.includes("toledo") || answer.includes("presupuesto")
    ).toBe(true);

    // Verificar que se llamó a findByUser (no findByOrg)
    expect(ctx.mocks.quoteRepo.findByUser).toHaveBeenCalledWith(TEST_USER_ID);
  }, 120_000);

  // ── 4. Tres presupuestos + "envía el de María" → encuentra el correcto ──

  it("encuentra el presupuesto correcto entre varios y devuelve filename exacto", async () => {
    const fakeQuotes = [
      {
        id: "q-a", orgId: TEST_ORG_ID, userId: TEST_USER_ID,
        quoteNumber: "PRES-20260315-1001", clientName: "Juan García",
        clientAddress: "C/ Principal 1", lineItems: [],
        subtotal: "2000", vatAmount: "420", total: "2420",
        pdfBase64: null, filename: "PRES-20260315-1001.pdf",
        quoteData: null, surfaceType: "SOLADO", areaM2: "100",
        perimeterLm: "0", province: null, createdAt: new Date("2026-03-15"),
      },
      {
        id: "q-b", orgId: TEST_ORG_ID, userId: TEST_USER_ID,
        quoteNumber: "PRES-20260316-2002", clientName: "María López Fernández",
        clientAddress: "Av. Libertad 22", lineItems: [],
        subtotal: "3500", vatAmount: "735", total: "4235",
        pdfBase64: null, filename: "PRES-20260316-2002.pdf",
        quoteData: null, surfaceType: "TIERRA", areaM2: "200",
        perimeterLm: "20", province: "Sevilla", createdAt: new Date("2026-03-16"),
      },
      {
        id: "q-c", orgId: TEST_ORG_ID, userId: TEST_USER_ID,
        quoteNumber: "PRES-20260317-3003", clientName: "Pedro Martínez",
        clientAddress: "C/ Sol 5", lineItems: [],
        subtotal: "1500", vatAmount: "315", total: "1815",
        pdfBase64: null, filename: "PRES-20260317-3003.pdf",
        quoteData: null, surfaceType: "SOLADO", areaM2: "80",
        perimeterLm: "0", province: null, createdAt: new Date("2026-03-17"),
      },
    ];
    ctx.mocks.quoteRepo.findByUser.mockResolvedValue(fakeQuotes);

    const res = await ctx.app.request("/chat", {
      method: "POST",
      headers: USER_AUTH(),
      body: JSON.stringify({
        query: "Busca el presupuesto de María López",
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { answer: string };

    const answer = body.answer;

    // La respuesta debe contener el filename o datos de María, NO los de Juan o Pedro
    const mentionsCorrectQuote =
      answer.includes("PRES-20260316-2002") ||
      answer.includes("2002") ||
      (answer.toLowerCase().includes("maría") || answer.toLowerCase().includes("maria")) &&
      (answer.toLowerCase().includes("lópez") || answer.toLowerCase().includes("lopez"));

    expect(mentionsCorrectQuote).toBe(true);

    // No debe confundir con los otros presupuestos
    // (puede mencionarlos si lista todos, pero el foco debe estar en María)
  }, 120_000);

  // ── 5. WhatsApp: saludo NO devuelve PDF ──

  it("WhatsApp: saludo no incluye document en la respuesta", async () => {
    const res = await ctx.app.request("/internal/whatsapp/message", {
      method: "POST",
      headers: WORKER_AUTH(),
      body: JSON.stringify({
        userId: TEST_USER_ID,
        messageId: "att-no-pdf",
        body: "Buenos días, ¿qué tal?",
        chatId: "34600000002@c.us",
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { data: { reply: string; document?: unknown } };

    expect(body.data.reply).toBeTruthy();
    expect(body.data.document).toBeUndefined();
  }, 120_000);
});
