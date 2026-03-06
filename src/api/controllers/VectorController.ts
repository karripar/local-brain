import { Request, Response, NextFunction } from 'express';
import { embedQuery, embedTexts } from '../services/embeddingService';
import { upsertDocs, vectorSearch, deleteByDocIds, MilvusDoc, ensureCollection } from '../services/milvusAdapter';
import mlvsClient from '../../client';
import { aiClient } from '../services/embeddingService';

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

    const context = buildContext(results);

    res.json({ results, context });
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

// This endpoint is for debugging/testing purposes to read all documents in the collection.
export const readStore = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    await ensureCollection();

    const result = await mlvsClient.query({
      collection_name: 'rag_documents',
      filter: 'doc_id != ""',
      output_fields: ['doc_id', 'text', 'source'],
      limit: 1000,
    });

    res.json({ documents: result });
  } catch (err) {
    next(err);
  }
};


type SearchResult = {
  doc_id: string;
  text: string;
  source?: string;
  score?: number;
};

// This function builds a context string from the search results to be used in the RAG answer generation step.
export const buildContext = (results: SearchResult[], maxChunks = 5) => {
  if (!results.length) {
    return 'No relevant context was found in the vector store.';
  }

  return results
    .slice(0, maxChunks)
    .map((r, i) => {
      return [
        `[Source ${i + 1}]`,
        `doc_id: ${r.doc_id}`,
        `source: ${r.source ?? 'unknown'}`,
        `content: ${r.text}`,
      ].join('\n');
    })
    .join('\n\n');
};


// This function demonstrates how to generate an answer using the retrieved context and a question.
export const generateRagAnswer = async (
  question: string,
  context: string,
) => {
  const response = await aiClient.responses.create({
    model: 'gpt-4.1-mini',
    input: [
      {
        role: 'system',
        content:
          'You answer only using the provided context. If the context is insufficient, say so clearly.',
      },
      {
        role: 'user',
        content: `Context:\n${context}\n\nQuestion: ${question}`,
      },
    ],
  });

  return response.output_text;
};


export const askWithRag = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { query, topK = 5 } = req.body;

    if (!query || typeof query !== 'string') {
      return res.status(400).json({ message: 'query (string) is required' });
    }

    const queryEmbedding = await embedQuery(query);
    const results = await vectorSearch(queryEmbedding, topK);
    const context = buildContext(results);
    const answer = await generateRagAnswer(query, context);

    res.json({
      answer,
      sources: results.map((r: SearchResult) => ({
      doc_id: r.doc_id,
      source: r.source,
      score: r.score,
      })),
    });
  } catch (err) {
    next(err);
  }
};
