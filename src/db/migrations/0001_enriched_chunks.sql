-- Add contextual retrieval and BM25 search support to document_chunks
ALTER TABLE document_chunks ADD COLUMN context_prefix text;
ALTER TABLE document_chunks ADD COLUMN search_vector tsvector;
CREATE INDEX document_chunks_search_idx ON document_chunks USING gin(search_vector);
