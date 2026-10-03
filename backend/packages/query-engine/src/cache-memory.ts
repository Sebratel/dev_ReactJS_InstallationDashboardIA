// Cache em memória. Usado em testes e como fallback quando o Redis cai.
import type { Cache, Clock } from './types.ts';
import { systemClock } from './types.ts';

interface Entry {
  value: unknown;
  expiresAt: number; // epoch ms; Infinity = sem expiração
}

export class MemoryCache implements Cache {
  #store = new Map<string, Entry>();
  #clock: Clock;

  constructor(clock: Clock = systemClock) {
    this.#clock = clock;
  }

  async get<T>(key: string): Promise<T | undefined> {
    const entry = this.#store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.#clock.now()) {
      this.#store.delete(key);
      return undefined;
    }
    return entry.value as T;
  }

  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    if (ttlSeconds <= 0) return; // ttl 0 = não cacheia
    this.#store.set(key, {
      value,
      expiresAt: this.#clock.now() + ttlSeconds * 1000,
    });
  }

  async del(key: string): Promise<void> {
    this.#store.delete(key);
  }

  async delMany(keys: string[]): Promise<number> {
    let n = 0;
    for (const k of keys) if (this.#store.delete(k)) n++;
    return n;
  }

  async keys(prefix: string): Promise<string[]> {
    const now = this.#clock.now();
    const out: string[] = [];
    for (const [k, entry] of this.#store) {
      if (entry.expiresAt <= now) {
        this.#store.delete(k);
        continue;
      }
      if (k.startsWith(prefix)) out.push(k);
    }
    return out.sort();
  }

  /** Só para testes/observabilidade. */
  get size(): number {
    return this.#store.size;
  }
}
