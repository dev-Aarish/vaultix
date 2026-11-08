import express, { Router } from 'express';
import { z } from 'zod';
import type { AppContext } from '../context';
import { badRequest, notFound } from '../lib/errors';
import { getAuth, requireAdmin, requireAuth } from '../middleware/auth';
import { getClientIp, parse, parseBody, parseQuery } from '../middleware/validate';
import { toPublicFile } from '../services/files';
import { toPublicFolder } from '../services/folders';

const paginationFields = {
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
};

const createFolderSchema = z.strictObject({
  name: z.string().trim().min(1).max(255),
  parentFolderId: z.uuid().nullable().optional(),
});

const folderListSchema = z.object({
  parentFolderId: z.uuid().optional(),
  ...paginationFields,
});

const fileListSchema = z.object({
  folderId: z.uuid().optional(),
  ...paginationFields,
});

const mimeTypeSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*\/[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*$/,
    'Must be a valid MIME type',
  );

const uploadQuerySchema = z.strictObject({
  name: z.string().trim().min(1).max(255),
  folderId: z.uuid().optional(),
  mimeType: mimeTypeSchema.default('application/octet-stream'),
});

const idSchema = z.uuid();

export function adminFilesRouter(ctx: AppContext): Router {
  const router = Router();
  router.use(requireAuth(ctx), requireAdmin(ctx));

  router.post('/folders', async (req, res) => {
    const body = parseBody(createFolderSchema, req);
    const folder = await ctx.folders.create({
      name: body.name,
      parentFolderId: body.parentFolderId ?? null,
      createdBy: getAuth(req).user.id,
    });

    await ctx.audit.record({
      actorUserId: getAuth(req).user.id,
      eventType: 'FOLDER_CREATE',
      result: 'SUCCESS',
      resourceType: 'FOLDER',
      resourceId: folder.id,
      ipAddress: getClientIp(req),
      metadata: { name: folder.name, parentFolderId: folder.parent_folder_id },
    });

    res.status(201).json({ data: { folder: toPublicFolder(folder) } });
  });

  router.get('/folders', async (req, res) => {
    const filters = parseQuery(folderListSchema, req);
    const { items, total } = await ctx.folders.list(filters);
    res.json({
      data: items.map(toPublicFolder),
      pagination: { total, limit: filters.limit, offset: filters.offset },
    });
  });

  router.post(
    '/files',
    express.raw({ type: () => true, limit: ctx.config.maxUploadBytes }),
    async (req, res) => {
      const query = parseQuery(uploadQuerySchema, req);
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
        throw badRequest('EMPTY_UPLOAD', 'Upload body is empty');
      }
      if (req.body.length > ctx.config.maxUploadBytes) {
        throw badRequest('PAYLOAD_TOO_LARGE', 'Upload exceeds the maximum file size');
      }

      const file = await ctx.files.upload({
        name: query.name,
        folderId: query.folderId ?? null,
        mimeType: query.mimeType,
        data: req.body,
        createdBy: getAuth(req).user.id,
      });

      await ctx.audit.record({
        actorUserId: getAuth(req).user.id,
        eventType: 'FILE_UPLOAD',
        result: 'SUCCESS',
        resourceType: 'FILE',
        resourceId: file.id,
        ipAddress: getClientIp(req),
        metadata: {
          name: file.original_name,
          folderId: file.folder_id,
          sizeBytes: file.size_bytes,
          mimeType: file.mime_type,
        },
      });

      res.status(201).json({ data: { file: toPublicFile(file) } });
    },
  );

  router.get('/files', async (req, res) => {
    const filters = parseQuery(fileListSchema, req);
    const { items, total } = await ctx.files.list(filters);
    res.json({
      data: items.map(toPublicFile),
      pagination: { total, limit: filters.limit, offset: filters.offset },
    });
  });

  router.get('/files/:id', async (req, res) => {
    const id = parse(idSchema, req.params.id);
    const file = await ctx.files.findById(id);
    if (!file) throw notFound('File not found');
    res.json({ data: { file: toPublicFile(file) } });
  });

  return router;
}
