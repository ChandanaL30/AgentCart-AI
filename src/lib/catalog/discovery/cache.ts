import { DiscoveredProduct } from "./types";

interface CacheEntry {
  products: DiscoveredProduct[];
  expiresAt: number;
}

/**
 * In-memory TTL cache for product discovery searches.
 * Each search is isolated by a composite key of the normalized query and relevant constraints.
 * Ensures identical searches within a short window are fast, while new queries are evaluated independently.
 */
export class DiscoveryCache {
  private cache = new Map<string, CacheEntry>();
  private defaultTtlMs: number;

  constructor(defaultTtlMs = 5 * 60 * 1000) {
    this.defaultTtlMs = defaultTtlMs;
  }

  public generateKey(params: {
    query: string;
    category?: string;
    brand?: string;
    maxBudgetCents?: number;
  }): string {
    const normQuery = params.query.toLowerCase().trim().replace(/\s+/g, " ");
    const normCategory = (params.category || "all").toLowerCase().trim();
    const normBrand = (params.brand || "").toLowerCase().trim();
    const budget = params.maxBudgetCents || "any";
    return `${normQuery}::${normCategory}::${normBrand}::${budget}`;
  }

  public get(key: string): DiscoveredProduct[] | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }
    // Return a deep copy to prevent in-place mutation across runs
    return JSON.parse(JSON.stringify(entry.products));
  }

  public set(key: string, products: DiscoveredProduct[], ttlMs?: number): void {
    const expiresAt = Date.now() + (ttlMs ?? this.defaultTtlMs);
    this.cache.set(key, {
      products: JSON.parse(JSON.stringify(products)),
      expiresAt,
    });
  }

  public clear(): void {
    this.cache.clear();
  }
}

export const discoveryCache = new DiscoveryCache();
