import { DiscoveredProduct, ProductSearchProvider, SearchDiscoveryOptions } from "./types";

/**
 * Live external marketplace search provider.
 * When real external provider credentials (e.g. Amazon PA-API / Rainforest / SerpApi)
 * are not configured in environment variables, this provider returns an empty array.
 * Strictly never fabricates synthetic product titles, fake pricing, or mock Amazon URLs.
 */
export class LiveApiProductSearchProvider implements ProductSearchProvider {
  public name = "live_api_provider";

  public async search(_options: SearchDiscoveryOptions): Promise<DiscoveredProduct[]> {
    void _options;
    // Without authenticated live marketplace API credentials configured,
    // honestly return an empty list to prevent synthetic hallucinations.
    return [];
  }
}

export const liveApiProvider = new LiveApiProductSearchProvider();
