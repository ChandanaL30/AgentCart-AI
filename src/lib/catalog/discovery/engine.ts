import { DiscoveredProduct, SearchDiscoveryOptions } from "./types";
import { discoveryCache } from "./cache";
import { liveApiProvider } from "./live-api-provider";
import { marketplaceCatalogProvider } from "./marketplace-catalog-provider";

export class DynamicDiscoveryEngine {
  /**
   * Discovers products from live external providers and authentic marketplace catalogs.
   * Every new search is evaluated independently with its own cache key and strict relevance check.
   */
  public async discoverProducts(options: SearchDiscoveryOptions): Promise<DiscoveredProduct[]> {
    const { query, category, brand, maxBudgetCents } = options;
    if (!query || query.trim().length === 0) return [];

    // 1. Check Query-Specific TTL Cache
    const cacheKey = discoveryCache.generateKey({
      query,
      category,
      brand,
      maxBudgetCents,
    });
    const cached = discoveryCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    // 2. Query Available Providers in Parallel
    const [liveResults, marketplaceResults] = await Promise.allSettled([
      liveApiProvider.search(options),
      marketplaceCatalogProvider.search(options),
    ]);

    const candidates: DiscoveredProduct[] = [];

    if (marketplaceResults.status === "fulfilled") {
      candidates.push(...marketplaceResults.value);
    }
    if (liveResults.status === "fulfilled") {
      candidates.push(...liveResults.value);
    }

    // 3. Deduplicate by Product ID and Product URL
    const seenIds = new Set<string>();
    const seenUrls = new Set<string>();
    const deduplicated: DiscoveredProduct[] = [];

    for (const item of candidates) {
      if (seenIds.has(item.id)) continue;
      if (item.productUrl && seenUrls.has(item.productUrl.toLowerCase())) continue;

      seenIds.add(item.id);
      if (item.productUrl) seenUrls.add(item.productUrl.toLowerCase());
      deduplicated.push(item);
    }

    // 4. Sort by Relevance Score Descending
    deduplicated.sort((a, b) => b.relevanceScore - a.relevanceScore);

    // 5. Store in Isolated TTL Cache
    if (deduplicated.length > 0) {
      discoveryCache.set(cacheKey, deduplicated);
    }

    return deduplicated;
  }
}

export const dynamicDiscoveryEngine = new DynamicDiscoveryEngine();
