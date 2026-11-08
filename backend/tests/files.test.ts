import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  bearer,
  bindDevice,
  createBoundUser,
  createFolder,
  createDeviceKey,
  grantPermission,
  loginToken,
  registerApprovedDevice,
  seedAdmin,
  uploadFile,
  useTestHarness,
} from './helpers';

const harness = useTestHarness();
const { app, pool, config } = harness;

async function setupAdmin(): Promise<string> {
  await seedAdmin(harness);
  return loginToken(app, ADMIN_EMAIL, ADMIN_PASSWORD);
}

async function expectAccessDenied(fileId: string, token: string): Promise<void> {
  const metadata = await request(app)
    .get(`/files/${fileId}/metadata`)
    .set('Authorization', bearer(token));
  expect(metadata.status).toBe(404);
  expect(metadata.body.error.code).toBe('NOT_FOUND');

  const open = await request(app)
    .post(`/files/${fileId}/open`)
    .set('Authorization', bearer(token));
  expect(open.status).toBe(404);
  expect(open.body.error.code).toBe('NOT_FOUND');

  const content = await request(app)
    .get(`/files/${fileId}/content`)
    .set('Authorization', bearer(token));
  expect(content.status).toBe(404);
  expect(content.body.error.code).toBe('NOT_FOUND');
}

describe('encrypted file storage', () => {
  it('stores ciphertext at rest and decrypts only through an authorized request', async () => {
    const adminToken = await setupAdmin();
    const folder = await createFolder(app, adminToken, 'Documents');
    const plaintext = '%PDF-1.7\nCONFIDENTIAL vaultix-file-secret';
    const file = await uploadFile(app, adminToken, {
      name: 'contract.pdf',
      data: plaintext,
      folderId: folder.id,
      mimeType: 'application/pdf',
    });

    expect(file).toMatchObject({
      name: 'contract.pdf',
      folderId: folder.id,
      sizeBytes: Buffer.byteLength(plaintext),
    });

    const row = (
      await pool.query('SELECT * FROM files WHERE id = $1', [file.id])
    ).rows[0] as {
      storage_object_key: string;
      encryption_key_reference: string;
      encryption_iv: string;
      encryption_auth_tag: string;
      checksum: string;
    };

    const stored = await readFile(path.join(config.fileStorageDir, row.storage_object_key));
    expect(stored.equals(Buffer.from(plaintext))).toBe(false);
    expect(stored.toString('utf8')).not.toContain('CONFIDENTIAL');
    expect(row.encryption_key_reference).not.toContain(plaintext);
    expect(row.encryption_iv.length).toBeGreaterThan(0);
    expect(row.encryption_auth_tag.length).toBeGreaterThan(0);
    expect(row.checksum).toMatch(/^[a-f0-9]{64}$/);

    const { token } = await createBoundUser(harness, adminToken, 'reader@example.com');
    await grantPermission(app, adminToken, {
      subjectType: 'USER',
      subjectId: (await pool.query('SELECT id FROM users WHERE email = $1', ['reader@example.com']))
        .rows[0].id as string,
      resourceType: 'FOLDER',
      resourceId: folder.id,
      actions: ['VIEW'],
    });

    const content = await request(app)
      .get(`/files/${file.id}/content`)
      .set('Authorization', bearer(token));
    expect(content.status).toBe(200);
    expect(content.body.toString('utf8')).toBe(plaintext);

    const audit = await pool.query(
      `SELECT result, resource_id FROM audit_events
       WHERE event_type = 'FILE_ACCESS' AND resource_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [file.id],
    );
    expect(audit.rows[0]).toMatchObject({ result: 'SUCCESS', resource_id: file.id });

    const open = await request(app)
      .post(`/files/${file.id}/open`)
      .set('Authorization', bearer(token));
    expect(open.status).toBe(200);
    expect(open.body.data).toMatchObject({
      viewSessionId: expect.any(String),
      file: { id: file.id, name: 'contract.pdf' },
      watermark: {
        userName: expect.any(String),
        userEmail: 'reader@example.com',
        deviceName: expect.any(String),
        deviceFingerprint: expect.any(String),
        classification: 'CONFIDENTIAL • RESTRICTED',
        timestamp: expect.any(String),
      },
      inactivityTimeoutSeconds: 60,
    });

    const openAudit = await pool.query(
      `SELECT result, resource_id, metadata FROM audit_events
       WHERE event_type = 'FILE_ACCESS' AND resource_id = $1 AND metadata->>'operation' = 'OPEN'
       ORDER BY created_at DESC LIMIT 1`,
      [file.id],
    );
    expect(openAudit.rows[0]).toMatchObject({ result: 'SUCCESS', resource_id: file.id });
  });
});

describe('default-deny file access', () => {
  it('denies an unshared file without revealing whether it exists', async () => {
    const adminToken = await setupAdmin();
    const file = await uploadFile(app, adminToken, { name: 'private.txt', data: 'top secret' });
    const { token, user } = await createBoundUser(harness, adminToken, 'nobody@example.com');

    await expectAccessDenied(file.id, token);

    const unknown = await request(app)
      .get(`/files/${randomUUID()}/metadata`)
      .set('Authorization', bearer(token));
    expect(unknown.status).toBe(404);
    expect(unknown.body.error.code).toBe('NOT_FOUND');

    const denied = await pool.query(
      `SELECT reason_code FROM audit_events
       WHERE event_type = 'FILE_ACCESS' AND result = 'DENIED'
         AND resource_id = $1 AND actor_user_id = $2`,
      [file.id, user.id],
    );
    expect(denied.rowCount).toBeGreaterThan(0);
    expect(denied.rows[0].reason_code).toBe('NO_PERMISSION');
  });

  it('denies a direct file view when only download is granted', async () => {
    const adminToken = await setupAdmin();
    const file = await uploadFile(app, adminToken, { name: 'download-only.txt', data: 'data' });
    const { token, user } = await createBoundUser(harness, adminToken, 'downloader@example.com');
    await grantPermission(app, adminToken, {
      subjectType: 'USER',
      subjectId: user.id,
      resourceType: 'FILE',
      resourceId: file.id,
      actions: ['DOWNLOAD'],
    });

    const metadata = await request(app)
      .get(`/files/${file.id}/metadata`)
      .set('Authorization', bearer(token));
    expect(metadata.status).toBe(404);

    const download = await request(app)
      .get(`/files/${file.id}/content?download=true`)
      .set('Authorization', bearer(token));
    expect(download.status).toBe(200);
  });
});

describe('folder permission inheritance', () => {
  it('applies a folder grant to descendants and exposes an allowed action set', async () => {
    const adminToken = await setupAdmin();
    const root = await createFolder(app, adminToken, 'Shared');
    const child = await createFolder(app, adminToken, 'Reports', root.id);
    const file = await uploadFile(app, adminToken, {
      name: 'report.txt',
      data: 'quarterly report',
      folderId: child.id,
      mimeType: 'text/plain',
    });
    const { token, user } = await createBoundUser(harness, adminToken, 'member@example.com');

    await grantPermission(app, adminToken, {
      subjectType: 'USER',
      subjectId: user.id,
      resourceType: 'FOLDER',
      resourceId: root.id,
      actions: ['VIEW'],
    });

    const rootList = await request(app).get('/files').set('Authorization', bearer(token));
    expect(rootList.status).toBe(200);
    expect(rootList.body.data.items).toHaveLength(1);
    expect(rootList.body.data.items[0]).toMatchObject({
      type: 'FOLDER',
      id: root.id,
      allowedActions: ['VIEW'],
    });

    const rootContents = await request(app)
      .get(`/files?folderId=${root.id}`)
      .set('Authorization', bearer(token));
    expect(rootContents.status).toBe(200);
    expect(rootContents.body.data.items.some((item: { id: string }) => item.id === child.id)).toBe(
      true,
    );

    const childContents = await request(app)
      .get(`/files?folderId=${child.id}`)
      .set('Authorization', bearer(token));
    expect(childContents.status).toBe(200);
    expect(childContents.body.data.breadcrumbs.map((item: { id: string }) => item.id)).toEqual([
      root.id,
      child.id,
    ]);
    expect(childContents.body.data.items[0]).toMatchObject({
      type: 'FILE',
      id: file.id,
      allowedActions: ['VIEW'],
    });

    const metadata = await request(app)
      .get(`/files/${file.id}/metadata`)
      .set('Authorization', bearer(token));
    expect(metadata.status).toBe(200);
    expect(metadata.body.data.file.name).toBe('report.txt');

    const content = await request(app)
      .get(`/files/${file.id}/content`)
      .set('Authorization', bearer(token));
    expect(content.status).toBe(200);
    expect(content.text).toBe('quarterly report');
  });

  it('does not let a parent grant bypass an explicit file-level revocation', async () => {
    const adminToken = await setupAdmin();
    const folder = await createFolder(app, adminToken, 'Inherited');
    const revokedFile = await uploadFile(app, adminToken, {
      name: 'revoked.txt',
      data: 'revoked',
      folderId: folder.id,
    });
    const visibleFile = await uploadFile(app, adminToken, {
      name: 'visible.txt',
      data: 'visible',
      folderId: folder.id,
    });
    const { token, user } = await createBoundUser(harness, adminToken, 'revoked@example.com');

    await grantPermission(app, adminToken, {
      subjectType: 'USER',
      subjectId: user.id,
      resourceType: 'FOLDER',
      resourceId: folder.id,
      actions: ['VIEW'],
    });
    const filePermission = await grantPermission(app, adminToken, {
      subjectType: 'USER',
      subjectId: user.id,
      resourceType: 'FILE',
      resourceId: revokedFile.id,
      actions: ['VIEW'],
    });

    const revoked = await request(app)
      .delete(`/admin/permissions/${filePermission.id}`)
      .set('Authorization', bearer(adminToken));
    expect(revoked.status).toBe(200);

    const listing = await request(app)
      .get(`/files?folderId=${folder.id}`)
      .set('Authorization', bearer(token));
    const ids = listing.body.data.items.map((item: { id: string }) => item.id);
    expect(ids).not.toContain(revokedFile.id);
    expect(ids).toContain(visibleFile.id);

    await expectAccessDenied(revokedFile.id, token);

    const denied = await pool.query(
      `SELECT reason_code FROM audit_events
       WHERE event_type = 'FILE_ACCESS' AND result = 'DENIED' AND resource_id = $1
       ORDER BY created_at DESC LIMIT 1`,
      [revokedFile.id],
    );
    expect(denied.rows[0].reason_code).toBe('PERMISSION_REVOKED');
  });

  it('denies descendants after the inherited folder grant is revoked', async () => {
    const adminToken = await setupAdmin();
    const folder = await createFolder(app, adminToken, 'Temporary');
    const file = await uploadFile(app, adminToken, {
      name: 'temporary.txt',
      data: 'temporary',
      folderId: folder.id,
    });
    const { token, user } = await createBoundUser(harness, adminToken, 'temporary@example.com');
    const permission = await grantPermission(app, adminToken, {
      subjectType: 'USER',
      subjectId: user.id,
      resourceType: 'FOLDER',
      resourceId: folder.id,
      actions: ['VIEW'],
    });

    expect(
      (
        await request(app)
          .get(`/files/${file.id}/metadata`)
          .set('Authorization', bearer(token))
      ).status,
    ).toBe(200);

    const revoked = await request(app)
      .delete(`/admin/permissions/${permission.id}`)
      .set('Authorization', bearer(adminToken));
    expect(revoked.status).toBe(200);

    await expectAccessDenied(file.id, token);
  });

  it('updates an existing active grant and allows a fresh grant after revocation', async () => {
    const adminToken = await setupAdmin();
    const folder = await createFolder(app, adminToken, 'Regrant');
    const file = await uploadFile(app, adminToken, {
      name: 'regrant.txt',
      data: 'regrant',
      folderId: folder.id,
    });
    const { token, user } = await createBoundUser(harness, adminToken, 'regrant@example.com');

    const first = await grantPermission(app, adminToken, {
      subjectType: 'USER',
      subjectId: user.id,
      resourceType: 'FOLDER',
      resourceId: folder.id,
      actions: ['VIEW'],
    });
    const second = await grantPermission(app, adminToken, {
      subjectType: 'USER',
      subjectId: user.id,
      resourceType: 'FOLDER',
      resourceId: folder.id,
      actions: ['VIEW', 'DOWNLOAD'],
    });
    expect(second.id).toBe(first.id);
    expect(second.actions).toEqual(['VIEW', 'DOWNLOAD']);

    const listing = await request(app)
      .get(`/files?folderId=${folder.id}`)
      .set('Authorization', bearer(token));
    expect(listing.body.data.items[0].allowedActions).toEqual(['VIEW', 'DOWNLOAD']);

    const revoked = await request(app)
      .delete(`/admin/permissions/${second.id}`)
      .set('Authorization', bearer(adminToken));
    expect(revoked.status).toBe(200);
    await expectAccessDenied(file.id, token);

    const regranted = await grantPermission(app, adminToken, {
      subjectType: 'USER',
      subjectId: user.id,
      resourceType: 'FOLDER',
      resourceId: folder.id,
      actions: ['VIEW'],
    });
    expect(regranted.id).not.toBe(first.id);
    expect(
      (
        await request(app)
          .get(`/files/${file.id}/metadata`)
          .set('Authorization', bearer(token))
      ).status,
    ).toBe(200);
  });

  it('denies expired permissions even when a parent grant exists', async () => {
    const adminToken = await setupAdmin();
    const folder = await createFolder(app, adminToken, 'Expiring');
    const file = await uploadFile(app, adminToken, {
      name: 'expired.txt',
      data: 'expired',
      folderId: folder.id,
    });
    const { token, user } = await createBoundUser(harness, adminToken, 'expired@example.com');
    const permission = await grantPermission(app, adminToken, {
      subjectType: 'USER',
      subjectId: user.id,
      resourceType: 'FOLDER',
      resourceId: folder.id,
      actions: ['VIEW'],
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });
    await pool.query(`UPDATE permissions SET expires_at = now() - interval '1 minute' WHERE id = $1`, [
      permission.id,
    ]);

    await expectAccessDenied(file.id, token);

    const denied = await pool.query(
      `SELECT reason_code FROM audit_events
       WHERE event_type = 'FILE_ACCESS' AND result = 'DENIED' AND resource_id = $1
       ORDER BY created_at DESC LIMIT 1`,
      [file.id],
    );
    expect(denied.rows[0].reason_code).toBe('PERMISSION_EXPIRED');
  });
});

describe('device-scoped permissions', () => {
  it('restricts a user grant to explicitly selected approved devices', async () => {
    const adminToken = await setupAdmin();
    const folder = await createFolder(app, adminToken, 'Device Scoped');
    const file = await uploadFile(app, adminToken, {
      name: 'scoped.txt',
      data: 'scoped',
      folderId: folder.id,
    });
    const first = await createBoundUser(harness, adminToken, 'scoped@example.com');
    const { token, user } = first;

    const secondToken = await loginToken(app, 'scoped@example.com', 'user-password-123');
    const secondDevice = await registerApprovedDevice(
      app,
      secondToken,
      adminToken,
      'Second Device',
      createDeviceKey(),
    );
    await bindDevice(app, secondToken, secondDevice);

    await grantPermission(app, adminToken, {
      subjectType: 'USER',
      subjectId: user.id,
      resourceType: 'FOLDER',
      resourceId: folder.id,
      actions: ['VIEW'],
      deviceIds: [first.deviceId],
    });

    const firstList = await request(app)
      .get(`/files?folderId=${folder.id}`)
      .set('Authorization', bearer(token));
    expect(firstList.status).toBe(200);
    expect(firstList.body.data.items).toHaveLength(1);

    const secondList = await request(app)
      .get(`/files?folderId=${folder.id}`)
      .set('Authorization', bearer(secondToken));
    expect(secondList.status).toBe(404);

    const denied = await pool.query(
      `SELECT reason_code FROM audit_events
       WHERE event_type = 'FILE_ACCESS' AND result = 'DENIED' AND actor_user_id = $1
       ORDER BY created_at DESC LIMIT 1`,
      [user.id],
    );
    expect(denied.rows[0].reason_code).toBe('DEVICE_NOT_PERMITTED');
  });
});

describe('cross-user isolation', () => {
  it('does not expose another user folder or file', async () => {
    const adminToken = await setupAdmin();
    const folder = await createFolder(app, adminToken, 'Private');
    const file = await uploadFile(app, adminToken, {
      name: 'private.txt',
      data: 'private',
      folderId: folder.id,
    });
    const owner = await createBoundUser(harness, adminToken, 'owner@example.com');
    const outsider = await createBoundUser(harness, adminToken, 'outsider@example.com');

    await grantPermission(app, adminToken, {
      subjectType: 'USER',
      subjectId: owner.user.id,
      resourceType: 'FOLDER',
      resourceId: folder.id,
      actions: ['VIEW'],
    });

    const ownerList = await request(app)
      .get(`/files?folderId=${folder.id}`)
      .set('Authorization', bearer(owner.token));
    expect(ownerList.status).toBe(200);

    const outsiderList = await request(app)
      .get(`/files?folderId=${folder.id}`)
      .set('Authorization', bearer(outsider.token));
    expect(outsiderList.status).toBe(404);

    await expectAccessDenied(file.id, outsider.token);
  });
});

describe('admin storage authorization', () => {
  it('rejects file and permission management by non-administrators', async () => {
    const adminToken = await setupAdmin();
    const { token } = await createBoundUser(harness, adminToken, 'regular@example.com');

    const folder = await request(app)
      .post('/admin/folders')
      .set('Authorization', bearer(token))
      .send({ name: 'Nope' });
    expect(folder.status).toBe(403);

    const permission = await request(app)
      .post('/admin/permissions')
      .set('Authorization', bearer(token))
      .send({
        subjectType: 'USER',
        subjectId: randomUUID(),
        resourceType: 'FOLDER',
        resourceId: randomUUID(),
        actions: ['VIEW'],
      });
    expect(permission.status).toBe(403);

    const upload = await request(app)
      .post('/admin/files?name=nope.txt')
      .set('Authorization', bearer(token))
      .set('Content-Type', 'application/octet-stream')
      .send(Buffer.from('nope'));
    expect(upload.status).toBe(403);
  });
});
