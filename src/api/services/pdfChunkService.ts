import path from 'node:path';
import fs from 'node:fs';
import pdfParse from 'pdf-parse';

const DEFAULT_CHUNK_SIZE = 800;
const DEFAULT_CHUNK_OVERLAP = 120;
const PROJECT_ROOT = process.cwd();
const UPLOADS_DIR = path.join(PROJECT_ROOT, 'uploads');

export const ensureUploadsDir = () => {
  if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, {recursive: true});
  }
  return UPLOADS_DIR;
};

export const getUploadsDir = () => UPLOADS_DIR;

export const extractPdfText = async (fileBuffer: Buffer) => {
  const parsed = await pdfParse(fileBuffer);
  const text = parsed.text ?? '';

  return text.replace(/\s+/g, ' ').trim();
};

export const chunkTextByWords = (
  text: string,
  chunkSize: number = DEFAULT_CHUNK_SIZE,
  chunkOverlap: number = DEFAULT_CHUNK_OVERLAP,
) => {
  if (!text.trim()) {
    return [];
  }

  const words = text.trim().split(/\s+/);

  const safeChunkSize = Number.isFinite(chunkSize) && chunkSize > 0
    ? Math.floor(chunkSize)
    : DEFAULT_CHUNK_SIZE;
  const safeChunkOverlap = Number.isFinite(chunkOverlap) && chunkOverlap >= 0
    ? Math.floor(chunkOverlap)
    : DEFAULT_CHUNK_OVERLAP;

  const overlap = Math.min(safeChunkOverlap, Math.max(safeChunkSize - 1, 0));
  const step = Math.max(safeChunkSize - overlap, 1);

  const chunks: string[] = [];

  for (let start = 0; start < words.length; start += step) {
    const end = Math.min(start + safeChunkSize, words.length);
    const chunk = words.slice(start, end).join(' ').trim();

    if (chunk) {
      chunks.push(chunk);
    }

    if (end >= words.length) {
      break;
    }
  }

  return chunks;
};
