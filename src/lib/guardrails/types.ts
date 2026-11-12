import { CatalogProduct } from "@/lib/catalog/types";
import { PriceBreakdown } from "@/lib/types/agent";

/**
 * Machine-readable error codes for deterministic policy violations.
 * Server-side code is authoritative; the LLM must NEVER override these.
 */
export type GuardrailViolationCode =
  | "OUT_OF_STOCK"
  | "EXCEEDS_BUDGET"
  | "DELIVERY_TOO_SLOW"
  | "RATING_TOO_LOW"
  | "BRAND_MISMATCH"
  | "INVALID_PRICE_DATA";

/**
 * Structured violation detail with machine-readable code and explanatory text.
 */
export interface GuardrailViolation {
  code: GuardrailViolationCode;
  message: string;
  expected: string | number;
  actual: string | number;
  diff?: number;
}

/**
 * Authoritative pricing result computed strictly in integer minor units (cents).
 */
export interface AuthoritativePricing extends PriceBreakdown {
  itemPriceCents: number;
  shippingCostCents: number;
  estimatedTaxCents: number;
  totalCostCents: number;
  currency: string;
  isEstimate: true;
  taxCalculationDescription: string;
  shippingCalculationDescription: string;
}

/**
 * Guardrail policy check result for a single candidate product.
 */
export interface GuardrailCheckResult {
  eligible: boolean;
  productId: string;
  productTitle: string;
  pricing: AuthoritativePricing;
  reasonCodes: GuardrailViolationCode[];
  violations: GuardrailViolation[];
  humanReadableSummary: string;

  // Individual boolean checks
  inStockPassed: boolean;
  budgetPassed: boolean;
  deliveryPassed: boolean;
  ratingPassed: boolean;
  brandPassed: boolean;
  priceValidityPassed: boolean;

  // Soft preference match (does not alter hard eligibility)
  softPreferences: {
    brandMatch: boolean;
    isPreferredBrand: boolean;
  };

  // Constraint comparison details
  constraintDiffs: {
    budgetCentsDiff: number; // positive = under budget, negative = over budget
    deliveryDaysDiff: number; // positive = faster than limit, negative = slower
    ratingDiff: number; // positive = higher than minimum
  };
}

/**
 * Product that passed 100% of hard constraints, ranked deterministically.
 */
export interface RankedProduct {
  rank: number;
  product: CatalogProduct;
  pricing: AuthoritativePricing;
  guardrailResult: GuardrailCheckResult;
  score: number;
  reasons: string[];
}

/**
 * Product that failed one or more hard constraints and was disqualified.
 */
export interface DisqualifiedProduct {
  product: CatalogProduct;
  pricing: AuthoritativePricing;
  guardrailResult: GuardrailCheckResult;
  failedReasonCodes: GuardrailViolationCode[];
  reasons: string[];
}

/**
 * Full deterministic outcome from evaluating a catalog against constraints.
 */
export interface GuardrailEvaluationOutcome {
  hasEligibleProducts: boolean;
  selectedRecommendation: RankedProduct | null;
  rankedEligible: RankedProduct[];
  disqualifiedCandidates: DisqualifiedProduct[];
  totalEvaluated: number;
  eligibleCount: number;
  disqualifiedCount: number;

  // Aggregated violations for transparency when no product is eligible
  violationBreakdown: Record<GuardrailViolationCode, number>;
  suggestedAdjustments: string[];
  explanation: string;
}
