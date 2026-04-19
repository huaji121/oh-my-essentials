// store.ts
import { world } from "@minecraft/server";

const CHUNK_SIZE_LIMIT = 32767;

export class JsonStore<T> {
  private readonly prefix: string;

  constructor(prefix: string) {
    this.prefix = prefix;
  }

  private chunkKey(key: string, index: number): string {
    return `${this.prefix}_${key}_${index}`;
  }

  set(key: string, value: T): void {
    const json = JSON.stringify(value);
    const chunks: string[] = [];

    // 按字节切片
    for (let i = 0; i < json.length; i += CHUNK_SIZE_LIMIT) {
      chunks.push(json.slice(i, i + CHUNK_SIZE_LIMIT));
    }
    if (chunks.length === 0) chunks.push("");

    // 写入新分片
    chunks.forEach((chunk, index) => {
      world.setDynamicProperty(this.chunkKey(key, index), chunk);
    });

    // 清除旧的多余分片
    let index = chunks.length;
    while (world.getDynamicProperty(this.chunkKey(key, index)) !== undefined) {
      world.setDynamicProperty(this.chunkKey(key, index), undefined);
      index++;
    }
  }

  get(key: string): T | undefined {
    const chunks: string[] = [];
    let index = 0;
    while (true) {
      const raw = world.getDynamicProperty(this.chunkKey(key, index));
      if (raw === undefined || typeof raw !== "string") break;
      chunks.push(raw);
      index++;
    }

    if (chunks.length === 0) return undefined;
    try {
      return JSON.parse(chunks.join("")) as T;
    } catch {
      return undefined;
    }
  }

  delete(key: string): void {
    let index = 0;
    while (world.getDynamicProperty(this.chunkKey(key, index)) !== undefined) {
      world.setDynamicProperty(this.chunkKey(key, index), undefined);
      index++;
    }
  }

  // 返回所有 key（不含 prefix 和 index）
  keys(): string[] {
    const found = new Set<string>();
    for (const propKey of world.getDynamicPropertyIds()) {
      if (!propKey.startsWith(this.prefix + "_")) continue;
      const withoutPrefix = propKey.slice(this.prefix.length + 1);
      const lastUnderscore = withoutPrefix.lastIndexOf("_");
      if (lastUnderscore === -1) continue;
      found.add(withoutPrefix.slice(0, lastUnderscore));
    }
    return Array.from(found);
  }

  entries(): [string, T][] {
    const result: [string, T][] = [];
    for (const key of this.keys()) {
      const value = this.get(key);
      if (value !== undefined) result.push([key, value]);
    }
    return result;
  }
}
