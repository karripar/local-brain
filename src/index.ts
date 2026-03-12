import app from './app';
import { ensureCollection } from './api/services/milvusAdapter';

const collectionName = process.env.COLLECTION_NAME || 'rag_documents';
const PORT = Number(process.env.PORT) || 3006;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const isMilvusNotReadyError = (err: unknown) => {
  const e = err as { code?: number; details?: string; message?: string };
  const text = `${e?.details ?? ''} ${e?.message ?? ''}`.toLowerCase();

  return e?.code === 14 || text.includes('milvus proxy is not ready yet');
};

const initMilvusWithRetry = async () => {
  const maxAttempts = 15;
  const delayMs = 3000;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      console.log(
        `Initializing Milvus collection "${collectionName}" (attempt ${attempt}/${maxAttempts})...`,
      );

      await ensureCollection(collectionName);

      console.log(`Collection "${collectionName}" is ready.`);
      return;
    } catch (err) {
      if (!isMilvusNotReadyError(err) || attempt === maxAttempts) {
        throw err;
      }

      console.warn(
        `Milvus is not ready yet. Retrying in ${delayMs} ms...`,
      );
      await sleep(delayMs);
    }
  }
};

(async () => {
  try {
    await initMilvusWithRetry();

    app.listen(PORT, () => {
      console.log(`Milvus vector-store API listening on port ${PORT}`);
    });
  } catch (err) {
    console.error('Failed to initialize Milvus:', err);
    process.exit(1);
  }
})();
