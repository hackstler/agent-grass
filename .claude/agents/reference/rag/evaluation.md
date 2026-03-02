# RAG Evaluation Reference

## Retrieval Metrics

### Recall@K
**What**: Of all relevant chunks for a query, what fraction did we retrieve in top-K?
**Formula**: `relevant_in_topK / total_relevant`
**Target**: > 0.7 at K=10
**Meaning**: "Are we finding the right documents?"

### Precision@K
**What**: Of the top-K retrieved chunks, what fraction are actually relevant?
**Formula**: `relevant_in_topK / K`
**Target**: > 0.3 at K=10
**Meaning**: "How much noise are we sending to the LLM?"

### MRR (Mean Reciprocal Rank)
**What**: How high is the first relevant result on average?
**Formula**: `1 / rank_of_first_relevant`
**Target**: > 0.5
**Meaning**: "Does the best answer appear near the top?"

### NDCG (Normalized Discounted Cumulative Gain)
**What**: Quality of the entire ranking, weighted by position
**Target**: > 0.6
**Meaning**: "Are ALL relevant results ranked well, not just the first?"

## End-to-End Metrics

### Answer Relevance
**What**: Does the generated answer actually address the user's question?
**How to measure**: LLM-as-judge or human evaluation
**Red flag**: Agent gives generic response despite having relevant chunks

### Faithfulness (Groundedness)
**What**: Is the answer based only on retrieved chunks, with no hallucination?
**How to measure**: Check if every claim in the answer maps to a chunk
**Red flag**: Answer contains specific facts not in any retrieved chunk

### Context Relevance
**What**: Are the retrieved chunks actually useful for answering?
**How to measure**: Would a human use these chunks to answer the question?
**Red flag**: High retrieval scores but chunks are tangentially related

## How to Evaluate in This Project

### Quick Check: `/test-rag [query]`
```
/test-rag "recetas saludables con pollo"
```
Shows: chunks retrieved, similarity scores, document sources, excerpts.
- Scores > 0.7: relevant
- Scores 0.3–0.7: borderline (may or may not help)
- Scores < 0.3: noise (shouldn't appear with current threshold)

### Automated: `/benchmark`
Runs a suite of test queries and reports aggregate metrics.

### Manual Spot-Check Protocol
1. Pick 10 questions you know the answer to
2. Ask each via chat or WhatsApp
3. For each, verify:
   - Did the agent find the right document? (recall)
   - Were irrelevant docs returned? (precision)
   - Is the answer grounded in chunks? (faithfulness)
   - Does the answer include source links? (citation)

## Building a Test Set

### Step 1: Create Representative Questions (20–50)
```
Category: YouTube recipe content
Q1: "¿Cómo se hace la torta de yogur?"
Q2: "Recetas con tortilla rápidas"
Q3: "Aderezos sin mayonesa"

Category: Specific document lookup
Q4: "Recetas con salchicha del video viral"
Q5: "Café potenciado"
```

### Step 2: Tag Expected Documents
```
Q1 → document: "TORTA de YOGUR 3 ingredientes"
Q2 → documents: ["Tortilla con Omelett", "Best Tortilla Recipe", ...]
Q3 → document: "ADEREZOS SIN MAYONESA, con yogurt griego"
```

### Step 3: Run and Measure
For each query:
- Was the expected document in top-10? → recall@10
- How many irrelevant docs in top-10? → precision@10
- What rank was the expected doc? → MRR
- Did the answer use the right chunks? → faithfulness

### Step 4: Track Over Time
After config changes (threshold, chunking, embeddings), re-run the test set and compare.

## Diagnostic Table

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| recall@10 < 0.7 | Threshold too high or embedding mismatch | Lower threshold, check embedding model |
| precision@10 < 0.3 | Too many irrelevant chunks | Enable reranking, raise threshold, lower topK |
| MRR < 0.5 | Relevant docs rank low | Enable multi-query, try HyDE |
| Good retrieval, bad answers | LLM prompt issue | Check system prompt, reduce topK to decrease context noise |
| Inconsistent scores | Multi-language content | Verify embedding model handles all languages |
| 0 chunks for known content | orgId filter mismatch | Check multi-tenancy filtering in retriever |

## When to Re-Evaluate

- After changing chunking strategy or chunk size
- After switching embedding model
- After ingesting a new content type
- After changing similarity threshold or topK
- After enabling/disabling reranking
- After modifying the system prompt
- Monthly as a routine health check
