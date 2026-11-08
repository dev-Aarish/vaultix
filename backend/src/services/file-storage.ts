import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

export interface FileStorage {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}

export class LocalFileStorage implements FileStorage {
  private readonly root: string;

  constructor(baseDir: string) {
    this.root = path.resolve(baseDir);
  }

  async put(key: string, data: Buffer): Promise<void> {
    const target = this.pathFor(key);
    await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    await writeFile(target, data, { mode: 0o600 });
  }

  async get(key: string): Promise<Buffer> {
    return readFile(this.pathFor(key));
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true });
  }

  private pathFor(key: string): string {
    if (!/^[A-Za-z0-9._/-]+$/.test(key) || key.includes('..')) {
      throw new Error('Invalid storage object key');
    }
    const target = path.resolve(this.root, key);
    if (target !== this.root && !target.startsWith(`${this.root}${path.sep}`)) {
      throw new Error('Invalid storage object key');
    }
    return target;
  }
}
