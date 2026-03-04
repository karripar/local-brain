import mlvsClient from '../../client';
import {DataType} from '@zilliz/milvus2-sdk-node';
import {Request, Response, NextFunction} from 'express';

// Basic schema constants for our "vector store" collection
const DEFAULT_COLLECTION_NAME = 'rag_documents';
const VECTOR_DIM = 128; // must match your OpenAI embedding dimension TODO: Check this 

export const createCollection = async (
  collectionName: string = DEFAULT_COLLECTION_NAME,
) => {
  // If collection already exists, do nothing
  const collections = await mlvsClient.showCollections();
  const exists = collections.data.some((c: any) => c.name === collectionName);
  if (exists) return;

  const collectionParams = {
    collection_name: collectionName,
    fields: [
      {
        name: 'id',
        description: 'Primary key',
        data_type: DataType.Int64,
        is_primary_key: true,
        autoID: true,
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
        type_params: {
          dim: String(VECTOR_DIM),
        },
      },
    ],
  };

  await mlvsClient.createCollection(collectionParams as any);
  // Create IVF_FLAT index on vector field for similarity search
  await mlvsClient.createIndex({
    collection_name: collectionName,
    field_name: 'embedding',
    extra_params: {
      index_type: 'IVF_FLAT',
      metric_type: 'IP',
      params: JSON.stringify({nlist: 1024}),
    },
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

  const entities = [
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

  await mlvsClient.insert({
    collection_name: collectionName,
    fields_data: entities as any,
  });
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
    params: JSON.stringify({nprobe: 16}),
    output_fields: ['text'],
  } as any;

  const res = await mlvsClient.search(searchParams);

  const results = res.results ?? [];

  return results.map((r: any) => ({
    text: r.text,
    score: r.score ?? r.distance,
  }));
};

// Simple init helper you can call from your server bootstrap
export const initMilvusVectorStore = async () => {
  await createCollection(DEFAULT_COLLECTION_NAME);
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
    // For now, just echo back.
    res.json({message: 'Query endpoint is working', query});
  } catch (err) {
    next(err);
  }
};
