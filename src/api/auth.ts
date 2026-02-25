import { Hono } from "hono";
import { z } from "zod";
import { db } from "../db/client.js";
import { users } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { issueToken, requireRole, type TokenPayload } from "./middleware/auth.js";
import { createHash } from "crypto";

const auth = new Hono();

// ── Helpers ────────────────────────────────────────────────────────────────────

function hashPassword(password: string): string {
  // SHA-256 with a server-side salt (JWT_SECRET). Simple, no external deps.
  const salt = process.env["JWT_SECRET"] ?? "default-salt";
  return createHash("sha256").update(`${salt}:${password}`).digest("hex");
}

// ── Routes ─────────────────────────────────────────────────────────────────────

/**
 * POST /auth/register
 * Creates a new user. Requires admin Bearer token (except first user).
 * Body: { username, password, orgId?, role? }
 */
auth.post("/register", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = z.object({
    username: z.string().min(3).max(50),
    password: z.string().min(8),
    orgId: z.string().optional(),
    role: z.enum(["admin", "user"]).default("user"),
  }).safeParse(body);

  if (!parsed.success) {
    return c.json({ error: parsed.error.message }, 400);
  }

  // Only the first user can register without auth; subsequent users require admin
  const [existingCount] = await db.select({ count: users.id }).from(users).limit(1);
  const isFirstUser = !existingCount?.count;

  if (!isFirstUser) {
    const caller = c.get("user") as TokenPayload | undefined;
    if (!caller || caller.role !== "admin") {
      return c.json({ error: "Forbidden", message: "Only admins can create users" }, 403);
    }
  }

  const { username, password, orgId, role } = parsed.data;

  // Check duplicate username
  const existing = await db.query.users.findFirst({ where: eq(users.email, username) });
  if (existing) {
    return c.json({ error: "Conflict", message: "Username already taken" }, 409);
  }

  const [user] = await db
    .insert(users)
    .values({
      email: username,
      orgId: orgId ?? username,
      metadata: { passwordHash: hashPassword(password), role },
    })
    .returning({ id: users.id, email: users.email, orgId: users.orgId });

  const token = issueToken({
    userId: user!.id,
    username: user!.email!,
    orgId: user!.orgId!,
    role: isFirstUser ? "admin" : role,
  });

  return c.json({ token, user: { id: user!.id, username, orgId: user!.orgId, role } }, 201);
});

/**
 * POST /auth/login
 * Body: { username, password } → returns JWT
 */
auth.post("/login", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = z.object({
    username: z.string(),
    password: z.string(),
  }).safeParse(body);

  if (!parsed.success) {
    return c.json({ error: "Bad Request" }, 400);
  }

  const { username, password } = parsed.data;

  const user = await db.query.users.findFirst({ where: eq(users.email, username) });
  if (!user) {
    return c.json({ error: "Unauthorized", message: "Invalid credentials" }, 401);
  }

  const meta = user.metadata as { passwordHash?: string; role?: string } | null;
  if (!meta?.passwordHash || meta.passwordHash !== hashPassword(password)) {
    return c.json({ error: "Unauthorized", message: "Invalid credentials" }, 401);
  }

  const role = (meta.role ?? "user") as "admin" | "user";
  const token = issueToken({
    userId: user.id,
    username: user.email!,
    orgId: user.orgId!,
    role,
  });

  return c.json({ token, user: { id: user.id, username, orgId: user.orgId, role } });
});

/**
 * GET /auth/me
 * Returns current user info from the Bearer token.
 */
auth.get("/me", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  return c.json({ userId: user.userId, username: user.username, orgId: user.orgId, role: user.role });
});

export default auth;
