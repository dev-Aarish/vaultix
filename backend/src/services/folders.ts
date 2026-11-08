import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { FolderRow } from '../db/rows';
import { notFound } from '../lib/errors';

export interface PublicFolder {
  id: string;
  parentFolderId: string | null;
  name: string;
  status: FolderRow['status'];
  createdAt: string;
  updatedAt: string;
}

export interface CreateFolderInput {
  name: string;
  parentFolderId?: string | null;
  createdBy: string;
}

export interface FolderFilters {
  parentFolderId?: string;
  limit: number;
  offset: number;
}

export function toPublicFolder(row: FolderRow): PublicFolder {
  return {
    id: row.id,
    parentFolderId: row.parent_folder_id,
    name: row.name,
    status: row.status,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export class FolderService {
  constructor(private readonly pool: Pool) {}

  async create(input: CreateFolderInput): Promise<FolderRow> {
    if (input.parentFolderId) {
      const parent = await this.findById(input.parentFolderId);
      if (!parent || parent.status !== 'ACTIVE') {
        throw notFound('Parent folder not found');
      }
    }

    const result = await this.pool.query<FolderRow>(
      `INSERT INTO folders (id, parent_folder_id, name, created_by)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [randomUUID(), input.parentFolderId ?? null, input.name, input.createdBy],
    );
    const folder = result.rows[0];
    if (!folder) throw new Error('Failed to create folder');
    return folder;
  }

  async findById(id: string): Promise<FolderRow | null> {
    const result = await this.pool.query<FolderRow>('SELECT * FROM folders WHERE id = $1', [id]);
    return result.rows[0] ?? null;
  }

  async listChildren(parentFolderId: string | null): Promise<FolderRow[]> {
    const result = await this.pool.query<FolderRow>(
      parentFolderId === null
        ? `SELECT * FROM folders
           WHERE parent_folder_id IS NULL AND status = 'ACTIVE'
           ORDER BY lower(name), id`
        : `SELECT * FROM folders
           WHERE parent_folder_id = $1 AND status = 'ACTIVE'
           ORDER BY lower(name), id`,
      parentFolderId === null ? [] : [parentFolderId],
    );
    return result.rows;
  }

  async chain(folderId: string): Promise<FolderRow[]> {
    const result = await this.pool.query<FolderRow>(
      `WITH RECURSIVE ancestors AS (
         SELECT f.*, 0 AS depth FROM folders f WHERE f.id = $1
         UNION ALL
         SELECT f.*, a.depth + 1
         FROM folders f
         JOIN ancestors a ON f.id = a.parent_folder_id
         WHERE a.depth < 64
       )
       SELECT id, parent_folder_id, name, status, created_by, created_at, updated_at
       FROM ancestors
       ORDER BY depth`,
      [folderId],
    );
    return result.rows;
  }

  async list(filters: FolderFilters): Promise<{ items: FolderRow[]; total: number }> {
    const conditions: string[] = [];
    const values: unknown[] = [];

    if (filters.parentFolderId) {
      values.push(filters.parentFolderId);
      conditions.push(`parent_folder_id = $${values.length}`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = await this.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM folders ${where}`,
      values,
    );

    values.push(filters.limit, filters.offset);
    const itemsResult = await this.pool.query<FolderRow>(
      `SELECT * FROM folders ${where}
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
