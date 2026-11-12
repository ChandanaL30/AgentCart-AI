import { z } from "zod";

export const OptimizationPreferenceEnum = z.enum([
  "BEST_VALUE",
  "LOWEST_PRICE",
  "PREFERRED_BRAND",
]);
export type OptimizationPreference = z.infer<typeof OptimizationPreferenceEnum>;

export const ShoppingConstraintsSchema = z.object({
  maxBudget: z.number().positive("Maximum budget must be greater than 0").max(100000),
  maxDeliveryDays: z.number().int().min(1, "Delivery days must be at least 1").max(30),
  minRating: z.number().min(1).max(5).default(4.0),
  preferredBrand: z.string().trim().optional(),
  optimizationPreference: OptimizationPreferenceEnum.default("BEST_VALUE"),
  currency: z.string().default("USD").optional(),
});
export type ShoppingConstraints = z.infer<typeof ShoppingConstraintsSchema>;

export const AgentRunStatusEnum = z.enum([
  "IDLE",
  "PLANNING",
  "SEARCHING",
  "EVALUATING",
  "PROPOSING",
  "COMPLETED",
  "FAILED",
]);
export type AgentRunStatus = z.infer<typeof AgentRunStatusEnum>;

export const AgentStageEnum = z.enum([
  "INITIALIZE",
  "PARSE_QUERY",
  "TOOL_CALL",
  "TOOL_RESULT",
  "CATALOG_SEARCH",
  "CALCULATE_PRICING",
  "EVALUATE_CONSTRAINTS",
  "COMPARE_PRODUCTS",
  "GENERATE_PROPOSAL",
  "READY_FOR_REVIEW",
  "ERROR",
]);
export type AgentStage = z.infer<typeof AgentStageEnum>;

export const AgentEventTypeEnum = z.enum(["INFO", "WARN", "DATA", "TOOL", "COMPLETE", "ERROR"]);
export type AgentEventType = z.infer<typeof AgentEventTypeEnum>;

export interface AgentActivityEvent {
  id: string;
  runId: string;
  sequence: number;
  stage: AgentStage;
  eventType: AgentEventType;
  message: string;
  payload?: Record<string, unknown> | null;
  createdAt: string; // ISO 8601 string
}

export const ProposalStatusEnum = z.enum([
  "PENDING_REVIEW",
  "APPROVED",
  "COMPLETED",
  "REJECTED",
  "EXPIRED",
  "SUPERSEDED",
]);
export type ProposalStatus = z.infer<typeof ProposalStatusEnum>;

export interface PriceBreakdown {
  itemPrice: number;
  shippingCost: number;
  estimatedTax: number;
  totalCost: number;
  // Integer minor units (cents) for exact precision fintech operations
  itemPriceCents: number;
  shippingCostCents: number;
  estimatedTaxCents: number;
  totalCostCents: number;
  currency: string;
}

export interface ConstraintCheckResult {
  passed: boolean;
  budgetPassed: boolean;
  deliveryPassed: boolean;
  ratingPassed: boolean;
  brandPassed: boolean;
  details: {
    budgetDiff: number; // budget - totalCost (positive means within budget)
    deliveryDiff: number; // maxDelivery - actualDelivery
    ratingDiff: number; // actualRating - minRating
    brandMatch: boolean;
  };
}

export interface PurchaseProposalDto {
  id: string;
  runId: string;
  productId: string;
  product: {
    id: string;
    title: string;
    brand: string;
    seller: string;
    imageUrl: string;
    rating: number;
    reviewCount: number;
    deliveryDays: number;
    category: string;
    model?: string;
    description?: string;
    productUrl?: string;
    marketplace?: string;
    shipsFrom?: string;
    inStock?: boolean;
    stockQuantity?: number;
    warranty?: string;
    returnPolicy?: string;
    compatibility?: string;
    specs?: Record<string, string | number | boolean>;
    attributes?: Record<string, string | number | boolean>;
    isMockData?: boolean;
  };
  priceBreakdown: PriceBreakdown;
  constraintsSnapshot: ShoppingConstraints;
  constraintEvaluation: ConstraintCheckResult;
  reason: string;
  version: number;
  expiresAt: string;
  status: ProposalStatus;
  createdAt: string;
}

export const StartAgentRunRequestSchema = z.object({
  query: z.string().min(2, "Shopping query must be at least 2 characters").max(500),
  constraints: ShoppingConstraintsSchema,
});
export type StartAgentRunRequest = z.infer<typeof StartAgentRunRequestSchema>;
