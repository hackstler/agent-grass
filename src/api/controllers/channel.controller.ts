import { Hono } from "hono";
import type { WhatsAppManager } from "../../application/managers/whatsapp.manager.js";

export function createChannelController(manager: WhatsAppManager): Hono {
  const router = new Hono();

  router.get("/whatsapp/status", async (c) => {
    const user = c.get("user");
    if (!user?.userId) return c.json({ error: "Missing userId" }, 400);
    const data = await manager.getStatusForUser(user.userId);
    return c.json({ data });
  });

  router.get("/whatsapp/qr", async (c) => {
    const user = c.get("user");
    if (!user?.userId) return c.json({ error: "Missing userId" }, 400);
    const data = await manager.getQrForUser(user.userId);
    return c.json({ data });
  });

  router.post("/whatsapp/enable", async (c) => {
    const user = c.get("user");
    if (!user?.userId || !user?.orgId) return c.json({ error: "Missing userId or orgId" }, 400);
    const session = await manager.enableForUser(user.userId, user.orgId);
    return c.json({ data: session }, 201);
  });

  router.post("/whatsapp/disconnect", async (c) => {
    const user = c.get("user");
    if (!user?.userId) return c.json({ error: "Missing userId" }, 400);
    await manager.disconnectForUser(user.userId);
    return c.json({ data: { ok: true } });
  });

  return router;
}
