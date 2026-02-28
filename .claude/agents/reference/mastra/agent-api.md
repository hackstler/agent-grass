# Mastra Agent API Reference

## Constructor

```typescript
import { Agent } from "@mastra/core/agent"

const agent = new Agent({
  id: string,                    // unique identifier (used as DB key)
  name: string,                  // display name
  instructions: string | string[] | (() => Promise<string>),
  model: LanguageModel,          // e.g., google("gemini-2.5-flash")
  tools?: Record<string, MastraTool>,
  memory?: Memory,
  agents?: Record<string, Agent>,  // supervisor pattern
  maxSteps?: number,             // default: 1
})
```

## generate() — Blocking Response

```typescript
const result = await agent.generate(input, {
  memory: { thread: string, resource: string },
  maxSteps?: number,
  onFinish?: (result) => void,
  onStepFinish?: (step) => void,
  output?: ZodSchema,  // structured output
})

// Result shape
result.text        // final text response
result.steps       // Array<{ toolResults?: Array<unknown> }>
result.object      // structured output (if output schema provided)
result.usage       // { promptTokens, completionTokens, totalTokens }
result.finishReason // "stop" | "length" | "tool-calls" | "content-filter"
```

**Input formats**:
- `string` — simple text input
- `string[]` — array of strings
- `Array<{ role: "user" | "assistant" | "system", content: string }>` — message objects

## stream() — SSE Streaming

```typescript
const stream = await agent.stream(input, {
  memory: { thread: string, resource: string },
})

// Text-only stream
for await (const chunk of stream.textStream) {
  process.stdout.write(chunk)
}

// Full stream (includes tool events)
for await (const chunk of stream.fullStream) {
  // Mastra 1.5 wraps in .payload
  const payload = (chunk as { payload?: Record<string, unknown> }).payload ?? {}

  if (chunk.type === "text-delta") {
    const text = payload["text"] as string
  } else if (chunk.type === "tool-result") {
    const toolName = payload["toolName"] as string
    const result = payload["result"]
  }
}
```

## Event Types in fullStream

| Type | Payload Fields | When |
|------|---------------|------|
| `text-delta` | `text: string` | Each text token |
| `tool-call` | `toolName, args` | Agent decides to call a tool |
| `tool-result` | `toolName, result` | Tool execution completed |
| `finish` | `finishReason, usage` | Generation complete |

## Callbacks

**onFinish** — fires after ALL steps complete:
```typescript
onFinish: (result) => {
  console.log("Final text:", result.text)
  console.log("Steps:", result.steps.length)
  console.log("Tokens:", result.usage.totalTokens)
}
```

**onStepFinish** — fires after EACH step (tool call + response):
```typescript
onStepFinish: (step) => {
  console.log("Step completed:", step.type)
  // Useful for progress monitoring
}
```

## Structured Output

```typescript
const result = await agent.generate("Analyze this data", {
  output: z.object({
    summary: z.string(),
    sentiment: z.enum(["positive", "neutral", "negative"]),
    confidence: z.number(),
  }),
})

// result.object is typed: { summary, sentiment, confidence }
```

## Dynamic Instructions

```typescript
const agent = new Agent({
  instructions: async () => {
    const config = await loadConfig()
    return `You are ${config.name}. ${config.description}`
  },
})
```

## Request Context

```typescript
const agent = new Agent({
  model: ({ requestContext }) => {
    const tier = requestContext.get("user-tier")
    return tier === "enterprise" ? google("gemini-2.5-pro") : google("gemini-2.5-flash")
  },
})
```

## Image Analysis

```typescript
const result = await agent.generate([
  { role: "user", content: [
    { type: "text", text: "What's in this image?" },
    { type: "image", image: new URL("https://example.com/image.png") },
  ]},
])
```
