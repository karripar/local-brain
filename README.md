# Milvus Store

Minimal Express API for storing and searching text embeddings in Milvus.

## How it works

1. You send text (documents) to the API.
2. The service creates embeddings for the text.
3. Embeddings + metadata are stored in a Milvus collection (`rag_documents`).
4. You can search by semantic similarity, delete docs, or drop the collection.

## Prerequisites

- Docker Desktop running
- Node.js (LTS)
- `.env` file with your embedding provider config (see `src/services/embeddingService.ts`).

## Run

```bash
# start Milvus + dependencies
docker compose up -d

# install deps and start API
npm install
npm run dev
```

Default base URL (if not changed): `http://localhost:3006/api/v1/vector`.

## Routes

All routes are under `/api/v1/vector`.

### POST /ingest

Ingest or upsert documents.

Body:

```json
{
  "items": [
    {
      "doc_id": "doc-1",
      "text": "Some content to index",
      "source": "optional-metadata"
    }
  ]
}
```

Response:

```json
{"upserted": 1}
```

### POST /search

Semantic search over stored documents.

Body:

```json
{
  "query": "search phrase",
  "topK": 5
}
```

Response (example shape):

```json
{
  "results": [
    {
      "doc_id": "doc-1",
      "text": "Some content to index",
      "source": "optional-metadata",
      "score": 0.87
    }
  ]
}
```

### DELETE /documents

Delete documents by `doc_id`.

Body:

```json
{
  "doc_ids": ["doc-1", "doc-2"]
}
```

Response:

```json
{"deleted": 2}
```

### DELETE /drop

Dev-only: drop the whole `rag_documents` collection.

Response:

```json
{"dropped": true}
```
