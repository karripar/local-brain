# Milvus Store

Minimal Express API for storing and searching text embeddings in Milvus. This is a personal project for storing useful information and searching them on a local computer.

## How it works

1. You send text (documents) to the API.
2. The service creates embeddings for the text.
3. Embeddings + metadata are stored in a Milvus collection (`llama_brains`).
4. You can search by semantic similarity, delete docs, or drop the collection.

## Prerequisites

- Docker Desktop running
- Node.js (LTS)
- PostgreSQL running locally or reachable from this machine
- `.env` file with your embedding provider config (see `src/services/embeddingService.ts`).

Optional PostgreSQL settings:

```env
POSTGRES_URL=postgres://postgres:password@localhost:5432/postgres
# or set the individual fields below
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_USER=postgres
POSTGRES_PASSWORD=password
POSTGRES_DATABASE=postgres
```

The backend uses PostgreSQL for upload bookkeeping:

- `upload_files` stores PDF-level metadata and cleanup status.
- `upload_chunks` maps vector `doc_id` values back to their source PDF.
- When documents are deleted from Milvus, the backend uses this mapping to remove the matching PDF from `uploads/` when no chunks remain.

## Run

```bash
# start Milvus + dependencies
docker compose up -d

# install deps and start API
npm install
npm run dev
```

Default base URL (if not changed): `http://localhost:3006/api/v1`.

## Security

All routes are protected with a shared secret and HMAC protected headers. Paste this script block into Postman's pre-request scripts and set the environment variables and create an environment in Postman:

```javascript
const secret = pm.environment.get('SOURCE_SECRET');
if (!secret) {
  throw new Error('Missing SOURCE_SECRET in environment');
}

const timestamp = Date.now().toString();
const method = pm.request.method.toUpperCase();
const pathWithQuery = pm.request.url.getPathWithQuery();

let body = '';
if (pm.request.body && pm.request.body.mode === 'raw') {
  body = pm.request.body.raw || '';
}

const payload = [method, pathWithQuery, timestamp, body].join('\n');
const signature = CryptoJS.HmacSHA256(payload, secret).toString(
  CryptoJS.enc.Hex,
);

pm.request.headers.upsert({key: 'x-timestamp', value: timestamp});
pm.request.headers.upsert({key: 'x-signature', value: signature});

console.log('payload:', payload);
console.log('signature:', signature);
```

## Routes

Vector routes are under `/api/v1/vector`.

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
  "tenant_id": "default",
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

Dev-only: drop the whole `llama_brains` collection.

Response:

```json
{"dropped": true}
```

Upload routes are under `/api/v1/upload`.

### POST /pdf

Upload a PDF file, split it into chunks, embed each chunk, and upsert into Milvus.

Request type: `multipart/form-data`

Fields:

- `file` (required): PDF file
- `source` (optional): string metadata to store with each chunk (defaults to original filename)
- `chunkSize` (optional): integer between 50 and 5000 (default: 800)
- `chunkOverlap` (optional): integer between 0 and 1000 (default: 120)

Response (example shape):

```json
{
  "message": "PDF uploaded, chunked, embedded, and stored successfully",
  "file": {
    "originalName": "paper.pdf",
    "storedAs": "1714200000000-uuid-paper.pdf",
    "path": "uploads/1714200000000-uuid-paper.pdf",
    "sizeBytes": 349124
  },
  "chunks": 17,
  "upserted": 17,
  "source": "paper.pdf"
}
```

Uploaded files are stored in the project root under `uploads/`.
