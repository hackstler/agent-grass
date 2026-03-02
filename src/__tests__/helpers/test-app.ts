import { vi } from "vitest";
import jwt from "jsonwebtoken";

// ── Module mocks (hoisted by vitest before any imports) ─────────────────────

vi.mock("../../infrastructure/db/client.js", () => ({
  db: {},
  checkDbConnection: vi.fn().mockResolvedValue(true),
  ensurePgVector: vi.fn(),
  runMigrations: vi.fn(),
}));

vi.mock("../../api/helpers/persist-messages.js", () => ({
  persistMessages: vi.fn().mockResolvedValue(undefined),
}));

// ── Imports (resolved after mocks) ──────────────────────────────────────────

import { createApp, type AppDependencies } from "../../app.js";
import { UserManager } from "../../application/managers/user.manager.js";
import { DocumentManager } from "../../application/managers/document.manager.js";
import { ConversationManager } from "../../application/managers/conversation.manager.js";
import { WhatsAppManager } from "../../application/managers/whatsapp.manager.js";
import { TopicManager } from "../../application/managers/topic.manager.js";
import { OrganizationManager } from "../../application/managers/organization.manager.js";
import {
  createMockUserRepo,
  createMockDocumentRepo,
  createMockConversationRepo,
  createMockSessionRepo,
  createMockTopicRepo,
} from "./mock-repos.js";

// ── Constants ───────────────────────────────────────────────────────────────

export const TEST_JWT_SECRET = "test-secret-for-jwt";
const PASSWORD_SALT = TEST_JWT_SECRET;

// ── Auth helpers ────────────────────────────────────────────────────────────

export function createAuthHeaders(payload: {
  userId: string;
  username: string;
  orgId: string;
  role: "admin" | "user";
}): Record<string, string> {
  const token = jwt.sign(payload, TEST_JWT_SECRET, { expiresIn: "1h" });
  return { Authorization: `Bearer ${token}` };
}

export function createWorkerHeaders(): Record<string, string> {
  const token = jwt.sign({ role: "worker" }, TEST_JWT_SECRET, { expiresIn: "1h" });
  return { Authorization: `Bearer ${token}` };
}

// ── Test app factory ────────────────────────────────────────────────────────

export interface TestContext {
  app: ReturnType<typeof createApp>;
  repos: {
    user: ReturnType<typeof createMockUserRepo>;
    doc: ReturnType<typeof createMockDocumentRepo>;
    conv: ReturnType<typeof createMockConversationRepo>;
    session: ReturnType<typeof createMockSessionRepo>;
    topic: ReturnType<typeof createMockTopicRepo>;
  };
  managers: {
    user: UserManager;
    doc: DocumentManager;
    conv: ConversationManager;
    wa: WhatsAppManager;
    topic: TopicManager;
    org: OrganizationManager;
  };
  mockAgent: { generate: ReturnType<typeof vi.fn> };
}

export function createTestApp(): TestContext {
  // Set JWT_SECRET so auth middleware works
  process.env["JWT_SECRET"] = TEST_JWT_SECRET;

  const repos = {
    user: createMockUserRepo(),
    doc: createMockDocumentRepo(),
    conv: createMockConversationRepo(),
    session: createMockSessionRepo(),
    topic: createMockTopicRepo(),
  };

  const managers = {
    user: new UserManager(repos.user, PASSWORD_SALT),
    doc: new DocumentManager(repos.doc),
    conv: new ConversationManager(repos.conv),
    wa: new WhatsAppManager(repos.session, repos.user),
    topic: new TopicManager(repos.topic),
    org: new OrganizationManager(repos.user, repos.doc, repos.topic, repos.session, PASSWORD_SALT),
  };

  const mockAgent = {
    generate: vi.fn(),
  };

  const app = createApp({
    userManager: managers.user,
    docManager: managers.doc,
    convManager: managers.conv,
    waManager: managers.wa,
    topicManager: managers.topic,
    orgManager: managers.org,
    coordinatorAgent: mockAgent as unknown as AppDependencies["coordinatorAgent"],
  });

  return { app, repos, managers, mockAgent };
}
