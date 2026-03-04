import { vi } from "vitest";
import type { UserRepository } from "../../domain/ports/repositories/user.repository.js";
import type { DocumentRepository } from "../../domain/ports/repositories/document.repository.js";
import type { ConversationRepository } from "../../domain/ports/repositories/conversation.repository.js";
import type { TopicRepository } from "../../domain/ports/repositories/topic.repository.js";
import type { WhatsAppSessionRepository } from "../../domain/ports/repositories/whatsapp-session.repository.js";
import type { User, Conversation, Document, Topic, WhatsappSession } from "../../domain/entities/index.js";

// ── Mock repository factories ────────────────────────────────────────────────

export function createMockUserRepo(): {
  [K in keyof UserRepository]: ReturnType<typeof vi.fn>;
} {
  return {
    findById: vi.fn(),
    findByEmail: vi.fn(),
    findByOrg: vi.fn(),
    findFirstByOrg: vi.fn(),
    findAll: vi.fn(),
    count: vi.fn(),
    countByOrg: vi.fn(),
    create: vi.fn(),
    delete: vi.fn(),
    deleteByOrg: vi.fn(),
  };
}

export function createMockDocumentRepo(): {
  [K in keyof DocumentRepository]: ReturnType<typeof vi.fn>;
} {
  return {
    findById: vi.fn(),
    findByOrg: vi.fn(),
    findBySource: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    deleteByOrg: vi.fn(),
    countByOrg: vi.fn(),
  };
}

export function createMockConversationRepo(): {
  [K in keyof ConversationRepository]: ReturnType<typeof vi.fn>;
} {
  return {
    findById: vi.fn(),
    findByIdWithMessages: vi.fn(),
    findAll: vi.fn(),
    findByTitle: vi.fn(),
    create: vi.fn(),
    delete: vi.fn(),
  };
}

export function createMockTopicRepo(): {
  [K in keyof TopicRepository]: ReturnType<typeof vi.fn>;
} {
  return {
    findById: vi.fn(),
    findByOrg: vi.fn(),
    findByOrgAndId: vi.fn(),
    findDocumentsByTopic: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    deleteByOrg: vi.fn(),
  };
}

export function createMockSessionRepo(): {
  [K in keyof WhatsAppSessionRepository]: ReturnType<typeof vi.fn>;
} {
  return {
    findByUserId: vi.fn(),
    findAllActive: vi.fn(),
    upsertByUserId: vi.fn(),
    updateByUserId: vi.fn(),
    create: vi.fn(),
    deleteByOrgId: vi.fn(),
  };
}

// ── Fake entity factories ────────────────────────────────────────────────────

export function fakeUser(overrides: Partial<User> = {}): User {
  return {
    id: "u-1",
    email: "alice",
    orgId: "org-1",
    role: "user",
    metadata: { passwordHash: "hash" },
    createdAt: new Date("2025-01-01"),
    ...overrides,
  };
}

export function fakeConversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: "c-1",
    userId: "u-1",
    title: "Test conv",
    config: null,
    createdAt: new Date("2025-01-01"),
    updatedAt: new Date("2025-01-01"),
    ...overrides,
  };
}

export function fakeDocument(overrides: Partial<Document> = {}): Document {
  return {
    id: "d-1",
    orgId: "org-1",
    topicId: null,
    title: "Doc 1",
    source: "test.pdf",
    contentType: "pdf",
    status: "indexed",
    chunkCount: 5,
    metadata: null,
    createdAt: new Date("2025-01-01"),
    indexedAt: new Date("2025-01-01"),
    ...overrides,
  };
}

export function fakeTopic(overrides: Partial<Topic> = {}): Topic {
  return {
    id: "t-1",
    orgId: "org-1",
    name: "General",
    description: null,
    createdAt: new Date("2025-01-01"),
    ...overrides,
  };
}

export function fakeSession(overrides: Partial<WhatsappSession> = {}): WhatsappSession {
  return {
    id: "s-1",
    orgId: "org-1",
    userId: "u-1",
    status: "connected",
    qrData: null,
    phone: "+1234567890",
    updatedAt: new Date("2025-01-01"),
    ...overrides,
  };
}
