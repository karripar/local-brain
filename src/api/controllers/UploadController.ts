import path from 'node:path';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import {Request, Response, NextFunction} from 'express';
import multer from 'multer';
import CustomError from '../../classes/CustomError';
import {
  extractPdfText,
  chunkTextByWords,
  ensureUploadsDir,
} from '../services/pdfChunkService';
import {embedTexts} from '../services/embeddingService';
import {upsertDocs} from '../services/milvusAdapter';
import {MilvusDoc} from '../../types/MilvusTypes';

const MAX_PDF_SIZE_BYTES = 20 * 1024 * 1024;

const sanitizeBaseName = (fileName: string) => {
  const withoutExt = path.basename(fileName, path.extname(fileName));
  const cleaned = withoutExt.replace(/[^a-zA-Z0-9-_]/g, '_').slice(0, 80);
  return cleaned || 'document';
};

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const uploadDir = ensureUploadsDir();
    cb(null, uploadDir);
  },
  filename: (_req, file, cb) => {
    const baseName = sanitizeBaseName(file.originalname);
    const generatedName = `${Date.now()}-${crypto.randomUUID()}-${baseName}.pdf`;
    cb(null, generatedName);
  },
});

const pdfOnlyFilter: multer.Options['fileFilter'] = (_req, file, cb) => {
  const isPdf =
    file.mimetype === 'application/pdf' ||
    file.originalname.toLowerCase().endsWith('.pdf');

  if (!isPdf) {
    cb(new CustomError('Only PDF files are allowed', 400));
    return;
  }

  cb(null, true);
};

export const uploadPdf = multer({
  storage,
  fileFilter: pdfOnlyFilter,
  limits: {fileSize: MAX_PDF_SIZE_BYTES},
}).single('file');

export const ingestUploadedPdf = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const file = (req as Request & {file?: Express.Multer.File}).file;
    if (!file) {
      return res
        .status(400)
        .json({message: 'PDF file is required in field "file"'});
    }

    const chunkSize = Number(req.body?.chunkSize ?? 800);
    const chunkOverlap = Number(req.body?.chunkOverlap ?? 120);

    if (!Number.isFinite(chunkSize) || chunkSize < 50) {
      return res
        .status(400)
        .json({message: 'chunkSize must be a number >= 50'});
    }
    if (!Number.isFinite(chunkOverlap) || chunkOverlap < 0) {
      return res
        .status(400)
        .json({message: 'chunkOverlap must be a number >= 0'});
    }

    const fileBuffer = await fs.readFile(file.path);
    const extractedText = await extractPdfText(fileBuffer);

    if (!extractedText) {
      return res
        .status(400)
        .json({message: 'The uploaded PDF contains no extractable text'});
    }

    const chunks = chunkTextByWords(extractedText, chunkSize, chunkOverlap);

    if (!chunks.length) {
      return res
        .status(400)
        .json({message: 'No chunks could be created from the uploaded PDF'});
    }

    const embeddings = await Promise.all(
      chunks.map((chunk) => embedTexts(chunk)),
    );

    const source =
      typeof req.body?.source === 'string' && req.body.source.trim()
        ? req.body.source.trim()
        : file.originalname;

    const fileId = path.basename(file.filename, path.extname(file.filename));

    const docs: MilvusDoc[] = chunks.map((chunk, idx) => ({
      doc_id: `${fileId}-chunk-${idx + 1}`,
      text: chunk,
      source,
      embedding: embeddings[idx],
    }));

    await upsertDocs(docs);

    const storedPath = path.join('uploads', file.filename).replace(/\\/g, '/');

    res.status(201).json({
      message: 'PDF uploaded, chunked, embedded, and stored successfully',
      file: {
        originalName: file.originalname,
        storedAs: file.filename,
        path: storedPath,
        sizeBytes: file.size,
      },
      chunks: docs.length,
      upserted: docs.length,
      source,
    });
  } catch (err) {
    next(err);
  }
};
