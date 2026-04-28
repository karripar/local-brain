import {Pool} from 'pg';
import path from 'node:path';

export type UploadMetadataRecord = {
  fileId: string;
  originalName: string;
  storedName: string;
  storedPath: string;
  source: string;
  sizeBytes: number;
  chunkCount: number;
  docIds: string[];
};

export type UploadCleanupTarget = {
  fileId: string;
  originalName: string;
  storedName: string;
  storedPath: string;
  source: string;
  sizeBytes: number;
  chunkCount: number;
};

export type UploadCleanupResolution = {
  enabled: boolean;
  targets: UploadCleanupTarget[];
};

export type UploadCleanupOutcome = 'deleted' | 'cleanup_failed';

const UPLOAD_FILES_TABLE = 'upload_files';
const UPLOAD_CHUNKS_TABLE = 'upload_chunks';

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL?.trim() || undefined,
  host: process.env.POSTGRES_HOST?.trim() || process.env.PGHOST?.trim(),
  port: Number(process.env.POSTGRES_PORT || process.env.PGPORT || 5432),
  user: process.env.POSTGRES_USER?.trim() || process.env.PGUSER?.trim(),
  password:
    process.env.POSTGRES_PASSWORD?.trim() || process.env.PGPASSWORD?.trim(),
  database:
    process.env.POSTGRES_DATABASE?.trim() ||
    process.env.POSTGRES_DB?.trim() ||
    process.env.PGDATABASE?.trim(),
});

let initialized = false;
let disabled = false;

const isReady = () => initialized && !disabled;

const buildStoredPath = (storedName: string) =>
  path.join('uploads', storedName).replace(/\\/g, '/');

const getFileIdFromDocId = (docId: string) => {
  const match = docId.match(/^(.*)-chunk-\d+$/);
  return match?.[1];
};

export const initializeUploadMetadataStore = async () => {
  if (initialized || disabled) {
    return initialized;
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query(`
      CREATE TABLE IF NOT EXISTS ${UPLOAD_FILES_TABLE} (
        file_id text PRIMARY KEY,
        original_name text NOT NULL,
        stored_name text NOT NULL,
        stored_path text NOT NULL,
        source text NOT NULL,
        size_bytes bigint NOT NULL,
        chunk_count integer NOT NULL,
        cleanup_status text NOT NULL DEFAULT 'active',
        last_error text,
        created_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS ${UPLOAD_CHUNKS_TABLE} (
        doc_id text PRIMARY KEY,
        file_id text NOT NULL REFERENCES ${UPLOAD_FILES_TABLE}(file_id) ON DELETE CASCADE,
        chunk_index integer NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await client.query('COMMIT');
    initialized = true;
    return true;
  } catch (error) {
    await client.query('ROLLBACK');
    disabled = true;
    console.warn('PostgreSQL metadata store is unavailable:', error);
    return false;
  } finally {
    client.release();
  }
};

export const recordUploadMetadata = async (record: UploadMetadataRecord) => {
  if (!(await initializeUploadMetadataStore())) {
    return false;
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query(
      `
        INSERT INTO ${UPLOAD_FILES_TABLE} (
          file_id,
          original_name,
          stored_name,
          stored_path,
          source,
          size_bytes,
          chunk_count,
          cleanup_status,
          last_error,
          created_at,
          deleted_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', NULL, now(), NULL)
        ON CONFLICT (file_id) DO UPDATE SET
          original_name = EXCLUDED.original_name,
          stored_name = EXCLUDED.stored_name,
          stored_path = EXCLUDED.stored_path,
          source = EXCLUDED.source,
          size_bytes = EXCLUDED.size_bytes,
          chunk_count = EXCLUDED.chunk_count,
          cleanup_status = 'active',
          last_error = NULL,
          deleted_at = NULL
      `,
      [
        record.fileId,
        record.originalName,
        record.storedName,
        record.storedPath,
        record.source,
        record.sizeBytes,
        record.chunkCount,
      ],
    );

    await client.query(
      `DELETE FROM ${UPLOAD_CHUNKS_TABLE} WHERE file_id = $1`,
      [record.fileId],
    );

    for (const [index, docId] of record.docIds.entries()) {
      await client.query(
        `
          INSERT INTO ${UPLOAD_CHUNKS_TABLE} (doc_id, file_id, chunk_index)
          VALUES ($1, $2, $3)
          ON CONFLICT (doc_id) DO UPDATE SET
            file_id = EXCLUDED.file_id,
            chunk_index = EXCLUDED.chunk_index
        `,
        [docId, record.fileId, index + 1],
      );
    }

    await client.query('COMMIT');
    return true;
  } catch (error) {
    await client.query('ROLLBACK');
    console.warn('Failed to record upload metadata:', error);
    return false;
  } finally {
    client.release();
  }
};

export const resolveUploadCleanupTargets = async (docIds: string[]) => {
  if (!docIds.length) {
    return {
      enabled: isReady(),
      targets: [],
    } satisfies UploadCleanupResolution;
  }

  if (!(await initializeUploadMetadataStore())) {
    const fallbackTargets = Array.from(
      new Set(
        docIds
          .map((docId) => getFileIdFromDocId(docId))
          .filter(Boolean) as string[],
      ),
    ).map((fileId) => ({
      fileId,
      originalName: `${fileId}.pdf`,
      storedName: `${fileId}.pdf`,
      storedPath: buildStoredPath(`${fileId}.pdf`),
      source: `${fileId}.pdf`,
      sizeBytes: 0,
      chunkCount: 0,
    }));

    return {
      enabled: false,
      targets: fallbackTargets,
    } satisfies UploadCleanupResolution;
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const touchedFiles = await client.query(
      `
        SELECT DISTINCT file_id
        FROM ${UPLOAD_CHUNKS_TABLE}
        WHERE doc_id = ANY($1::text[])
      `,
      [docIds],
    );

    if (!touchedFiles.rowCount) {
      await client.query('COMMIT');
      return {
        enabled: true,
        targets: [],
      } satisfies UploadCleanupResolution;
    }

    await client.query(
      `DELETE FROM ${UPLOAD_CHUNKS_TABLE} WHERE doc_id = ANY($1::text[])`,
      [docIds],
    );

    const targets: UploadCleanupTarget[] = [];

    for (const row of touchedFiles.rows as Array<{file_id: string}>) {
      const remaining = await client.query(
        `
          SELECT COUNT(*)::int AS remaining
          FROM ${UPLOAD_CHUNKS_TABLE}
          WHERE file_id = $1
        `,
        [row.file_id],
      );

      if ((remaining.rows[0]?.remaining ?? 0) === 0) {
        const record = await client.query(
          `
            SELECT
              file_id,
              original_name,
              stored_name,
              stored_path,
              source,
              size_bytes,
              chunk_count
            FROM ${UPLOAD_FILES_TABLE}
            WHERE file_id = $1
          `,
          [row.file_id],
        );

        if (record.rowCount) {
          targets.push(record.rows[0] as UploadCleanupTarget);
        }
      }
    }

    await client.query('COMMIT');
    return {
      enabled: true,
      targets,
    } satisfies UploadCleanupResolution;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

export const markUploadCleanupOutcome = async (
  fileId: string,
  outcome: UploadCleanupOutcome,
  errorMessage?: string,
) => {
  if (!(await initializeUploadMetadataStore())) {
    return false;
  }

  try {
    await pool.query(
      `
        UPDATE ${UPLOAD_FILES_TABLE}
        SET cleanup_status = $2,
            last_error = $3,
            deleted_at = CASE WHEN $2 = 'deleted' THEN now() ELSE deleted_at END
        WHERE file_id = $1
      `,
      [fileId, outcome, errorMessage ?? null],
    );
    return true;
  } catch (error) {
    console.warn('Failed to update upload cleanup status:', error);
    return false;
  }
};
