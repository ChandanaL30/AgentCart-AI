import { z } from "zod";

/**
 * Supported catalog categories for demo multi-vendor inventory.
 */
export const CatalogCategoryEnum = z.enum([
  "electronics",
  "headphones",
  "keyboards",
  "accessories",
  "home-office",
  "skincare",
  "beauty",
  "lifestyle",
  "general",
]);
export type CatalogCategory = z.infer<typeof CatalogCategoryEnum> | string;

/**
 * Standard simulated vendor/seller information.
 */
export interface SellerInfo {
  sellerId: string;
  sellerName: string;
  rating: number; // e.g. 4.8
  isAuthorized: boolean;
  fulfillmentType: "DIRECT" | "MARKETPLACE" | "WAREHOUSE";
}

/**
 * Full typed model for a catalog product.
 * All monetary amounts are stored primarily as integer minor units (cents)
 * to avoid floating-point math issues in financial workflows.
 */
export interface CatalogProduct {
  id: string;
  externalId: string;
  title: string;
  description: string;
  category: CatalogCategory;
  brand: string;
  imageUrl: string;

  // Vendor & seller
  sellerId: string;
  sellerName: string;

  // Authoritative integer minor units (USD cents)
  priceCents: number;
  currency: "USD";
  shippingFeeCents: number;
  estimatedTaxRate: number; // e.g. 0.0825 (8.25%)

  // Stock & availability
  inStock: boolean;
  stockQuantity: number;

  // Rating & social proof (clearly marked as simulated mock data)
  rating: number;
  reviewCount: number;
  isMockData: boolean;

  // Fulfillment logistics
  deliveryDays: number;
  shipsFrom: string;

  // Domain attributes for comparison
  attributes: Record<string, string | number | boolean>;

  // Product model and verified external listing
  model?: string;
  productUrl?: string;
  marketplace?: string;
  warranty?: string;
  returnPolicy?: string;
  compatibility?: string;

  // Transparency disclaimers
  disclaimer: string;

  // Legacy decimal fields for backward compatibility
  basePrice: number;
  shippingCost: number;
  seller: string;
  specs: Record<string, string | number | boolean>;
}

/**
 * Server-side search & filter options independent of the LLM.
 */
export interface CatalogSearchParams {
  query?: string;
  category?: CatalogCategory | string;
  brand?: string;
  maxBudgetCents?: number;
  maxDeliveryDays?: number;
  minRating?: number;
  inStockOnly?: boolean;
  limit?: number;
}

/**
 * Side-by-side product comparison structure.
 */
export interface ProductComparisonItem {
  id: string;
  title: string;
  brand: string;
  sellerName: string;
  priceCents: number;
  shippingFeeCents: number;
  estimatedTaxCents: number;
  totalCostCents: number;
  deliveryDays: number;
  rating: number;
  reviewCount: number;
  inStock: boolean;
  attributes: Record<string, string | number | boolean>;
  isWinner?: boolean;
  advantages: string[];
}

export interface ProductComparisonResult {
  products: ProductComparisonItem[];
  commonCategory: string;
  attributeKeys: string[];
  lowestLandedCostProductId: string;
  fastestDeliveryProductId: string;
  highestRatingProductId: string;
  explanation: string;
}
