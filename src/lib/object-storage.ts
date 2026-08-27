import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export interface ObjectStorage {
  put(key: string, body: Uint8Array): Promise<{ key: string }>;
  get(key: string): Promise<Uint8Array>;
}

export class LocalObjectStorage implements ObjectStorage {
  constructor(private readonly root: string) {}

  async put(key: string, body: Uint8Array): Promise<{ key: string }> {
    const target = path.join(this.root, key);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, body);
    return { key };
  }

  async get(key: string): Promise<Uint8Array> {
    return readFile(path.join(this.root, key));
  }
}

// Future cloud drivers (S3-compatible, Vercel Blob, etc.) implement this same boundary.
