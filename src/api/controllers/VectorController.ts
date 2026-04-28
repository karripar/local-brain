import {Request, Response, NextFunction} from 'express';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import {embedQuery, embedTexts} from '../services/embeddingService';
import {
  upsertDocs,
  vectorSearch,
  deleteByDocIds,
  ensureCollection,
} from '../services/milvusAdapter';
import mlvsClient from '../../client';
import {ollama} from '../services/embeddingService';
import {
  markUploadCleanupOutcome,
  resolveUploadCleanupTargets,
} from '../services/postgresStore';
import {
  IngestItem,
  SearchResult,
  MilvusDoc,
  DocDeleteItem,
  VectorQuery,
} from '../../types/MilvusTypes';

type ReadQuery = {
  page?: string;
  limit?: string;
};

const UPLOADS_DIR = path.join(process.cwd(), 'uploads');
const UPLOAD_CHUNK_DOC_ID_PATTERN = /^(.*)-chunk-\d+$/;

const getUploadFileIdForDocId = (docId: string) => {
  const match = docId.match(UPLOAD_CHUNK_DOC_ID_PATTERN);
  return match?.[1];
};

const getUploadFilePathForFileId = (fileId: string) =>
  path.join(UPLOADS_DIR, `${fileId}.pdf`);

const getUploadRelativePathForDocId = (docId: string) => {
  const fileId = getUploadFileIdForDocId(docId);

  if (!fileId) {
    return undefined;
  }

  const uploadFileName = `${fileId}.pdf`;
  const uploadFilePath = getUploadFilePathForFileId(fileId);

  if (!fs.existsSync(uploadFilePath)) {
    return undefined;
  }

  return `/uploads/${encodeURIComponent(uploadFileName)}`;
};

const withUploadLink = (result: SearchResult, req: Request): SearchResult => {
  const uploadRelativePath = getUploadRelativePathForDocId(result.doc_id);

  if (!uploadRelativePath) {
    return result;
  }

  const protocol = req.protocol || 'http';
  const host = req.get('host');
  const uploadLink = host
    ? `${protocol}://${host}${uploadRelativePath}`
    : uploadRelativePath;

  return {
    ...result,
    upload_link: uploadLink,
  };
};

const removeUploadedFilesForDocIds = async (docIds: string[]) => {
  const removedFiles: string[] = [];
  const skippedFiles: string[] = [];

  const postgresResolution = await resolveUploadCleanupTargets(docIds);
  const trackedTargets = postgresResolution.targets;
  const trackedFileIds = new Set(trackedTargets.map((target) => target.fileId));

  for (const target of trackedTargets) {
    try {
      await fsPromises.unlink(target.storedPath);
      removedFiles.push(target.storedName);
      await markUploadCleanupOutcome(target.fileId, 'deleted');
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
        skippedFiles.push(target.storedName);
        await markUploadCleanupOutcome(target.fileId, 'deleted');
        continue;
      }

      skippedFiles.push(target.storedName);
      await markUploadCleanupOutcome(
        target.fileId,
        'cleanup_failed',
        error instanceof Error ? error.message : 'Unknown file cleanup error',
      );
    }
  }

  const fallbackFileIds = new Set(
    docIds
      .map((docId) => getUploadFileIdForDocId(docId))
      .filter(Boolean) as string[],
  );

  for (const fileId of fallbackFileIds) {
    if (trackedFileIds.has(fileId)) {
      continue;
    }

    const remaining = await mlvsClient.query({
      collection_name: process.env.COLLECTION_NAME || 'llama_brains',
      filter: `doc_id like "${fileId}-chunk-%"`,
      output_fields: ['doc_id'],
      limit: 1,
    });

    const remainingDocs = Array.isArray(remaining)
      ? remaining
      : Array.isArray((remaining as any)?.data)
        ? (remaining as any).data
        : Array.isArray((remaining as any)?.results)
          ? (remaining as any).results
          : [];

    if (remainingDocs.length > 0) {
      skippedFiles.push(`${fileId}.pdf`);
      continue;
    }

    const uploadFilePath = getUploadFilePathForFileId(fileId);

    try {
      await fsPromises.unlink(uploadFilePath);
      removedFiles.push(`${fileId}.pdf`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
        skippedFiles.push(`${fileId}.pdf`);
        continue;
      }

      throw error;
    }
  }

  return {
    removedFiles,
    skippedFiles,
  };
};

/**
 *
 * @module controllers/VectorController
 * @description This module defines the controller functions for handling vector store operations such as ingesting documents, searching, and deleting. It uses the embedding service to generate embeddings and the Milvus adapter to interact with the Milvus vector database. The main functions are:
 * - `ingest`: Handles POST requests to ingest documents with text and optional source metadata. It generates embeddings for the texts and upserts them into Milvus.
 * - `search`: Handles POST requests to search for relevant documents based on a query string. It generates an embedding for the query, performs a vector search in Milvus, and returns the results along with a built context string.
 * - `deleteDocs`: Handles POST requests to delete documents from Milvus based on an array of document IDs.
 * - `readStore`: A debugging endpoint to read all documents in the collection.
 * - `askWithRag`: Handles POST requests to answer a question using Retrieval-Augmented Generation (RAG) by retrieving relevant documents and generating an answer with the AI client.
 *
 * Each function includes error handling and input validation to ensure robust operation. The module also includes helper functions like `buildContext` to format search results for RAG answer generation.
 */

/**
 * @function ingest
 * @description Ingests an array of documents into the vector store. Each document must have a `doc_id` and `text`, and can optionally include a `source`. The function generates embeddings for the texts and upserts them into Milvus. It returns the number of documents ingested/upserted.
 * @param {Request} req - The Express request object, expected to have a body with an `items` array of documents to ingest.
 * @param {Response} res - The Express response object used to send back the result or error messages.
 * @param {NextFunction} next - The Express next function for error handling.
 * @returns {Promise<void>} - A promise that resolves when the operation is complete.
 */
export const ingest = async (
  req: Request<{}, {}, {items: IngestItem[]}>,
  res: Response,
  next: NextFunction,
) => {
  try {
    const items: IngestItem[] = req.body?.items;

    if (!Array.isArray(items) || !items.length) {
      return res.status(400).json({message: 'items[] is required'});
    }
    if (items.some((i) => !i?.doc_id || !i?.text)) {
      return res
        .status(400)
        .json({message: 'Each item must have doc_id and text'});
    }

    const texts = items.map((i) => i.text);
    const embeddings = await Promise.all(texts.map((text) => embedTexts(text)));

    console.log('Generated embeddings for items:', embeddings.length);

    const docs: MilvusDoc[] = items.map((i, idx) => ({
      doc_id: i.doc_id,
      text: i.text,
      source: i.source ?? '',
      embedding: embeddings[idx],
    }));

    await upsertDocs(docs);

    // return the number of documents ingested/upserted for confirmation
    res.json({upserted: docs.length});
  } catch (err) {
    console.error('Error in ingest controller:', err);
    next(err);
  }
};

/**
 * @function search
 * @description Searches the vector store for relevant documents based on a query string. The function generates an embedding for the query, performs a vector search in Milvus, and returns the results along with a built context string. The `topK` parameter determines how many relevant documents to retrieve.
 * @param {Request} req - The Express request object, expected to have a body with a `query` string and an optional `topK` number.
 * @param {Response} res - The Express response object used to send back the search results or error messages.
 * @param {NextFunction} next - The Express next function for error handling.
 * @returns {Promise<void>} - A promise that resolves when the operation is complete.
 */
export const search = async (
  req: Request<{}, {}, VectorQuery>,
  res: Response,
  next: NextFunction,
) => {
  try {
    const query = req.body?.query;
    const tenantId = req.body?.tenant_id;
    const topK = Number(req.body?.topK ?? 5);

    if (!query || typeof query !== 'string') {
      return res.status(400).json({message: 'query (string) is required'});
    }
    if (!tenantId || typeof tenantId !== 'string') {
      return res.status(400).json({message: 'tenant_id (string) is required'});
    }

    const qEmb = await embedQuery(query);
    const rawResults = await vectorSearch(
      qEmb,
      tenantId,
      Number.isFinite(topK) ? topK : 5,
    );
    const results = rawResults.map((result) => withUploadLink(result, req));

    const context = buildContext(results);

    res.json({results, context});
  } catch (err) {
    next(err);
  }
};

/** * @function deleteDocs
 * @description Deletes documents from the vector store based on an array of document IDs. The function expects a body with a `doc_ids` array and deletes the corresponding documents from Milvus. It returns the number of documents deleted.
 * @param {Request} req - The Express request object, expected to have a body with a `doc_ids` array of strings representing the document IDs to delete.
 * @param {Response} res - The Express response object used to send back the result or error messages.
 * @param {NextFunction} next - The Express next function for error handling.
 * @returns {Promise<void>} - A promise that resolves when the operation is complete.
 */
export const deleteDocs = async (
  req: Request<{}, {}, {doc_ids: DocDeleteItem['doc_id'][]}>,
  res: Response,
  next: NextFunction,
) => {
  try {
    const docIds: string[] = req.body?.doc_ids;

    if (!Array.isArray(docIds) || !docIds.length) {
      return res.status(400).json({message: 'doc_ids[] is required'});
    }

    await deleteByDocIds(docIds);
    const uploadedFiles = await removeUploadedFilesForDocIds(docIds);

    res.json({
      deleted: docIds.length,
      removedUploads: uploadedFiles.removedFiles,
      skippedUploads: uploadedFiles.skippedFiles,
    });
  } catch (err) {
    next(err);
  }
};

// This endpoint is for debugging/testing purposes to read all documents in the collection.
/**
 * @function readStore
 * @description A debugging endpoint to read all documents in the vector store collection. It queries Milvus for all documents and returns them in the response. This is not intended for production use and should be protected or removed in a real deployment.
 * @param {Request} req - The Express request object.
 * @param {Response} res - The Express response object used to send back the documents or error messages.
 * @param {NextFunction} next - The Express next function for error handling.
 * @returns {Promise<void>} - A promise that resolves when the operation is complete.
 */
export const readStore = async (
  req: Request<{}, {}, {}, ReadQuery>,
  res: Response,
  next: NextFunction,
) => {
  try {
    const requestedPage = Number(req.query?.page ?? 1);
    const requestedLimit = Number(req.query?.limit ?? 20);
    const page =
      Number.isFinite(requestedPage) && requestedPage > 0
        ? Math.floor(requestedPage)
        : 1;
    const limit =
      Number.isFinite(requestedLimit) && requestedLimit > 0
        ? Math.min(Math.floor(requestedLimit), 100)
        : 20;
    const stats = await (mlvsClient as any).getCollectionStats({
      collection_name: process.env.COLLECTION_NAME || 'llama_brains',
    });

    const total = Number(
      (stats as any)?.data?.row_count ?? (stats as any)?.row_count ?? 0,
    );
    const totalPages = total > 0 ? Math.ceil(total / limit) : 1;
    const normalizedPage = Math.min(page, totalPages);
    const result = await mlvsClient.query({
      collection_name: process.env.COLLECTION_NAME || 'llama_brains',
      filter: 'doc_id != ""',
      output_fields: ['doc_id', 'text', 'source'],
      limit,
      offset: (normalizedPage - 1) * limit,
    });

    const documents = Array.isArray(result)
      ? result
      : Array.isArray((result as any)?.data)
        ? (result as any).data
        : Array.isArray((result as any)?.results)
          ? (result as any).results
          : [];

    res.json({
      documents,
      pagination: {
        page: normalizedPage,
        limit,
        total,
        totalPages,
        hasMore: normalizedPage * limit < total,
      },
    });
  } catch (err) {
    next(err);
  }
};

// This function builds a context string from the search results to be used in the RAG answer generation step.
/**
 * @function buildContext
 * @description Builds a context string from an array of search results. Each result is formatted with its source and content, and the function limits the number of results included in the context based on the `maxChunks` parameter. If no results are provided, it returns a message indicating that no relevant context was found.
 * @param {SearchResult[]} results - An array of search results to build the context from.
 * @param {number} maxChunks - The maximum number of search results to include in the context (default is 5).
 * @returns {string} - A formatted context string built from the search results.
 */
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
/**
 * @function generateRagAnswer
 * @description Generates an answer to a question using Retrieval-Augmented Generation (RAG) based on the provided context. It sends a request to the AI client with a system prompt that instructs it to answer concisely and accurately based only on the given information. If the context is insufficient to fully answer the question, the AI is instructed to indicate what is missing without mentioning "context" or "sources".
 * @param {string} question - The question to answer.
 * @param {string} context - The context information retrieved from the vector store to use for answering the question.
 * @returns {Promise<string>} - A promise that resolves to the generated answer from the AI client.
 */
export const generateRagAnswer = async (question: string, context: string) => {
  const res = await fetch('http://localhost:11434/api/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: process.env.COMPLETION_MODEL || 'mistral',
      messages: [
        {
          role: 'system',
          content: [
            'You are a helpful assistant answering questions based only on the information I give you.',
            'Provide concise and accurate answers.',
            ,
            'Answer as if you already know the information.',
            'If the information is insufficient, say briefly what is missing.',
            'Do not say "based on the context/sources" or mention the sources in your answer.',
          ].join(' '),
        },
        {
          role: 'user',
          content: `Here is some information:\n${context}\n\nQuestion: ${question}`,
        },
      ],
      stream: false,
    }),
  });

  const data = await res.json();

  return data.message.content;
};

/**
 * @function askWithRag
 * @description Handles a POST request to answer a question using Retrieval-Augmented Generation (RAG). It takes a query and an optional topK parameter from the request body, retrieves relevant documents from the vector store, builds a context string, and generates an answer using the AI client. The response includes the generated answer and the sources used for answering.
 * @param {Request} req - The Express request object, expected to have a body with a `query` string and an optional `topK` number.
 * @param {Response} res - The Express response object used to send back the generated answer and sources or error messages.
 * @param {NextFunction} next - The Express next function for error handling.
 * @returns {Promise<void>} - A promise that resolves when the operation is complete.
 */
export const askWithRag = async (
  req: Request<{}, {}, VectorQuery>,
  res: Response,
  next: NextFunction,
) => {
  try {
    // topK means how many relevant documents to retrieve from the vector store to build the context for answering the question. Right now defaulted to 5.
    const {query, tenant_id: tenantId, topK = 5} = req.body;

    if (!query || typeof query !== 'string') {
      return res.status(400).json({message: 'query (string) is required'});
    }
    if (!tenantId || typeof tenantId !== 'string') {
      return res.status(400).json({message: 'tenant_id (string) is required'});
    }

    const queryEmbedding = await embedQuery(query);
    const rawResults = await vectorSearch(queryEmbedding, tenantId, topK);
    const results = rawResults.map((result) => withUploadLink(result, req));
    const context = buildContext(results);
    const answer = await generateRagAnswer(query, context);

    res.json({
      answer,
      sources: results.map((r: SearchResult) => ({
        doc_id: r.doc_id,
        source: r.source,
        score: r.score,
        upload_link: r.upload_link,
      })),
    });
  } catch (err) {
    next(err);
  }
};
