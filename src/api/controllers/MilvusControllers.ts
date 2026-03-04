import mlvsClient from '../../client';
import {DataType} from '@zilliz/milvus2-sdk-node';
import {Request, Response, NextFunction} from 'express';
import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

const aiClient = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Basic schema constants for our "vector store" collection
const DEFAULT_COLLECTION_NAME = 'rag_documents';
// OpenAI text-embedding-3-small has 1536 dimensions
const VECTOR_DIM = 1536;

export const createCollection = async (
  collectionName: string = DEFAULT_COLLECTION_NAME,
) => {
  // If collection already exists, check that the schema matches what we expect.
  const collections = await mlvsClient.showCollections();
  const exists = collections.data.some((c: any) => c.name === collectionName);

  if (exists) {
    try {
      const desc = await mlvsClient.describeCollection({
        collection_name: collectionName,
      } as any);

      const fields = desc.schema?.fields ?? [];

      // temporary debug
      console.dir(fields, {depth: null});

      // require our expected fields and types
      const hasExpectedSchema =
        fields.some(
          (f: any) =>
            f.name === 'id' &&
            String(f.data_type) === String(DataType.Int64) &&
            f.is_primary_key === true &&
            f.autoID === false,
        ) &&
        fields.some(
          (f: any) =>
            f.name === 'text' &&
            String(f.data_type) === String(DataType.VarChar),
        ) &&
        fields.some(
          (f: any) =>
            f.name === 'embedding' &&
            String(f.data_type) === String(DataType.FloatVector) &&
            Number(f.dim) === VECTOR_DIM,
        );

      const schemaMatches = hasExpectedSchema;

      // If the existing collection has a different schema, drop and recreate it.
      if (!schemaMatches) {
        await mlvsClient.dropCollection({
          collection_name: collectionName,
        } as any);
      } else {
        // Schema is fine, just ensure it's loaded.
        await mlvsClient.loadCollectionSync({collection_name: collectionName});
        return;
      }
    } catch (e) {
      // If describeCollection fails for some reason, fall through to recreate.
    }
  }

  const collectionParams = {
    collection_name: collectionName,
    fields: [
      {
        name: 'id',
        description: 'Primary key',
        data_type: DataType.Int64,
        is_primary_key: true,
        autoID: false,
      },
      {
        name: 'text',
        description: 'Original chunk text',
        data_type: DataType.VarChar,
        max_length: 2048,
      },
      {
        name: 'embedding',
        description: 'Vector embedding',
        data_type: DataType.FloatVector,
        dim: VECTOR_DIM,
      },
    ],
  };

  await mlvsClient.createCollection(collectionParams as any);
  // Create IVF_FLAT index on vector field for similarity search
  await mlvsClient.createIndex({
    collection_name: collectionName,
    field_name: 'embedding',
    index_name: 'idx_embedding',
    index_type: 'IVF_FLAT',
    metric_type: 'IP',
    params: {nlist: 1024},
  } as any);

  await mlvsClient.loadCollectionSync({collection_name: collectionName});
};

// Insert text chunks + embeddings into Milvus
export const insertEmbeddings = async (
  texts: string[],
  embeddings: number[][],
  collectionName: string = DEFAULT_COLLECTION_NAME,
) => {
  if (!texts.length) return;
  if (texts.length !== embeddings.length) {
    throw new Error('texts.length must equal embeddings.length');
  }

  await createCollection(collectionName);

  const numRows = texts.length;
  const ids = Array.from({length: numRows}, (_, i) => i + 1);

  const data = [
    {
      name: 'id',
      type: DataType.Int64,
      values: ids,
    },
    {
      name: 'text',
      type: DataType.VarChar,
      values: texts,
    },
    {
      name: 'embedding',
      type: DataType.FloatVector,
      values: embeddings,
    },
  ];

  try {
    await mlvsClient.insert({
      collection_name: collectionName,
      data,
      num_rows: numRows,
    } as any);
  } catch (e: any) {
    // eslint-disable-next-line no-console
    console.error('Milvus insert error object:', e);
    // Helpful logging for debugging schema mismatches
    try {
      const desc = await mlvsClient.describeCollection({
        collection_name: collectionName,
      } as any);
      // eslint-disable-next-line no-console
      console.error('Milvus insert failed. Collection schema:', desc);
      // eslint-disable-next-line no-console
      console.error('Milvus insert failed. First row values sample:', {
        text: texts[0],
        embeddingLength: embeddings[0]?.length,
      });
    } catch (inner) {
      // eslint-disable-next-line no-console
      console.error(
        'Milvus insert failed and describeCollection also failed',
        inner,
      );
    }
    throw e;
  }
};

// Similarity search: return topK most similar chunks for a query embedding
export const similaritySearch = async (
  queryEmbedding: number[],
  topK = 5,
  collectionName: string = DEFAULT_COLLECTION_NAME,
) => {
  await createCollection(collectionName);

  await mlvsClient.loadCollectionSync({collection_name: collectionName});

  const searchParams = {
    collection_name: collectionName,
    vector_field_name: 'embedding',
    topk: topK.toString(),
    vectors: [queryEmbedding],
    metric_type: 'IP',
    params: {nprobe: 16},
    output_fields: ['text'],
  } as any;

  const res = await mlvsClient.search(searchParams);

  const results = res.results ?? [];

  return results.map((r: any) => ({
    text: r.text,
    score: r.score ?? r.distance,
  }));
};

// Simple init helper
export const initMilvusVectorStore = async () => {
  await createCollection(DEFAULT_COLLECTION_NAME);
};

export const seedMilvus = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const {texts} = req.body;

    const docs =
      Array.isArray(texts) && texts.length
        ? texts
        : [
            'Milvus is a vector database for AI applications.',
            'OpenAI provides powerful foundation models.',
            'Vector search is useful for semantic similarity.',
          ];

    const embedResponse = await aiClient.embeddings.create({
      model: 'text-embedding-3-small',
      input: docs,
    });

    const embeddings = embedResponse.data.map((d) => d.embedding);

    await insertEmbeddings(docs, embeddings);

    res.json({inserted: docs.length});
  } catch (err) {
    next(err);
  }
};

export const queryMilvus = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const {query} = req.body;
    if (!query || typeof query !== 'string') {
      return res.status(400).json({message: 'query (string) is required'});
    }

    // TODO: call OpenAI embeddings + Milvus similarity search here.
    const queryEmbeddingResponse = await aiClient.embeddings.create({
      model: 'text-embedding-3-small',
      input: query,
    });
    const queryEmbedding = queryEmbeddingResponse.data[0]?.embedding ?? [];

    const searchResults = await similaritySearch(queryEmbedding);

    res.json({results: searchResults});
  } catch (err) {
    next(err);
  }
};

export const dropCollections = async () => {
  await mlvsClient.dropCollection({collection_name: 'rag_documents'} as any);
};
