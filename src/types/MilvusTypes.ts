export type IngestItem = {
  doc_id: string;   // required for upsert
  text: string;     // required
  source?: string;  // optional
};

export type IngestItemWithEmbedding = IngestItem & {
  embedding: number[]; // optional embedding (if not provided, will be generated)
};

export type SearchResult = {
  doc_id: string;
  text: string;
  source?: string;
  score?: number;
};


export type MilvusDoc = {
  doc_id: string; // primary key
  text: string;
  embedding: number[];
  source?: string; // optional metadata (keep simple)
};


export type DocDeleteItem = Pick<MilvusDoc, 'doc_id'>;


export type VectorQuery = {
  query: string;
  topK?: number;
};


export type MilvusSearchParams = {
  collection_name: string,
  vector: number[][], // array of query vectors (usually just one)
  params: {nprobe: number},
  limit: number,
  metric_type: string,
  output_fields: [string];
};
