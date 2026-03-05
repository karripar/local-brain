import { Request, Response, NextFunction } from 'express';
import { embedQuery, embedTexts } from '../services/embeddingService';
import { upsertDocs, vectorSearch, deleteByDocIds, MilvusDoc } from '../services/milvusAdapter';

type IngestItem = {
  doc_id: string;   // required for upsert
  text: string;     // required
  source?: string;  // optional
};

export const ingest = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const items: IngestItem[] = req.body?.items;

    if (!Array.isArray(items) || !items.length) {
      return res.status(400).json({ message: 'items[] is required' });
    }
    if (items.some((i) => !i?.doc_id || !i?.text)) {
      return res.status(400).json({ message: 'Each item must have doc_id and text' });
    }

    const texts = items.map((i) => i.text);
    const embeddings = await embedTexts(texts);

    console.log('Generated embeddings for items:', embeddings.length);

    const docs: MilvusDoc[] = items.map((i, idx) => ({
      doc_id: i.doc_id,
      text: i.text,
      source: i.source ?? '',
      embedding: embeddings[idx],
    }));

    await upsertDocs(docs);

    res.json({ upserted: docs.length });
  } catch (err) {
    console.error('Error in ingest controller:', err);
    next(err);
  }
};

export const search = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const query = req.body?.query;
    const topK = Number(req.body?.topK ?? 5);

    if (!query || typeof query !== 'string') {
      return res.status(400).json({ message: 'query (string) is required' });
    }

    const qEmb = await embedQuery(query);
    const results = await vectorSearch(qEmb, Number.isFinite(topK) ? topK : 5);

    res.json({ results });
  } catch (err) {
    next(err);
  }
};

export const deleteDocs = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const docIds: string[] = req.body?.doc_ids;

    if (!Array.isArray(docIds) || !docIds.length) {
      return res.status(400).json({ message: 'doc_ids[] is required' });
    }

    await deleteByDocIds(docIds);

    res.json({ deleted: docIds.length });
  } catch (err) {
    next(err);
  }
};
