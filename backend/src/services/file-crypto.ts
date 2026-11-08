import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { AppConfig } from '../config';

const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;

export interface EncryptedFile {
  ciphertext: Buffer;
  iv: string;
  authTag: string;
  keyReference: string;
  checksum: string;
}

export class FileCryptoService {
  private readonly kek: Buffer;

  constructor(config: AppConfig) {
    this.kek = loadMasterKey(config);
  }

  encryptFile(plaintext: Buffer): EncryptedFile {
    const dataKey = randomBytes(KEY_BYTES);
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, dataKey, iv, { authTagLength: AUTH_TAG_BYTES });
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return {
      ciphertext,
      iv: iv.toString('base64'),
      authTag: authTag.toString('base64'),
      keyReference: this.wrapKey(dataKey),
      checksum: createHash('sha256').update(plaintext).digest('hex'),
    };
  }

  decryptFile(input: {
    ciphertext: Buffer;
    iv: string;
    authTag: string;
    keyReference: string;
    checksum: string;
  }): Buffer {
    const dataKey = this.unwrapKey(input.keyReference);
    const decipher = createDecipheriv(
      ALGORITHM,
      dataKey,
      Buffer.from(input.iv, 'base64'),
      { authTagLength: AUTH_TAG_BYTES },
    );
    decipher.setAuthTag(Buffer.from(input.authTag, 'base64'));
    const plaintext = Buffer.concat([decipher.update(input.ciphertext), decipher.final()]);

    const checksum = createHash('sha256').update(plaintext).digest('hex');
    if (checksum !== input.checksum) {
      throw new Error('File integrity check failed');
    }
    return plaintext;
  }

  private wrapKey(dataKey: Buffer): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.kek, iv, { authTagLength: AUTH_TAG_BYTES });
    const ciphertext = Buffer.concat([cipher.update(dataKey), cipher.final()]);
    return [
      iv.toString('base64'),
      cipher.getAuthTag().toString('base64'),
      ciphertext.toString('base64'),
    ].join('.');
  }

  private unwrapKey(reference: string): Buffer {
    const [ivPart, tagPart, ciphertextPart] = reference.split('.');
    if (!ivPart || !tagPart || !ciphertextPart) {
      throw new Error('Invalid wrapped file key');
    }

    const decipher = createDecipheriv(
      ALGORITHM,
      this.kek,
      Buffer.from(ivPart, 'base64'),
      { authTagLength: AUTH_TAG_BYTES },
    );
    decipher.setAuthTag(Buffer.from(tagPart, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertextPart, 'base64')),
      decipher.final(),
    ]);
  }
}

function loadMasterKey(config: AppConfig): Buffer {
  if (config.fileEncryptionKek) {
    const key = Buffer.from(config.fileEncryptionKek, 'base64');
    if (key.length !== KEY_BYTES) {
      throw new Error('FILE_ENCRYPTION_KEK must decode to exactly 32 bytes');
    }
    return key;
  }

  if (config.env === 'production') {
    throw new Error('FILE_ENCRYPTION_KEK is required in production');
  }

  const keyFile = config.fileEncryptionKeyFile;
  mkdirSync(path.dirname(keyFile), { recursive: true, mode: 0o700 });
  if (existsSync(keyFile)) {
    const key = readFileSync(keyFile);
    if (key.length !== KEY_BYTES) {
      throw new Error(`Master key file ${keyFile} must contain exactly 32 bytes`);
    }
    return key;
  }

  const key = randomBytes(KEY_BYTES);
  writeFileSync(keyFile, key, { mode: 0o600 });
  return key;
}
