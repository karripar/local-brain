export type IngestItem = {
  doc_id: string;   // required for upsert
  text: string;     // required
  source?: string;  // optional
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
