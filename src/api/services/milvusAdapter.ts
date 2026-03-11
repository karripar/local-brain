import mlvsClient from '../../client';
import {DataType} from '@zilliz/milvus2-sdk-node';
import { MilvusDoc, SearchResult } from '../../types/MilvusTypes';

const DEFAULT_COLLECTION_NAME = process.env.COLLECTION_NAME || 'rag_documents';
const VECTOR_DIM = Number(process.env.VECTOR_DIMENSIONS) || 1536;

export const ensureCollection = async (
  collectionName: string = DEFAULT_COLLECTION_NAME,
) => {
  try {
    const health = await (mlvsClient as any).checkHealth?.();
    console.log('Milvus health:', health);
  } catch (e) {
    console.warn('Milvus health check failed:', (e as any)?.message ?? e);
  }

  try {
  const collections = await mlvsClient.showCollections();
  const exists = collections.data.some((c: any) => c.name === collectionName);

  if (!exists) {
    const schema = [
      {
        name: 'doc_id',
        description: 'Document/chunk id (PK)',
        data_type: DataType.VarChar,
        is_primary_key: true,
        autoID: false,
        max_length: 512,
      },
      {
        name: 'text',
        description: 'Chunk text',
        data_type: DataType.VarChar,
        max_length: 2048,
      },
      {
        name: 'source',
        description: 'Optional source tag',
        data_type: DataType.VarChar,
        max_length: 512,
      },
      {
        name: 'embedding',
        description: 'Embedding vector',
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
  }

  await mlvsClient.loadCollectionSync({collection_name: collectionName});
  } catch (e) {
    console.error('Error in ensureCollection:', e);
    throw e;
  }
};

const escapeExprString = (s: string) => {
  // Milvus expr string literal uses double quotes commonly; escape safely
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export const deleteByDocIds = async (
  docIds: string[],
  collectionName: string = DEFAULT_COLLECTION_NAME,
) => {
  try {
  if (!docIds.length) return;
  await ensureCollection(collectionName);

  const list = docIds.map((id) => `"${escapeExprString(id)}"`).join(',');
  const expr = `doc_id in [${list}]`;

  await (mlvsClient as any).delete({
    collection_name: collectionName,
    // SDK variants: some look for `filter`, some for `expr`. Current SDK was crying about missing `expr`, but docs mention `filter`... so we set both just in case.
    filter: expr,
    expr: expr,
  });

  await (mlvsClient as any).flushSync?.({ collection_names: [collectionName] });
  } catch (e) {
    console.error('Error in deleteByDocIds:', e);
    throw e;
  }
};

export const upsertDocs = async (
  docs: MilvusDoc[],
  collectionName: string = DEFAULT_COLLECTION_NAME,
) => {
  try {
    if (!docs.length) return;

    await ensureCollection(collectionName);

    // --- Validate schema to avoid silent mismatch (old collection, wrong fields, etc.) ---
    const desc = await mlvsClient.describeCollection({
      collection_name: collectionName,
    } as any);

    const fields = desc?.schema?.fields ?? [];
    const fieldNames = new Set<string>(fields.map((f: any) => f.name));

    const required = ['doc_id', 'text', 'embedding']; // source is optional
    const missing = required.filter((n) => !fieldNames.has(n));

    if (missing.length) {
      throw new Error(
        `Milvus collection "${collectionName}" schema mismatch. Missing fields: ${missing.join(
          ', ',
        )}. Existing fields: ${Array.from(fieldNames).join(
          ', ',
        )}. Drop the collection or use a new collection name.`,
      );
    }

    // --- "Upsert" reliably: delete existing ids, then insert ---
    // built in upsert function is not reliable, it was tested and found to cause duplicates and ghost vectors. Deleting by doc_id is more reliable.
    const ids = docs.map((d) => d.doc_id);
    await deleteByDocIds(ids, collectionName);

    await mlvsClient.insert({
      collection_name: collectionName,
      fields_data: docs,
    } as any);

    await (mlvsClient as any).flushSync?.({ collection_names: [collectionName] });
    await mlvsClient.loadCollectionSync({ collection_name: collectionName });
  } catch (e) {
    console.error('Error in upsertDocs:', e);
    throw e;
  }
};

export const vectorSearch = async (
  queryEmbedding: number[],
  topK: number = 5,
  collectionName: string = DEFAULT_COLLECTION_NAME,
) => {
  await ensureCollection(collectionName);

  const res = await mlvsClient.search({
    collection_name: collectionName,
    vector: [queryEmbedding],
    params: {nprobe: 16},
    limit: topK,
    metric_type: 'IP',
    output_fields: ['doc_id', 'text', 'source'],
  } as any);

  const raw = res.results ?? [];
  return raw.map((r) => ({
    doc_id: r.doc_id ?? r.fields?.doc_id,
    text: r.text ?? r.fields?.text,
    source: r.source ?? r.fields?.source,
    score: r.score ?? r.distance,
  })) as SearchResult[];
};
