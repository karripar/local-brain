import mlvsClient from '../../client';
import {DataType} from '@zilliz/milvus2-sdk-node';
import {Request, Response, NextFunction} from 'express';
import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

const aiClient = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const DEFAULT_COLLECTION_NAME = 'rag_documents';
const VECTOR_DIM = 1536; // text-embedding-3-small

export const createCollection = async (
  collectionName: string = DEFAULT_COLLECTION_NAME,
) => {
  const collections = await mlvsClient.showCollections();
  const exists = collections.data.some((c: any) => c.name === collectionName);

  if (exists) {
    try {
      const desc = await mlvsClient.describeCollection({
        collection_name: collectionName,
      } as any);
      const fields = desc.schema?.fields ?? [];

      // Debug actual fields to ensure schema alignment with inserts
      console.dir(fields, {depth: null});

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

      if (hasExpectedSchema) {
        await mlvsClient.loadCollectionSync({collection_name: collectionName});
        return;
      }

      await mlvsClient.dropCollection({
        collection_name: collectionName,
      } as any);
    } catch {
      // if describeCollection fails, fall through to (re)create
    }
  }

  const schema = [
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
      description: 'OpenAI embedding',
      data_type: DataType.FloatVector,
      dim: VECTOR_DIM,
    },
  ];

  await mlvsClient.createCollection({
    collection_name: collectionName,
    description: 'RAG documents',
    fields: schema,
  } as any);

  await mlvsClient.createIndex({
    collection_name: collectionName,
    field_name: 'embedding',
    index_name: 'idx_embedding',
    index_type: 'IVF_FLAT',
    params: {nlist: 1024},
    metric_type: 'IP',
  } as any);

  await mlvsClient.loadCollectionSync({collection_name: collectionName});
};

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

  // Row-wise objects, like the official docs
  const fields_data: Array<{id: number; text: string; embedding: number[]}> =
    [];

  for (let i = 0; i < numRows; i++) {
    fields_data.push({
      id: i + 1,
      text: texts[i],
      embedding: embeddings[i],
    });
  }

  try {
    const insertRes = await mlvsClient.insert({
      collection_name: collectionName,
      fields_data,
    } as any);

    console.log('Milvus insert response:', insertRes);
  } catch (e: any) {
    console.error('Milvus insert error:', e?.message || e);

    // Extra debug: show the collection schema and sample row
    try {
      const desc = await mlvsClient.describeCollection({
        collection_name: collectionName,
      } as any);
      console.error(
        'Collection schema from Milvus:',
        JSON.stringify(desc.schema, null, 2),
      );
      console.error('First row we tried to insert:', fields_data[0]);
    } catch (inner) {
      console.error('Also failed to describeCollection:', inner);
    }

    throw e;
  }
};

export const similaritySearch = async (
  queryEmbedding: number[],
  topK = 5,
  collectionName: string = DEFAULT_COLLECTION_NAME,
) => {
  await createCollection(collectionName);

  // Collection should already be loaded in createCollection, but keep for safety
  await mlvsClient.loadCollectionSync({collection_name: collectionName});

  const res = await mlvsClient.search({
    collection_name: collectionName,
    vector: [queryEmbedding],
    params: {nprobe: 16},
    limit: topK,
    metric_type: 'IP',
    output_fields: ['id', 'text'],
  } as any);

  // Debug the raw search response shape once
  console.dir({milvusSearchRaw: res}, {depth: null});

  const rawResults = (res as any).results ?? (res as any).data ?? [];

  return rawResults.map((r: any) => ({
    text: r.text ?? r.fields?.text ?? r._source?.text,
    score: r.score ?? r.distance ?? r._score,
  }));
};

// Simple helper to verify that rows actually exist in the collection using a non-vector query
export const debugListDocuments = async (
  collectionName: string = DEFAULT_COLLECTION_NAME,
) => {
  await createCollection(collectionName);
  const queryRes = await (mlvsClient as any).query({
    collection_name: collectionName,
    expr: 'id >= 1',
    output_fields: ['id', 'text'],
    limit: 10,
  });
  console.dir({milvusQuerySample: queryRes}, {depth: null});
  return queryRes;
};

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

    const embeddings = embedResponse.data.map((d) => d.embedding as number[]);

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

    const queryEmbeddingResponse = await aiClient.embeddings.create({
      model: 'text-embedding-3-small',
      input: query,
    });
    const queryEmbedding =
      (queryEmbeddingResponse.data[0]?.embedding as number[]) ?? [];

    const searchResults = await similaritySearch(queryEmbedding);

    res.json({results: searchResults});
  } catch (err) {
    next(err);
  }
};

export const dropCollections = async () => {
  await mlvsClient.dropCollection({
    collection_name: DEFAULT_COLLECTION_NAME,
  } as any);
};
