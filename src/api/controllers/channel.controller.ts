import { Hono } from "hono";
import { z } from "zod";
import type { WhatsAppManager } from "../../application/managers/whatsapp.manager.js";

const enableSchema = z.object({
  linkingMethod: z.enum(["qr", "code"]).optional(),
  phoneNumber: z.string().optional(),
}).refine(
  (data) => data.linkingMethod !== "code" || !!data.phoneNumber,
  { message: "phoneNumber is required when linkingMethod is 'code'", path: ["phoneNumber"] },
);

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

  router.get("/whatsapp/pairing-code", async (c) => {
    const user = c.get("user");
    if (!user?.userId) return c.json({ error: "Missing userId" }, 400);
    const data = await manager.getPairingCodeForUser(user.userId);
    return c.json({ data });
  });

  router.post("/whatsapp/enable", async (c) => {
    const user = c.get("user");
    if (!user?.userId || !user?.orgId) return c.json({ error: "Missing userId or orgId" }, 400);

    const body = await c.req.json().catch(() => ({}));
    const parsed = enableSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: "Validation", message: parsed.error.message }, 400);

    const session = await manager.enableForUser(
      user.userId,
      user.orgId,
      parsed.data.linkingMethod,
      parsed.data.phoneNumber,
    );
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
