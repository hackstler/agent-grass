import type { ModelMessage } from "ai";
import type { ConversationManager } from "../application/managers/conversation.manager.js";
import type { ToolCallSummary, Message } from "../domain/entities/index.js";
import { ragConfig } from "../plugins/rag/config/rag.config.js";

/**
 * Session gap threshold: if more than 2 hours pass between messages,
 * they belong to different sessions.
 */
const SESSION_GAP_MS = 2 * 60 * 60 * 1000; // 2 hours

/** Max number of old sessions to include as compacted summaries. */
const MAX_OLD_SESSIONS = 2;

/** Max chars of user message content to include in compacted summaries. */
const USER_MSG_TRUNCATE = 60;

/**
 * Trivial messages (greetings, thanks, etc.) that don't need any old session context.
 * If the current prompt matches, skip loading old sessions entirely.
 */
const TRIVIAL_PATTERN = /^(hol[ai]?|hey|buenas?|buenos?\s*d[ií]as?|qu[eé]\s*tal|gracias|thank|adi[oó]s|hasta\s*luego|ok|vale|sí|si|no|dale|claro)\b/i;

/** A message with the fields we need from the DB. */
type HistoryMessage = Pick<Message, "id" | "role" | "content" | "metadata" | "createdAt">;

/**
 * A group of messages that belong to the same interaction session.
 */
interface Session {
  messages: HistoryMessage[];
  startedAt: Date;
}

/**
 * Options for history loading. The `enrichWithTools` flag controls whether
 * `[Herramientas: ...]` prefixes are added to assistant messages.
 *
 * - **Coordinator** (default `true`): needs to know which agents already
 *   handled what across turns to avoid duplicate routing.
 * - **Sub-agents** (must pass `false`): the prefix causes deterministic
 *   re-invocation skipping. When the sub-agent sees `[Herramientas:
 *   calculateBudget]` in past assistant messages, the LLM concludes
 *   "ya lo hice" and refuses to invoke the tool again, hallucinating a
 *   text response instead. Sub-agents must always re-evaluate fresh.
 */
export interface LoadHistoryOptions {
  windowSize?: number;
  enrichWithTools?: boolean;
}

/**
 * Load conversation history with session-aware compaction.
 *
 * Strategy (inspired by Claude Code's context management):
 *
 * 1. Split all messages into "sessions" based on time gaps (>2h = new session)
 * 2. **Current session** (the most recent): load messages in FULL
 * 3. **Previous sessions**: compact into a SINGLE brief context line
 *    - NO tool summaries (they cause re-execution contamination)
 *    - Only a high-level topic hint per session
 *    - Max 2 previous sessions
 * 4. **Trivial messages** (greetings): skip old sessions entirely
 *
 * Default window size comes from ragConfig.windowSize (currently 10).
 */
export async function loadConversationHistory(
  convManager: ConversationManager,
  conversationId: string,
  windowSizeOrOptions: number | LoadHistoryOptions = ragConfig.windowSize,
): Promise<ModelMessage[]> {
  // Backward-compatible: accept either a number (windowSize) or an options object
  const opts: LoadHistoryOptions =
    typeof windowSizeOrOptions === "number"
      ? { windowSize: windowSizeOrOptions, enrichWithTools: true }
      : { enrichWithTools: true, ...windowSizeOrOptions };
  const windowSize = opts.windowSize ?? ragConfig.windowSize;
  const enrichTools = opts.enrichWithTools ?? true;

  try {
    const conv = await convManager.getById(conversationId);
    const allMessages = conv.messages ?? [];

    if (allMessages.length === 0) return [];

    // Split messages into sessions based on time gaps
    const sessions = splitIntoSessions(allMessages);

    if (sessions.length <= 1) {
      // Single session — no compaction needed, use the simple path
      const recent = allMessages.slice(-windowSize);
      return recent.map((m) => ({
        role: m.role as "user" | "assistant" | "system",
        content: enrichTools
          ? enrichWithToolContext(m.role, m.content, m.metadata?.toolCalls)
          : m.content,
      }));
    }

    // Multiple sessions — compact old ones, keep current one full
    const currentSession = sessions[sessions.length - 1]!;

    // Check if current message is trivial (greeting/thanks) — skip old context entirely
    const lastUserMsg = [...currentSession.messages].reverse().find((m) => m.role === "user");
    const isTrivial = lastUserMsg && TRIVIAL_PATTERN.test(lastUserMsg.content.trim());

    const result: ModelMessage[] = [];

    // 1. Include old sessions ONLY if the current message is non-trivial
    if (!isTrivial) {
      const oldSessions = sessions.slice(0, -1).slice(-MAX_OLD_SESSIONS);
      const oldSummaries = oldSessions
        .map((s) => compactSession(s))
        .filter(Boolean);

      if (oldSummaries.length > 0) {
        result.push({
          role: "system" as const,
          content: `== CONTEXTO DE SESIONES ANTERIORES (solo referencia, NO re-ejecutar) ==\n${oldSummaries.join("\n")}`,
        });
      }
    }

    // 2. Add session boundary marker
    result.push({
      role: "system" as const,
      content: `--- SESIÓN ACTUAL — responde SOLO al último mensaje del usuario. NO repitas acciones de sesiones anteriores. ---`,
    });

    // 3. Load current session messages in full (capped by windowSize)
    const currentMessages = currentSession.messages.slice(-windowSize);
    for (const m of currentMessages) {
      result.push({
        role: m.role as "user" | "assistant" | "system",
        content: enrichTools
          ? enrichWithToolContext(m.role, m.content, m.metadata?.toolCalls)
          : m.content,
      });
    }

    return result;
  } catch {
    // Conversation may not exist yet
    return [];
  }
}

/**
 * Split a chronologically ordered array of messages into sessions.
 * A new session starts when there's a gap of >SESSION_GAP_MS between messages.
 */
function splitIntoSessions(messages: HistoryMessage[]): Session[] {
  if (messages.length === 0) return [];

  const sessions: Session[] = [];
  let current: Session = {
    messages: [messages[0]!],
    startedAt: messages[0]!.createdAt,
  };

  for (let i = 1; i < messages.length; i++) {
    const m = messages[i]!;
    const prev = messages[i - 1]!;

    const gap = m.createdAt.getTime() - prev.createdAt.getTime();

    if (gap > SESSION_GAP_MS) {
      sessions.push(current);
      current = { messages: [m], startedAt: m.createdAt };
    } else {
      current.messages.push(m);
    }
  }

  sessions.push(current);
  return sessions;
}

/**
 * Compact an old session into a single-line topic summary.
 *
 * CRITICAL: Do NOT include tool action summaries (like "Nota guardada", "Presupuesto generado").
 * Including them causes the LLM to re-execute those actions in the current session.
 *
 * Instead, extract only the TOPICS discussed from user messages.
 *
 * Format: "25 mar: traviesas, presupuesto Carlos Ruiz, enlace YouTube"
 */
function compactSession(session: Session): string | null {
  const userTopics: string[] = [];

  for (const m of session.messages) {
    if (m.role === "user") {
      const truncated = m.content.length > USER_MSG_TRUNCATE
        ? m.content.slice(0, USER_MSG_TRUNCATE).trim() + "…"
        : m.content.trim();
      userTopics.push(truncated);
    }
  }

  if (userTopics.length === 0) return null;

  const date = session.startedAt.toLocaleDateString("es-ES", {
    day: "numeric",
    month: "short",
    timeZone: "Europe/Madrid",
  });

  return `- ${date}: ${userTopics.join(" | ")}`;
}

/**
 * For assistant messages that used tools, prepend a brief summary so the LLM
 * has continuity across turns without re-calling the same tools.
 */
function enrichWithToolContext(
  role: string,
  content: string,
  toolCalls?: ToolCallSummary[],
): string {
  if (role !== "assistant" || !toolCalls?.length) return content;

  const summary = toolCalls.map((tc) => tc.summary).join("; ");
  return `[Herramientas: ${summary}]\n${content}`;
}
