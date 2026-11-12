import { z } from "zod";

export const ProductSchema = z.object({
  id: z.string(),
  externalId: z.string(),
  title: z.string(),
  description: z.string(),
  category: z.string(),
  brand: z.string(),
  seller: z.string(),
  basePrice: z.number().positive(),
  currency: z.string().default("USD"),
  shippingCost: z.number().nonnegative().default(0),
  estimatedTaxRate: z.number().min(0).max(0.5).default(0.08),
  rating: z.number().min(1).max(5),
  reviewCount: z.number().int().nonnegative(),
  deliveryDays: z.number().int().positive(),
  inStock: z.boolean().default(true),
  imageUrl: z.string(),
  specs: z.record(z.unknown()).optional(),
  createdAt: z.date().or(z.string()).optional(),
  updatedAt: z.date().or(z.string()).optional(),
});

export type CatalogProduct = z.infer<typeof ProductSchema>;

export interface ProductFilterCriteria {
  query?: string;
  category?: string;
  brand?: string;
  maxBudget?: number;
  maxDeliveryDays?: number;
  minRating?: number;
  inStockOnly?: boolean;
}
