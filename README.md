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

## Security

All routes are protected with a shared secret and HMAC protected headers. Paste this into Postman's pre-request scripts and set the environment variables and create an environment in Postman:
```javascript
const secret = pm.environment.get("SOURCE_SECRET");
if (!secret) {
  throw new Error("Missing SOURCE_SECRET in environment");
}

const timestamp = Date.now().toString();
const method = pm.request.method.toUpperCase();
const pathWithQuery = pm.request.url.getPathWithQuery();

let body = "";
if (pm.request.body && pm.request.body.mode === "raw") {
  body = pm.request.body.raw || "";
}

const payload = [method, pathWithQuery, timestamp, body].join("\n");
const signature = CryptoJS.HmacSHA256(payload, secret).toString(CryptoJS.enc.Hex);

pm.request.headers.upsert({ key: "x-timestamp", value: timestamp });
pm.request.headers.upsert({ key: "x-signature", value: signature });

console.log("payload:", payload);
console.log("signature:", signature);
```

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
