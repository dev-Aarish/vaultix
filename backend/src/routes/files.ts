import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import type { AppContext } from '../context';
import type { FileRow, FolderRow, PermissionAction } from '../db/rows';
import { notFound } from '../lib/errors';
import { getAuth, requireAuth } from '../middleware/auth';
import { getClientIp, parse, parseQuery } from '../middleware/validate';
import {
  allowedActions,
  allows,
  type ResourceRef,
} from '../services/authorization';
import { toPublicFile } from '../services/files';
import { toPublicFolder } from '../services/folders';
import { requireDeviceBound } from './devices';

const browseSchema = z.object({
  folderId: z.uuid().optional(),
});

const contentQuerySchema = z.object({
  download: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
});

const idSchema = z.uuid();

interface BrowseFolderItem {
  type: 'FOLDER';
  id: string;
  name: string;
  parentFolderId: string | null;
  createdAt: string;
  updatedAt: string;
  allowedActions: PermissionAction[];
}

interface BrowseFileItem {
  type: 'FILE';
  id: string;
  name: string;
  folderId: string | null;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  updatedAt: string;
  allowedActions: PermissionAction[];
}

function folderChainRefs(chain: FolderRow[]): ResourceRef[] {
  return chain.map((folder) => ({ type: 'FOLDER', id: folder.id }));
}

function fileChain(file: FileRow, parentChain: ResourceRef[]): ResourceRef[] {
  return [{ type: 'FILE', id: file.id }, ...parentChain];
}

export function fileRouter(ctx: AppContext): Router {
  const router = Router();
  router.use(requireAuth(ctx), requireDeviceBound(ctx));

  router.get('/', async (req, res) => {
    const query = parseQuery(browseSchema, req);
    const auth = getAuth(req);
    const deviceId = auth.session.device_id;

    let parentChain: ResourceRef[] = [];
    let currentFolder: FolderRow | null = null;
    let breadcrumbs: FolderRow[] = [];
    const decisions = await ctx.authorization.loadDecisions(auth.user.id, deviceId);

    if (query.folderId) {
      const folder = await ctx.folders.findById(query.folderId);
      if (!folder || folder.status !== 'ACTIVE') throw notFound('Folder not found');

      const chain = await ctx.folders.chain(folder.id);
      if (chain[0]?.status !== 'ACTIVE') throw notFound('Folder not found');

      const decision = ctx.authorization.resolve(decisions, folderChainRefs(chain), deviceId);
      if (!allows(decision, ['VIEW'])) {
        await ctx.audit.record({
          actorUserId: auth.user.id,
          deviceId,
          eventType: 'FILE_ACCESS',
          result: 'DENIED',
          reasonCode: decision.reason ?? 'NO_PERMISSION',
          resourceType: 'FOLDER',
          resourceId: folder.id,
          ipAddress: getClientIp(req),
          metadata: { operation: 'LIST' },
        });
        throw notFound('Folder not found');
      }

      currentFolder = folder;
      parentChain = folderChainRefs(chain);
      breadcrumbs = [...chain].reverse();
    }

    const [folders, files] = await Promise.all([
      ctx.folders.listChildren(query.folderId ?? null),
      ctx.files.listByFolder(query.folderId ?? null),
    ]);

    const folderItems: BrowseFolderItem[] = [];
    for (const folder of folders) {
      const decision = ctx.authorization.resolve(
        decisions,
        [{ type: 'FOLDER', id: folder.id }, ...parentChain],
        deviceId,
      );
      if (!allows(decision, ['VIEW'])) continue;
      folderItems.push({
        type: 'FOLDER',
        id: folder.id,
        name: folder.name,
        parentFolderId: folder.parent_folder_id,
        createdAt: folder.created_at.toISOString(),
        updatedAt: folder.updated_at.toISOString(),
        allowedActions: allowedActions(decision),
      });
    }

    const fileItems: BrowseFileItem[] = [];
    for (const file of files) {
      const decision = ctx.authorization.resolve(
        decisions,
        fileChain(file, parentChain),
        deviceId,
      );
      if (!allows(decision, ['VIEW'])) continue;
      fileItems.push({
        type: 'FILE',
        id: file.id,
        name: file.original_name,
        folderId: file.folder_id,
        mimeType: file.mime_type,
        sizeBytes: Number(file.size_bytes),
        createdAt: file.created_at.toISOString(),
        updatedAt: file.updated_at.toISOString(),
        allowedActions: allowedActions(decision),
      });
    }

    res.json({
      data: {
        folder: currentFolder ? toPublicFolder(currentFolder) : null,
        breadcrumbs: breadcrumbs.map(toPublicFolder),
        items: [...folderItems, ...fileItems],
      },
    });
  });

  router.get('/:id/metadata', async (req, res) => {
    const id = parse(idSchema, req.params.id);
    const auth = getAuth(req);
    const deviceId = auth.session.device_id;

    const file = await ctx.files.findById(id);
    if (!file || file.status !== 'ACTIVE') throw notFound('File not found');

    const parentChain = await parentChainFor(ctx, file);
    const decisions = await ctx.authorization.loadDecisions(auth.user.id, deviceId);
    const decision = ctx.authorization.resolve(decisions, fileChain(file, parentChain), deviceId);
    if (!allows(decision, ['VIEW'])) {
      await ctx.audit.record({
        actorUserId: auth.user.id,
        deviceId,
        eventType: 'FILE_ACCESS',
        result: 'DENIED',
        reasonCode: decision.reason ?? 'NO_PERMISSION',
        resourceType: 'FILE',
        resourceId: file.id,
        ipAddress: getClientIp(req),
        metadata: { operation: 'METADATA' },
      });
      throw notFound('File not found');
    }

    res.setHeader('Cache-Control', 'no-store');
    res.json({
      data: {
        file: toPublicFile(file),
        breadcrumbs: (await breadcrumbsFor(ctx, file)).map(toPublicFolder),
        allowedActions: allowedActions(decision),
      },
    });
  });

  router.post('/:id/open', async (req, res) => {
    const id = parse(idSchema, req.params.id);
    const auth = getAuth(req);
    const deviceId = auth.session.device_id;

    const file = await ctx.files.findById(id);
    if (!file || file.status !== 'ACTIVE') throw notFound('File not found');

    const parentChain = await parentChainFor(ctx, file);
    const decisions = await ctx.authorization.loadDecisions(auth.user.id, deviceId);
    const decision = ctx.authorization.resolve(decisions, fileChain(file, parentChain), deviceId);
    if (!allows(decision, ['VIEW'])) {
      await ctx.audit.record({
        actorUserId: auth.user.id,
        deviceId,
        eventType: 'FILE_ACCESS',
        result: 'DENIED',
        reasonCode: decision.reason ?? 'NO_PERMISSION',
        resourceType: 'FILE',
        resourceId: file.id,
        ipAddress: getClientIp(req),
        metadata: { operation: 'OPEN' },
      });
      throw notFound('File not found');
    }

    const device = deviceId ? await ctx.devices.findById(deviceId) : null;
    const shortFingerprint = device?.key_fingerprint
      ? (device.key_fingerprint.length <= 16
          ? device.key_fingerprint
          : `${device.key_fingerprint.slice(0, 16)}...`)
      : 'DEVICE-BOUND';

    await ctx.audit.record({
      actorUserId: auth.user.id,
      deviceId,
      eventType: 'FILE_ACCESS',
      result: 'SUCCESS',
      resourceType: 'FILE',
      resourceId: file.id,
      ipAddress: getClientIp(req),
      metadata: { operation: 'OPEN', mimeType: file.mime_type, sizeBytes: file.size_bytes },
    });

    res.setHeader('Cache-Control', 'no-store');
    res.json({
      data: {
        viewSessionId: randomUUID(),
        file: toPublicFile(file),
        watermark: {
          userName: auth.user.name,
          userEmail: auth.user.email,
          deviceName: device?.device_name ?? 'Approved Android device',
          deviceFingerprint: shortFingerprint,
          classification: 'CONFIDENTIAL • RESTRICTED',
          timestamp: new Date().toISOString(),
        },
        inactivityTimeoutSeconds: 60,
      },
    });
  });

  router.get('/:id/content', async (req, res) => {
    const id = parse(idSchema, req.params.id);
    const query = parseQuery(contentQuerySchema, req);
    const auth = getAuth(req);
    const deviceId = auth.session.device_id;
    const action: PermissionAction = query.download ? 'DOWNLOAD' : 'VIEW';

    const file = await ctx.files.findById(id);
    if (!file || file.status !== 'ACTIVE') throw notFound('File not found');

    const parentChain = await parentChainFor(ctx, file);
    const decisions = await ctx.authorization.loadDecisions(auth.user.id, deviceId);
    const decision = ctx.authorization.resolve(decisions, fileChain(file, parentChain), deviceId);
    if (!allows(decision, [action])) {
      await ctx.audit.record({
        actorUserId: auth.user.id,
        deviceId,
        eventType: 'FILE_ACCESS',
        result: 'DENIED',
        reasonCode: decision.reason ?? 'NO_PERMISSION',
        resourceType: 'FILE',
        resourceId: file.id,
        ipAddress: getClientIp(req),
        metadata: { operation: 'CONTENT', action },
      });
      throw notFound('File not found');
    }

    const plaintext = await ctx.files.decrypt(file);
    await ctx.audit.record({
      actorUserId: auth.user.id,
      deviceId,
      eventType: 'FILE_ACCESS',
      result: 'SUCCESS',
      resourceType: 'FILE',
      resourceId: file.id,
      ipAddress: getClientIp(req),
      metadata: { operation: 'CONTENT', action, sizeBytes: file.size_bytes },
    });

    res.setHeader('Content-Type', file.mime_type);
    res.setHeader('Content-Length', String(plaintext.length));
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader(
      'Content-Disposition',
      `${query.download ? 'attachment' : 'inline'}; filename="${safeFilename(file.original_name)}"`,
    );
    res.send(plaintext);
  });

  return router;
}

async function parentChainFor(ctx: AppContext, file: FileRow): Promise<ResourceRef[]> {
  if (!file.folder_id) return [];
  const chain = await ctx.folders.chain(file.folder_id);
  return folderChainRefs(chain);
}

async function breadcrumbsFor(ctx: AppContext, file: FileRow): Promise<FolderRow[]> {
  if (!file.folder_id) return [];
  const chain = await ctx.folders.chain(file.folder_id);
  return [...chain].reverse();
}

function safeFilename(name: string): string {
  return name.replace(/["\\\r\n]/g, '_');
}
