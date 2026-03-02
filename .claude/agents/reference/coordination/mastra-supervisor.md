# Mastra Supervisor Pattern Reference

## When to Use (for Runtime Mastra Agents)

The supervisor pattern applies to RUNTIME agents (Mastra agents that serve end users), NOT to Claude Code sub-agents.

Use when building a Mastra agent that needs to coordinate other Mastra agents:
- Research-and-write workflows
- Multi-stage data processing
- Tasks requiring different LLM expertise per phase

## Creating a Supervisor

```typescript
import { Agent } from "@mastra/core/agent"
import { Memory } from "@mastra/memory"

// Specialized sub-agents
const researchAgent = new Agent({
  id: "research-agent",
  description: "Gathers factual information. Returns bullet-point summaries.",
  model: google("gemini-2.5-flash"),
  tools: { searchDocuments },
})

const writingAgent = new Agent({
  id: "writing-agent",
  description: "Writes polished text from raw data. Follows brand voice.",
  model: google("gemini-2.5-flash"),
})

// Supervisor
const supervisor = new Agent({
  id: "supervisor",
  instructions: `You coordinate research and writing.
    1. Delegate research questions to research-agent
    2. Review research results
    3. Delegate writing to writing-agent
    4. Verify final output quality`,
  model: google("gemini-2.5-flash"),
  agents: { researchAgent, writingAgent },
  memory: supervisorMemory,
})
```

## Delegation Hooks

### onDelegationStart — Control BEFORE delegation

```typescript
const result = await supervisor.stream(input, {
  maxSteps: 10,

  onDelegationStart: ({ primitiveId, prompt, iteration }) => {
    // Log which agent is being called
    console.log(`Delegating to ${primitiveId}, iteration ${iteration}`)

    // Approve
    return { proceed: true }

    // Reject with reason (agent sees the reason)
    return { proceed: false, reason: "Use search-agent for data queries" }

    // Modify the prompt
    return { proceed: true, modifiedPrompt: `${prompt}\nFocus on Spanish content.` }

    // Limit iterations for this delegation
    return { proceed: true, modifiedMaxSteps: 3 }
  },
})
```

### onDelegationComplete — Process AFTER delegation

```typescript
onDelegationComplete: ({ primitiveId, result, error, bail }) => {
  // Handle errors
  if (error) {
    console.error(`${primitiveId} failed:`, error)
    bail()  // Stop the entire supervisor loop
    return
  }

  // Provide feedback (added to conversation for next iteration)
  if (primitiveId === "research-agent") {
    return { feedback: "Good data. Now delegate to writing-agent." }
  }

  // No feedback needed
  return {}
}
```

### messageFilter — Control context visibility

```typescript
messageFilter: ({ messages, primitiveId, prompt }) => {
  // Research agent only sees last 5 messages
  if (primitiveId === "research-agent") {
    return messages.slice(-5)
  }

  // Writing agent doesn't see raw research data
  if (primitiveId === "writing-agent") {
    return messages.filter(m => !m.content.includes("[RAW DATA]"))
  }

  return messages
}
```

## Iteration Control

```typescript
onIterationComplete: ({ iteration, maxIterations, finishReason, text }) => {
  // Stop after 3 iterations max
  if (iteration >= 3) return { continue: false }

  // Continue with guidance
  return {
    continue: true,
    feedback: "Check if the writing agent has been called yet."
  }
}
```

## Memory Isolation

Key principle: sub-agents see the supervisor's conversation context but have their OWN memory:

- Supervisor conversation → visible to sub-agents for decision-making
- Each delegation → creates a UNIQUE thread ID for the sub-agent
- Only the delegation prompt + response → saved to sub-agent's memory
- Sub-agent's internal tool calls → NOT visible to supervisor

This prevents context explosion while maintaining coherence.

## Task Completion Scoring

```typescript
const result = await supervisor.stream("Write an article about RAG", {
  isTaskComplete: {
    scorers: [
      {
        score: async (result) => {
          // Check if article has required sections
          const hasIntro = result.text.includes("Introduction")
          const hasConclusion = result.text.includes("Conclusion")
          return hasIntro && hasConclusion ? 1 : 0
        },
      },
    ],
    strategy: "all",  // all scorers must pass
    onComplete: async (result) => {
      console.log("Article verified complete")
    },
  },
})
```

Failed scorer feedback appears in conversation context, guiding the next iteration.

## Practical Example: RAG Quality Audit Supervisor

```typescript
const ragAuditor = new Agent({
  id: "rag-auditor",
  instructions: `Audit RAG pipeline quality:
    1. Delegate test queries to query-agent
    2. Analyze retrieval scores
    3. If scores < 0.7, delegate parameter tuning to tuner-agent
    4. Re-run queries to verify improvement`,
  agents: { queryAgent, tunerAgent },
  memory: auditMemory,
})
```

## Difference: Mastra Supervisor vs Claude Code Coordinator

| Aspect | Mastra Supervisor | Claude Code agent-coordinator |
|--------|------------------|-------------------------------|
| Runtime | Production (serves users) | Development (assists developers) |
| Defined in | `src/agent/*.ts` | `.claude/agents/*.md` |
| Sub-agents | Other Mastra agents | Other Claude Code sub-agents |
| Memory | PostgresStore threads | `.claude/agent-memory/` files |
| Hooks | onDelegationStart/Complete | N/A (Claude Code manages) |
| Use case | User-facing workflows | Developer workflow coordination |
