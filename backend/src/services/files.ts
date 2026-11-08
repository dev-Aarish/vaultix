import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { FileRow } from '../db/rows';
import { notFound } from '../lib/errors';
import type { FileCryptoService } from './file-crypto';
import type { FileStorage } from './file-storage';
import type { FolderService } from './folders';

export interface PublicFile {
  id: string;
  folderId: string | null;
  name: string;
  mimeType: string;
  sizeBytes: number;
  checksum: string;
  status: FileRow['status'];
  createdAt: string;
  updatedAt: string;
}

export interface UploadFileInput {
  name: string;
  folderId?: string | null;
  mimeType: string;
  data: Buffer;
  createdBy: string;
}

export interface FileFilters {
  folderId?: string;
  limit: number;
  offset: number;
}

export function toPublicFile(row: FileRow): PublicFile {
  return {
    id: row.id,
    folderId: row.folder_id,
    name: row.original_name,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes),
    checksum: row.checksum,
    status: row.status,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export class FileService {
  constructor(
    private readonly pool: Pool,
    private readonly storage: FileStorage,
    private readonly crypto: FileCryptoService,
    private readonly folders: FolderService,
  ) {}

  async upload(input: UploadFileInput): Promise<FileRow> {
    if (input.folderId) {
      const folder = await this.folders.findById(input.folderId);
      if (!folder || folder.status !== 'ACTIVE') {
        throw notFound('Folder not found');
      }
    }

    const encrypted = this.crypto.encryptFile(input.data);
    const storageObjectKey = `objects/${randomUUID()}`;
    await this.storage.put(storageObjectKey, encrypted.ciphertext);

    try {
      const result = await this.pool.query<FileRow>(
        `INSERT INTO files
           (id, folder_id, original_name, mime_type, size_bytes, checksum, storage_object_key,
            encryption_algorithm, encryption_iv, encryption_auth_tag, encryption_key_reference, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'AES-256-GCM', $8, $9, $10, $11)
         RETURNING *`,
        [
          randomUUID(),
          input.folderId ?? null,
          input.name,
          input.mimeType,
          input.data.length,
          encrypted.checksum,
          storageObjectKey,
          encrypted.iv,
          encrypted.authTag,
          encrypted.keyReference,
          input.createdBy,
        ],
      );
      const file = result.rows[0];
      if (!file) throw new Error('Failed to store file');
      return file;
    } catch (error) {
      await this.storage.delete(storageObjectKey).catch(() => undefined);
      throw error;
    }
  }

  async findById(id: string): Promise<FileRow | null> {
    const result = await this.pool.query<FileRow>('SELECT * FROM files WHERE id = $1', [id]);
    return result.rows[0] ?? null;
  }

  async listByFolder(folderId: string | null): Promise<FileRow[]> {
    const result = await this.pool.query<FileRow>(
      folderId === null
        ? `SELECT * FROM files
           WHERE folder_id IS NULL AND status = 'ACTIVE'
           ORDER BY lower(original_name), id`
        : `SELECT * FROM files
           WHERE folder_id = $1 AND status = 'ACTIVE'
           ORDER BY lower(original_name), id`,
      folderId === null ? [] : [folderId],
    );
    return result.rows;
  }

  async decrypt(row: FileRow): Promise<Buffer> {
    const ciphertext = await this.storage.get(row.storage_object_key);
    return this.crypto.decryptFile({
      ciphertext,
      iv: row.encryption_iv,
      authTag: row.encryption_auth_tag,
      keyReference: row.encryption_key_reference,
      checksum: row.checksum,
    });
  }

  async list(filters: FileFilters): Promise<{ items: FileRow[]; total: number }> {
    const conditions: string[] = [];
    const values: unknown[] = [];

    if (filters.folderId) {
      values.push(filters.folderId);
      conditions.push(`folder_id = $${values.length}`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = await this.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM files ${where}`,
      values,
    );

    values.push(filters.limit, filters.offset);
    const itemsResult = await this.pool.query<FileRow>(
      `SELECT * FROM files ${where}
       ORDER BY created_at DESC, id DESC
       LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values,
    );

    return {
      items: itemsResult.rows,
      total: Number(countResult.rows[0]?.count ?? 0),
    };
  }
}
