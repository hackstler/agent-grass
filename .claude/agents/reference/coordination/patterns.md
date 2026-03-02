# Multi-Agent Coordination Patterns

## Pattern 1: Single Agent (DEFAULT — 80% of tasks)

```
Request → Identify domain → Delegate to ONE expert → Result
```

**When**: The task clearly falls within one agent's expertise.
**Rule**: If you can describe the task in one sentence and it maps to one domain, use one agent.

**Examples**:
- "Add a new tool for calendar integration" → `mastra-expert`
- "The retrieval scores are too low" → `rag-specialist`
- "Refactor the auth middleware" → `typescript-architect`
- "Deploy to Railway" → `infra-specialist`

**Anti-pattern**: Using 3 agents for "add a new tool" (design → implement → verify). One mastra-expert handles all of it.

## Pattern 2: Sequential Pipeline

```
Request → Agent A (step 1) → Agent B (step 2) → Agent C (step 3) → Result
```

Each agent's output is the next agent's input. Steps have clear dependencies.

**When**: Multi-phase tasks where each phase requires different expertise.
**Rule**: Each step must produce a clear artifact that the next step consumes.

**Examples**:
- "Create a new ingestion loader for CSV files":
  1. `typescript-architect`: Design module structure, interfaces
  2. `mastra-expert`: Implement the tool with createTool, add to registry
  3. `rag-specialist`: Verify chunking quality, recommend strategy

- "Add a new communication channel (Telegram)":
  1. `typescript-architect`: Design the router, schema, ports
  2. `infra-specialist`: Docker, env vars, deployment config
  3. Test and verify

**Handoff format**: Each agent produces a summary for the next:
```
[Agent A output] → "Designed interface ILoader with methods load(), validate(). File: src/ingestion/loaders/csv.ts. Schema: see attached."
[Agent B input] → Takes the design and implements it
```

## Pattern 3: Parallel Fan-out / Fan-in

```
Request → Split into sub-tasks → [Agent A, Agent B, Agent C] (parallel) → Merge results
```

**When**: Independent sub-tasks that don't depend on each other.
**Rule**: Sub-tasks MUST be independent. If B needs A's output, use sequential instead.

**Examples**:
- "Audit the project for production readiness":
  - `typescript-architect`: Code quality, architecture audit
  - `rag-specialist`: Retrieval quality, benchmark results
  - `infra-specialist`: Deployment config, health checks, security

- "Prepare for a new client":
  - `rag-specialist`: Tune retrieval for client's content type
  - `infra-specialist`: Set up Railway env vars, DB
  - Both run simultaneously

**Merge strategy**: Coordinator combines results into a unified report.

## Pattern 4: Router

```
Request → Classify request type → Route to appropriate agent
```

**When**: The domain isn't obvious from the request, or requests vary widely.
**Rule**: Classification should be simple (keywords, file paths, error types).

**Classification heuristics**:
- Error message with SQL/DB → `infra-specialist`
- Error message with Mastra/agent → `mastra-expert`
- "refactor", "design", "architecture" → `typescript-architect`
- "retrieval", "chunks", "embedding", "score" → `rag-specialist`
- "deploy", "Docker", "Railway", "production" → `infra-specialist`
- File path mentions `src/rag/` → `rag-specialist`
- File path mentions `src/agent/` → `mastra-expert`
- File path mentions `Dockerfile` or `docker-compose` → `infra-specialist`

## Pattern 5: Supervisor (RARE)

```
Supervisor → Delegates to Agent A → Reviews result → Delegates to Agent B → Reviews → Done
```

**When**: Complex cross-cutting tasks that require iteration and course-correction.
**Rule**: Only use when simpler patterns fail. Most tasks don't need this.

**Examples** (the few legitimate uses):
- "Refactor the entire ingestion pipeline for better performance":
  - Needs `typescript-architect` + `rag-specialist` iterating
  - Architecture changes affect retrieval quality
  - Need feedback loops to verify changes don't break RAG

- "Migrate from Gemini to OpenAI embeddings":
  - `rag-specialist` plans the migration
  - `infra-specialist` handles the DB migration
  - `rag-specialist` verifies quality after migration
  - Multiple rounds of adjustment

**Implementation**: See `mastra-supervisor.md` for Mastra-specific details.

## Choosing the Right Pattern

```
Task in one domain?
  YES → Pattern 1 (Single Agent)

Multiple independent sub-tasks?
  YES → Pattern 3 (Parallel)

Steps with clear dependencies?
  YES → Pattern 2 (Sequential)

Domain unclear from request?
  YES → Pattern 4 (Router)

Needs iteration between experts?
  YES → Pattern 5 (Supervisor)
```
