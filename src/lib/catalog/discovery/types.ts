import { CatalogProduct } from "../types";

export interface DiscoveredProduct extends CatalogProduct {
  sourceProvider: "live_api" | "marketplace_catalog" | "seed_catalog" | "serpapi";
  isLiveDiscovery: boolean;
  relevanceScore: number;
}

export interface SearchDiscoveryOptions {
  query: string;
  category?: string;
  brand?: string;
  maxBudgetCents?: number;
  maxDeliveryDays?: number;
  minRating?: number;
  inStockOnly?: boolean;
  limit?: number;
}

export interface ProductSearchProvider {
  name: string;
  search(options: SearchDiscoveryOptions): Promise<DiscoveredProduct[]>;
}
