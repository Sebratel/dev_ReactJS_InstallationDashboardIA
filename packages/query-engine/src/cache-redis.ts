// Adapter Redis do Cache. Redis roda no Portainer da Sebratel.
// Configuração por env: REDIS_URL (ex: redis://host:6379/0).
import type Redis from 'ioredis';
import type { Cache } from './types.ts';

export interface RedisLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: 'EX', ttl: number): Promise<unknown>;
  del(...keys: string[]): Promise<number>;
  scan(cursor: string, ...args: (string | number)[]): Promise<[string, string[]]>;
  quit(): Promise<unknown>;
}

export class RedisCache implements Cache {
  #redis: RedisLike;

  constructor(redis: RedisLike | Redis) {
    this.#redis = redis as RedisLike;
  }

  async get<T>(key: string): Promise<T | undefined> {
    const raw = await this.#redis.get(key);
    if (raw === null || raw === undefined) return undefined;
    try {
      return JSON.parse(raw) as T;
    } catch {
      // valor corrompido não deve derrubar a consulta — trata como miss
      await this.del(key);
      return undefined;
    }
  }

  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    if (ttlSeconds <= 0) return;
    await this.#redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
  }

  async del(key: string): Promise<void> {
    await this.#redis.del(key);
  }

  async delMany(keys: string[]): Promise<number> {
    if (keys.length === 0) return 0;
    return await this.#redis.del(...keys);
  }

  /** SCAN em vez de KEYS: não bloqueia o Redis em produção. */
  async keys(prefix: string): Promise<string[]> {
    const found: string[] = [];
    let cursor = '0';
    do {
      const [next, batch] = await this.#redis.scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', 500);
      cursor = next;
      found.push(...batch);
    } while (cursor !== '0');
    return [...new Set(found)].sort();
  }
}
