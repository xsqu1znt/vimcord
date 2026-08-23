import { randomUUID } from "node:crypto";
import { subscribeToFlush, unsubscribeFromFlush } from "./flusher.js";

type CacheMap<K, V> = Map<K, CacheEntry<V>>;
type CacheEntry<V> = { value: V; expiresAt: number };

export interface ServiceCache<K, V> {
    id: string;
    cache: CacheMap<K, V>;
    get: (key: K) => Promise<V | null>;
    set: (key: K, value: V) => CacheEntry<V>;
    delete: (key: K) => void;
    clear: () => void;
    flush: () => number;
}

interface ServiceCacheOptions {
    /** Time-to-live; how long until a cache entry expires. */
    TTL: number;
    /** How often should expired entries be deleted? Leave blank to disable automatic cleanup. */
    flushMS?: number;
}

export class MongoService {
    static createCache<K, V>(getter: (key: K) => Promise<V | null>, options: ServiceCacheOptions): ServiceCache<K, V> {
        const id = randomUUID();
        const cache: CacheMap<K, V> = new Map();

        let lastFlushedAt = 0;
        let flushing = false;
        const canFlush = () => (flushing ? false : options.flushMS ? lastFlushedAt <= Date.now() + options.flushMS : false);

        return {
            id,
            cache,
            async get(key: K) {
                if (canFlush()) this.flush();
                const entry = cache.get(key);

                if (entry) {
                    // Check expiry
                    if (entry.expiresAt <= Date.now()) {
                        cache.delete(key);
                    } else {
                        // Still valid, return
                        return entry.value;
                    }
                }

                // Cache miss/expired
                const value = await getter(key);
                if (!value) return null;
                this.set(key, value);
                return value;
            },
            set(key: K, value: V): CacheEntry<V> {
                const entry: CacheEntry<V> = { value, expiresAt: Date.now() + options.TTL };
                cache.set(key, entry);
                return entry;
            },
            delete(key: K): void {
                cache.delete(key);
            },
            clear(): void {
                cache.clear();
            },
            flush(): number {
                flushing = true;
                let expired = 0;
                for (const [k, e] of cache.entries()) {
                    if (e.expiresAt <= Date.now()) {
                        cache.delete(k);
                        expired++;
                    }
                }
                flushing = false;
                return expired;
            }
        } satisfies ServiceCache<K, V>;
    }

    static createRequestHandler<K, V>() {
        const inboundRequests = new Map<K, Promise<V>>();

        return {
            async request(req: K, callback: (req: K) => Promise<V>) {
                const existing = inboundRequests.get(req);
                if (existing) return await existing;

                // const newRequest
                inboundRequests.set();
            }
        };
    }
}
