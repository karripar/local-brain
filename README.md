this is only testing for now, trying to learn this mf (milvus)

Basic express REST client with Milvus implementation


RUN: sudo docker-compose up -d
to start the milvus server
(make sure docker desktop is installed)


for devs:
1. npm i
2. add env variables to .env
3. docker compose up -d
4. npm run dev


endpoints:
1. DELETE /api/v1/vector/documents
 - delete documents
2. POST /api/v1/vector/ingest
 - Seed the vector store
3. POST /api/v1/vector/search
 - search vector store (query matching)

Check the routes for correct endpoints
