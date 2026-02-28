# Multi-Agent Anti-Patterns

## 1. Over-Orchestration

**Symptom**: 3+ agents involved in a simple task.
**Example**: "Fix a typo in the system prompt" → coordinator delegates to typescript-architect for "code review", then mastra-expert for "prompt expertise", then rag-specialist for "retrieval impact assessment".
**Reality**: One agent (or even no agent — just edit the file) handles this.
**Fix**: Always start with single agent. Ask: "Can one agent handle this entirely?" If yes, STOP.
**Rule of thumb**: If you can describe the task in one sentence, one agent handles it.

## 2. Agent God

**Symptom**: The coordinator/supervisor does 90% of the work, delegates trivially.
**Example**: Coordinator reads all files, analyzes the problem, writes the solution, then "delegates" to mastra-expert to "review" (which just approves).
**Cause**: Bad domain boundaries — the coordinator has too much capability.
**Fix**: Each agent should have clear, non-overlapping expertise. The coordinator ROUTES, it doesn't DO.

## 3. Chatty Agents

**Symptom**: Agents pass full conversation history and all file contents to each other.
**Example**: typescript-architect sends 5000 lines of code analysis to rag-specialist, who only needs "the interface changed from X to Y".
**Cause**: Not summarizing between agents.
**Fix**: Each handoff should be a focused summary: what was done, what the next agent needs to know, what files were changed. Use Mastra's `messageFilter` to trim context.

## 4. Premature Multi-Agent

**Symptom**: "We need 5 specialized agents for this feature!"
**Cause**: Excitement about agent architectures before validating the need.
**Fix**: Build with one agent. Run it for a week. Split ONLY when you see actual limitations (context overflow, tool conflicts, expertise gaps).
**Quote**: "A single well-prompted agent beats 3 poorly-coordinated agents every time."

## 5. Circular Dependencies

**Symptom**: Agent A delegates to B, which delegates back to A (or through C back to A).
**Example**: typescript-architect asks mastra-expert to verify a type, mastra-expert asks typescript-architect to review the Mastra config.
**Cause**: Unclear responsibility boundaries.
**Fix**: Strict hierarchy. Sub-agents NEVER delegate to other sub-agents. Only the coordinator delegates. If two agents need to interact, the coordinator mediates.

## 6. Context Explosion

**Symptom**: Each agent adds context to the conversation. After 3 agents, context is 50k tokens.
**Example**: Research agent dumps 20 files. Analysis agent adds summaries. Implementation agent adds code. The final context is enormous.
**Cause**: Not pruning intermediate results.
**Fix**: Each agent returns a FOCUSED summary, not all intermediate data. The coordinator decides what to pass forward.

## 7. Conway's Law Trap

**Symptom**: Agent structure mirrors team structure instead of domain structure.
**Example**: "frontend-agent", "backend-agent", "devops-agent" — because that's how the team is organized.
**Cause**: Thinking about WHO does the work instead of WHAT the work IS.
**Fix**: Group by capability domain: architecture, RAG, framework expertise, infrastructure. These don't map to team roles.

## Quick Anti-Pattern Checklist

Before using multi-agent coordination, verify:

- [ ] Have I tried solving this with ONE agent first?
- [ ] Is each agent doing substantial work (not just rubber-stamping)?
- [ ] Are handoffs summarized (not full context dumps)?
- [ ] Is there a clear reason each agent is separate?
- [ ] Are there no circular delegation paths?
- [ ] Would the task be WORSE with fewer agents?

If any checkbox fails, simplify.
