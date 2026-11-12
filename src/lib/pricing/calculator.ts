import { AuthoritativePricing } from "@/lib/guardrails/types";
import {
  ConstraintCheckResult,
  PriceBreakdown,
  ShoppingConstraints,
} from "@/lib/types/agent";

/**
 * Standard simulated default tax rate for demo environment (8.00%).
 */
export const DEFAULT_DEMO_TAX_RATE = 0.08;

/**
 * Canonical authoritative pricing function.
 * ALL arithmetic is performed strictly in integer minor units (USD cents)
 * to avoid IEEE-754 floating-point drift and guarantee financial exactness.
 *
 * All ranking, guardrail checks, proposals, and checkout validation must use
 * this same authoritative pricing logic.
 */
export function calculateAuthoritativePricing(params: {
  priceCents: number;
  shippingFeeCents?: number;
  estimatedTaxRate?: number;
  currency?: string;
}): AuthoritativePricing {
  const {
    priceCents,
    shippingFeeCents = 0,
    estimatedTaxRate = DEFAULT_DEMO_TAX_RATE,
    currency = "USD",
  } = params;

  // Validate arithmetic inputs
  if (
    !Number.isFinite(priceCents) ||
    priceCents < 0 ||
    !Number.isInteger(Math.round(priceCents))
  ) {
    throw new Error(`Invalid item price cents: ${priceCents}`);
  }

  const itemPriceCents = Math.round(priceCents);
  const shippingCostCents = Math.max(0, Math.round(shippingFeeCents));
  const rate = Math.max(0, estimatedTaxRate);

  // Deterministic sales tax: rounded to nearest integer cent
  const estimatedTaxCents = Math.round(itemPriceCents * rate);

  // Authoritative total: strict integer addition
  const totalCostCents = itemPriceCents + shippingCostCents + estimatedTaxCents;

  return {
    itemPrice: itemPriceCents / 100,
    shippingCost: shippingCostCents / 100,
    estimatedTax: estimatedTaxCents / 100,
    totalCost: totalCostCents / 100,
    itemPriceCents,
    shippingCostCents,
    estimatedTaxCents,
    totalCostCents,
    currency,
    isEstimate: true,
    taxCalculationDescription: `Deterministic demo sales tax calculated at ${(rate * 100).toFixed(2)}% of base price. Does not represent actual tax obligations.`,
    shippingCalculationDescription:
      shippingCostCents === 0
        ? "Simulated free tier freight shipping."
        : `Simulated carrier shipping fee ($${(shippingCostCents / 100).toFixed(2)}). Not a live freight quote.`,
  };
}

/**
 * Compatibility wrapper for legacy calls that supply decimal dollars.
 * Converts to integer cents before performing arithmetic.
 */
export function calculatePriceBreakdown(
  basePrice: number,
  shippingCost: number = 0,
  estimatedTaxRate: number = DEFAULT_DEMO_TAX_RATE,
  currency: string = "USD"
): PriceBreakdown {
  const priceCents = Math.round(basePrice * 100);
  const shippingFeeCents = Math.round(shippingCost * 100);
  const pricing = calculateAuthoritativePricing({
    priceCents,
    shippingFeeCents,
    estimatedTaxRate,
    currency,
  });

  return {
    itemPrice: pricing.itemPrice,
    shippingCost: pricing.shippingCost,
    estimatedTax: pricing.estimatedTax,
    totalCost: pricing.totalCost,
    itemPriceCents: pricing.itemPriceCents,
    shippingCostCents: pricing.shippingCostCents,
    estimatedTaxCents: pricing.estimatedTaxCents,
    totalCostCents: pricing.totalCostCents,
    currency: pricing.currency,
  };
}

/**
 * Evaluates whether a product meets all user constraints using integer cents comparison.
 */
export function evaluateConstraints(
  product: {
    basePrice: number;
    shippingCost: number;
    estimatedTaxRate?: number;
    deliveryDays: number;
    rating: number;
    brand: string;
  },
  constraints: ShoppingConstraints
): ConstraintCheckResult {
  const breakdown = calculatePriceBreakdown(
    product.basePrice,
    product.shippingCost,
    product.estimatedTaxRate ?? DEFAULT_DEMO_TAX_RATE
  );

  const maxBudgetCents = Math.round(constraints.maxBudget * 100);
  const budgetPassed = breakdown.totalCostCents <= maxBudgetCents;
  const deliveryPassed = product.deliveryDays <= constraints.maxDeliveryDays;
  const ratingPassed = product.rating >= constraints.minRating;

  let brandPassed = true;
  let brandMatch = false;
  if (constraints.preferredBrand && constraints.preferredBrand.trim().length > 0) {
    brandMatch =
      product.brand.toLowerCase().trim() ===
      constraints.preferredBrand.toLowerCase().trim();
    if (constraints.optimizationPreference === "PREFERRED_BRAND") {
      brandPassed = brandMatch;
    }
  }

  const passed = budgetPassed && deliveryPassed && ratingPassed && brandPassed;

  return {
    passed,
    budgetPassed,
    deliveryPassed,
    ratingPassed,
    brandPassed,
    details: {
      budgetDiff: (maxBudgetCents - breakdown.totalCostCents) / 100,
      deliveryDiff: constraints.maxDeliveryDays - product.deliveryDays,
      ratingDiff: Math.round((product.rating - constraints.minRating) * 10) / 10,
      brandMatch,
    },
  };
}

export interface ScoredProduct<T> {
  product: T;
  breakdown: PriceBreakdown;
  constraintEvaluation: ConstraintCheckResult;
  score: number;
  reasoningNotes: string[];
}

/**
 * Ranks candidate catalog products based on constraint compliance and optimization preference.
 */
export function rankProducts<
  T extends {
    id: string;
    title: string;
    brand: string;
    basePrice: number;
    shippingCost: number;
    estimatedTaxRate?: number;
    rating: number;
    reviewCount: number;
    deliveryDays: number;
  }
>(
  products: T[],
  constraints: ShoppingConstraints
): ScoredProduct<T>[] {
  const scored = products.map((product) => {
    const breakdown = calculatePriceBreakdown(
      product.basePrice,
      product.shippingCost,
      product.estimatedTaxRate ?? DEFAULT_DEMO_TAX_RATE
    );
    const evalResult = evaluateConstraints(product, constraints);
    const notes: string[] = [];

    let score = 0;

    // Heavy penalty if required constraints are violated
    if (!evalResult.passed) {
      if (!evalResult.budgetPassed) {
        score -= 500 + Math.abs(evalResult.details.budgetDiff) * 2;
        notes.push(`Exceeds budget by $${Math.abs(evalResult.details.budgetDiff).toFixed(2)}`);
      }
      if (!evalResult.deliveryPassed) {
        score -= 200 + Math.abs(evalResult.details.deliveryDiff) * 20;
        notes.push(`Delivery slower by ${Math.abs(evalResult.details.deliveryDiff)} day(s)`);
      }
      if (!evalResult.ratingPassed) {
        score -= 150 + Math.abs(evalResult.details.ratingDiff) * 50;
        notes.push(`Rating below minimum by ${Math.abs(evalResult.details.ratingDiff).toFixed(1)} stars`);
      }
      if (!evalResult.brandPassed) {
        score -= 300;
        notes.push(`Does not match preferred brand "${constraints.preferredBrand}"`);
      }
    } else {
      score += 1000; // Base score for fulfilling all constraints
      notes.push(`Fully satisfies all constraints within $${constraints.maxBudget.toFixed(2)} budget`);
    }

    // Optimization preference weighting
    switch (constraints.optimizationPreference) {
      case "LOWEST_PRICE": {
        // Price savings relative to budget
        const savingsRatio =
          constraints.maxBudget > 0
            ? (constraints.maxBudget - breakdown.totalCost) / constraints.maxBudget
            : 0;
        score += savingsRatio * 400;
        score += product.rating * 15;
        score += Math.max(0, 10 - product.deliveryDays) * 5;
        notes.push(`Optimized for lowest total price ($${breakdown.totalCost.toFixed(2)})`);
        break;
      }
      case "PREFERRED_BRAND": {
        if (evalResult.details.brandMatch) {
          score += 500;
          notes.push(`Matches preferred brand: ${product.brand}`);
        }
        score += product.rating * 40;
        score += (constraints.maxBudget - breakdown.totalCost) * 0.5;
        break;
      }
      case "BEST_VALUE":
      default: {
        const ratingBonus = product.rating * 40;
        const reviewConfidence = Math.min(Math.log10(product.reviewCount + 1) * 25, 100);
        const budgetEfficiency =
          constraints.maxBudget > 0
            ? ((constraints.maxBudget - breakdown.totalCost) / constraints.maxBudget) * 150
            : 0;
        const deliverySpeedBonus = Math.max(0, 7 - product.deliveryDays) * 10;
        const brandBonus = evalResult.details.brandMatch ? 80 : 0;

        score += ratingBonus + reviewConfidence + budgetEfficiency + deliverySpeedBonus + brandBonus;
        notes.push(
          `High customer rating (${product.rating}★ across ${product.reviewCount} reviews) with fast ${product.deliveryDays}-day delivery`
        );
        break;
      }
    }

    return {
      product,
      breakdown,
      constraintEvaluation: evalResult,
      score,
      reasoningNotes: notes,
    };
  });

  return scored.sort((a, b) => b.score - a.score);
}

export interface CandidateSelectionResult<T> {
  hasCompliantProduct: boolean;
  selectedMatch: ScoredProduct<T> | null;
  closestAlternative: ScoredProduct<T> | null;
  allEligibleCandidates: ScoredProduct<T>[];
  violationSummary: string[];
}

/**
 * Evaluates ranked candidates and strictly selects the top compliant product.
 * NEVER relaxes hard constraints silently: if no candidate is 100% compliant,
 * selectedMatch is null and closestAlternative is provided with exact violation reasons.
 */
export function selectBestCandidate<
  T extends {
    id: string;
    title: string;
    brand: string;
    basePrice: number;
    shippingCost: number;
    estimatedTaxRate?: number;
    rating: number;
    reviewCount: number;
    deliveryDays: number;
  }
>(ranked: ScoredProduct<T>[]): CandidateSelectionResult<T> {
  if (ranked.length === 0) {
    return {
      hasCompliantProduct: false,
      selectedMatch: null,
      closestAlternative: null,
      allEligibleCandidates: [],
      violationSummary: ["No matching products found in catalog"],
    };
  }

  const compliantCandidates = ranked.filter((r) => r.constraintEvaluation.passed);

  if (compliantCandidates.length > 0) {
    return {
      hasCompliantProduct: true,
      selectedMatch: compliantCandidates[0],
      closestAlternative: null,
      allEligibleCandidates: compliantCandidates,
      violationSummary: [],
    };
  }

  // No products passed ALL hard constraints!
  // Refuse to pick an ineligible product; identify closest match and violations
  const closest = ranked[0];
  const violations = closest.reasoningNotes.filter(
    (note) =>
      note.includes("Exceeds budget") ||
      note.includes("Delivery slower") ||
      note.includes("Rating below") ||
      note.includes("Does not match preferred brand")
  );

  return {
    hasCompliantProduct: false,
    selectedMatch: null,
    closestAlternative: closest,
    allEligibleCandidates: [],
    violationSummary:
      violations.length > 0 ? violations : ["Constraints could not be fully satisfied"],
  };
}
