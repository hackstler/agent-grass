import { Hono } from "hono";
import type { QuoteRepository } from "../../domain/ports/repositories/quote.repository.js";

export function createQuoteController(quoteRepo: QuoteRepository): Hono {
  const router = new Hono();

  // GET / — list quotes for the authenticated user (WITHOUT pdfBase64, only metadata)
  router.get("/", async (c) => {
    const userId = c.get("user")?.userId;
    if (!userId) return c.json({ error: "Unauthorized", message: "No userId in token" }, 401);

    const rows = await quoteRepo.findByUser(userId);

    // Strip pdfBase64 from the listing response — it can be large
    const items = rows.map(({ pdfBase64: _, ...rest }) => rest);

    return c.json({ items, total: items.length });
  });

  // GET /:id/pdf — returns { pdfBase64, filename } for download
  router.get("/:id/pdf", async (c) => {
    const orgId = c.get("user")?.orgId;
    if (!orgId) return c.json({ error: "Unauthorized", message: "No orgId in token" }, 401);

    const id = c.req.param("id");
    const quote = await quoteRepo.findById(id, orgId);

    if (!quote) {
      return c.json({ error: "NotFound", message: "Quote not found" }, 404);
    }

    if (!quote.pdfBase64) {
      return c.json({ error: "NotFound", message: "PDF not available for this quote" }, 404);
    }

    return c.json({ data: { pdfBase64: quote.pdfBase64, filename: quote.filename } });
  });

  return router;
}
