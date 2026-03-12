import app from './app';
import {ensureCollection} from './api/services/milvusAdapter';

const collectionName = process.env.COLLECTION_NAME || 'rag_documents';

const PORT = process.env.PORT || 3006;

// Ensure the Milvus collection exists before starting the server
(async () => {
  await ensureCollection(collectionName);

  app.listen(PORT, () => {
    console.log(`Milvus vector-store API listening on port ${PORT}`);
  });
})();
