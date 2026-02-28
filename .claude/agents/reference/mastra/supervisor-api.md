# Mastra Supervisor Agent API Reference

## Creating a Supervisor

A supervisor coordinates multiple sub-agents. It decides which agent to delegate to based on instructions and agent descriptions.

```typescript
const researchAgent = new Agent({
  id: "research-agent",
  description: "Gathers factual information and returns bullet-point summaries.",
  model: google("gemini-2.5-flash"),
  tools: { searchDocuments },
})

const writingAgent = new Agent({
  id: "writing-agent",
  description: "Writes polished text from bullet points and raw data.",
  model: google("gemini-2.5-flash"),
})

const supervisor = new Agent({
  id: "supervisor",
  instructions: "Coordinate research and writing. First delegate research, then writing.",
  model: google("gemini-2.5-flash"),
  agents: { researchAgent, writingAgent },  // sub-agents
  memory: supervisorMemory,
})
```

## Delegation Hooks

### onDelegationStart

Control delegation BEFORE it happens:

```typescript
const stream = await supervisor.stream(input, {
  maxSteps: 10,
  onDelegationStart: ({ primitiveId, prompt, iteration }) => {
    // primitiveId: which agent is being delegated to
    // prompt: what the supervisor is sending
    // iteration: which iteration of the loop

    // Approve delegation
    return { proceed: true }

    // Reject delegation
    return { proceed: false, reason: "Not appropriate for this agent" }

    // Modify the prompt
    return { proceed: true, modifiedPrompt: "Focus on X instead of Y" }

    // Limit iterations
    return { proceed: true, modifiedMaxSteps: 3 }
  },
})
```

### onDelegationComplete

Process results AFTER delegation:

```typescript
onDelegationComplete: ({ primitiveId, result, error, bail }) => {
  // Check for errors
  if (error) {
    bail()  // Stop the supervisor loop immediately
    return
  }

  // Provide feedback (added to conversation context)
  return { feedback: "Good research, but missing financial data" }
}
```

### messageFilter

Control what conversation history sub-agents see:

```typescript
messageFilter: ({ messages, primitiveId, prompt }) => {
  // Remove sensitive data
  const filtered = messages.filter(msg => !msg.content.includes("confidential"))

  // Limit context size
  return filtered.slice(-10)  // only last 10 messages
}
```

## Iteration Control

### onIterationComplete

Monitor and control the supervisor loop:

```typescript
onIterationComplete: ({ iteration, maxIterations, finishReason, text }) => {
  // Continue iterating
  return { continue: true }

  // Stop after 3 iterations
  if (iteration >= 3) return { continue: false }

  // Provide feedback for next iteration
  return { continue: true, feedback: "Need more detail on X" }
}
```

### Task Completion Scoring

Validate completion with scorers:

```typescript
const stream = await supervisor.stream("Complete this task", {
  isTaskComplete: {
    scorers: [taskCompleteScorer],
    strategy: "all",  // all scorers must pass
    onComplete: async (result) => {
      console.log("Task verified complete:", result)
    },
  },
})
```

## Memory Isolation

- Supervisor has its OWN memory (thread/resource)
- Each delegation creates a UNIQUE thread ID for the sub-agent
- Only the delegation prompt and response are saved to sub-agent memory
- Full supervisor conversation context is visible to sub-agents for decision-making

## Tool Approval Propagation

When a sub-agent calls a tool with `requireApproval: true`, the approval request surfaces to the supervisor level.

## When to Use Supervisor vs Simpler Patterns

**Use supervisor when**:
- Multiple experts need to iterate with feedback loops
- The task requires monitoring and course-correction
- Sub-agent results need validation before proceeding

**DON'T use supervisor when**:
- Tasks are sequential with clear handoffs (use pipeline)
- Tasks are independent (use parallel execution)
- One agent can handle it (use single agent)

**Rule**: Start with the simplest pattern. Escalate to supervisor only when you need iteration control, delegation hooks, or task completion scoring.
