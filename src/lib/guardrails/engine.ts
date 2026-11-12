import { CatalogProduct } from "@/lib/catalog/types";
import {
  AuthoritativePricing,
  DisqualifiedProduct,
  GuardrailCheckResult,
  GuardrailEvaluationOutcome,
  GuardrailViolation,
  GuardrailViolationCode,
  RankedProduct,
} from "./types";
import {
  calculateAuthoritativePricing,
  DEFAULT_DEMO_TAX_RATE,
} from "@/lib/pricing/calculator";
import { ShoppingConstraints } from "@/lib/types/agent";

/**
 * Options for configuring guardrail policy enforcement.
 */
export interface GuardrailEngineOptions {
  /**
   * If true, requires the brand to match preferredBrand as a hard constraint.
   * If false, brand matching is treated as a soft ranking preference.
   * Default: true when optimizationPreference is "PREFERRED_BRAND", false otherwise.
   */
  enforceBrandAsHardConstraint?: boolean;
}

/**
 * Deterministic Shopping Guardrail Engine.
 * Evaluates candidate products against hard policy constraints using authoritative
 * server-side logic and integer minor unit arithmetic.
 *
 * THE LLM IS NEVER TRUSTED TO ENFORCE BUDGET, AVAILABILITY, DELIVERY, OR CHECKOUT RULES.
 */
export class GuardrailEngine {
  /**
   * Evaluates a single product against shopping constraints.
   * A product failing ANY hard constraint is marked eligible = false.
   */
  public static evaluateProduct(
    product: CatalogProduct,
    constraints: ShoppingConstraints,
    options?: GuardrailEngineOptions
  ): GuardrailCheckResult {
    const violations: GuardrailViolation[] = [];
    const reasonCodes: GuardrailViolationCode[] = [];

    // 1. Authoritative Pricing Calculation (Strict Integer Cents)
    let pricing: AuthoritativePricing;
    let priceValidityPassed = true;

    try {
      if (
        typeof product.priceCents !== "number" ||
        product.priceCents <= 0 ||
        product.currency !== "USD" ||
        !Number.isFinite(product.priceCents)
      ) {
        priceValidityPassed = false;
        reasonCodes.push("INVALID_PRICE_DATA");
        violations.push({
          code: "INVALID_PRICE_DATA",
          message: `Product price data is invalid or currency is unsupported (${product.currency} ${product.priceCents}¢).`,
          expected: "USD positive integer cents",
          actual: `${product.currency} ${product.priceCents}`,
        });
      }

      pricing = calculateAuthoritativePricing({
        priceCents: Math.max(0, product.priceCents || 0),
        shippingFeeCents: product.shippingFeeCents || 0,
        estimatedTaxRate: product.estimatedTaxRate ?? DEFAULT_DEMO_TAX_RATE,
        currency: product.currency || "USD",
      });
    } catch {
      priceValidityPassed = false;
      reasonCodes.push("INVALID_PRICE_DATA");
      violations.push({
        code: "INVALID_PRICE_DATA",
        message: "Failed to compute authoritative pricing breakdown.",
        expected: "Valid numerical prices",
        actual: "Pricing calculation error",
      });
      pricing = {
        itemPrice: 0,
        shippingCost: 0,
        estimatedTax: 0,
        totalCost: 0,
        itemPriceCents: 0,
        shippingCostCents: 0,
        estimatedTaxCents: 0,
        totalCostCents: 0,
        currency: "USD",
        isEstimate: true,
        taxCalculationDescription: "",
        shippingCalculationDescription: "",
      };
    }

    // 2. Stock & Availability Guardrail
    const inStockPassed = Boolean(product.inStock && product.stockQuantity > 0);
    if (!inStockPassed) {
      reasonCodes.push("OUT_OF_STOCK");
      violations.push({
        code: "OUT_OF_STOCK",
        message: `Product is currently out of stock (inventory: ${product.stockQuantity ?? 0}).`,
        expected: "In Stock (qty > 0)",
        actual: `Out of Stock (${product.stockQuantity ?? 0})`,
      });
    }

    // 3. Hard Budget Guardrail (Landed Total Cents <= Max Budget Cents)
    // CRITICAL: A product priced below budget before shipping/tax that exceeds it
    // after shipping/tax MUST be rejected. No rounding down failing totals!
    const maxBudgetCents = Math.round(constraints.maxBudget * 100);
    const budgetCentsDiff = maxBudgetCents - pricing.totalCostCents;
    const budgetPassed = budgetCentsDiff >= 0;

    if (!budgetPassed) {
      const overageDollars = (Math.abs(budgetCentsDiff) / 100).toFixed(2);
      reasonCodes.push("EXCEEDS_BUDGET");
      violations.push({
        code: "EXCEEDS_BUDGET",
        message: `Total landed cost ($${(pricing.totalCostCents / 100).toFixed(2)}) exceeds user budget limit ($${constraints.maxBudget.toFixed(2)}) by $${overageDollars}.`,
        expected: `$${constraints.maxBudget.toFixed(2)}`,
        actual: `$${(pricing.totalCostCents / 100).toFixed(2)}`,
        diff: budgetCentsDiff / 100,
      });
    }

    // 4. Delivery Speed Guardrail
    const deliveryDaysDiff = constraints.maxDeliveryDays - product.deliveryDays;
    const deliveryPassed = deliveryDaysDiff >= 0;
    if (!deliveryPassed) {
      const daysOver = product.deliveryDays - constraints.maxDeliveryDays;
      reasonCodes.push("DELIVERY_TOO_SLOW");
      violations.push({
        code: "DELIVERY_TOO_SLOW",
        message: `Estimated delivery (${product.deliveryDays} business days) exceeds maximum allowed ${constraints.maxDeliveryDays} days by ${daysOver} day(s).`,
        expected: `≤ ${constraints.maxDeliveryDays} days`,
        actual: `${product.deliveryDays} days`,
        diff: deliveryDaysDiff,
      });
    }

    // 5. Rating Guardrail
    const ratingDiff = Math.round((product.rating - constraints.minRating) * 10) / 10;
    const ratingPassed = ratingDiff >= 0;
    if (!ratingPassed) {
      reasonCodes.push("RATING_TOO_LOW");
      violations.push({
        code: "RATING_TOO_LOW",
        message: `Customer rating (${product.rating}★) is below user threshold of ${constraints.minRating}★.`,
        expected: `≥ ${constraints.minRating}★`,
        actual: `${product.rating}★`,
        diff: ratingDiff,
      });
    }

    // 6. Brand Matching (Distinguishing hard constraint vs soft preference)
    const hasBrandConstraint = Boolean(
      constraints.preferredBrand && constraints.preferredBrand.trim().length > 0
    );
    let brandMatch = false;
    let brandPassed = true;

    if (hasBrandConstraint) {
      const targetBrand = constraints.preferredBrand!.toLowerCase().trim();
      brandMatch = product.brand.toLowerCase().trim() === targetBrand;

      const enforceHardBrand =
        options?.enforceBrandAsHardConstraint ??
        constraints.optimizationPreference === "PREFERRED_BRAND";

      if (enforceHardBrand && !brandMatch) {
        brandPassed = false;
        reasonCodes.push("BRAND_MISMATCH");
        violations.push({
          code: "BRAND_MISMATCH",
          message: `Product brand "${product.brand}" does not match required brand "${constraints.preferredBrand}".`,
          expected: constraints.preferredBrand!,
          actual: product.brand,
        });
      }
    }

    // Master eligibility status
    const eligible =
      priceValidityPassed &&
      inStockPassed &&
      budgetPassed &&
      deliveryPassed &&
      ratingPassed &&
      brandPassed;

    // Human-readable summary
    let humanReadableSummary = "";
    if (eligible) {
      humanReadableSummary = `Passed all policy checks: Total $${(
        pricing.totalCostCents / 100
      ).toFixed(2)} ≤ $${constraints.maxBudget.toFixed(2)}, delivered in ${
        product.deliveryDays
      }d, rated ${product.rating}★.`;
    } else {
      humanReadableSummary = `Ineligible: ${violations.map((v) => v.message).join(" ")}`;
    }

    return {
      eligible,
      productId: product.id,
      productTitle: product.title,
      pricing,
      reasonCodes,
      violations,
      humanReadableSummary,
      inStockPassed,
      budgetPassed,
      deliveryPassed,
      ratingPassed,
      brandPassed,
      priceValidityPassed,
      softPreferences: {
        brandMatch,
        isPreferredBrand: brandMatch,
      },
      constraintDiffs: {
        budgetCentsDiff,
        deliveryDaysDiff,
        ratingDiff,
      },
    };
  }

  /**
   * Evaluates all candidates, strictly isolates eligible items, and ranks ONLY eligible candidates.
   * If zero products satisfy all constraints, returns a structured failure outcome with
   * transparent violation breakdown and suggested user adjustments.
   *
   * NEVER SILENTLY RELAXES CONSTRAINTS.
   */
  public static evaluateAndRank(
    products: CatalogProduct[],
    constraints: ShoppingConstraints,
    options?: GuardrailEngineOptions
  ): GuardrailEvaluationOutcome {
    const evaluated = products.map((product) => ({
      product,
      guardrailResult: GuardrailEngine.evaluateProduct(product, constraints, options),
    }));

    const violationBreakdown: Record<GuardrailViolationCode, number> = {
      OUT_OF_STOCK: 0,
      EXCEEDS_BUDGET: 0,
      DELIVERY_TOO_SLOW: 0,
      RATING_TOO_LOW: 0,
      BRAND_MISMATCH: 0,
      INVALID_PRICE_DATA: 0,
    };

    const eligibleList: {
      product: CatalogProduct;
      guardrailResult: GuardrailCheckResult;
      score: number;
      reasons: string[];
    }[] = [];

    const disqualifiedCandidates: DisqualifiedProduct[] = [];

    for (const item of evaluated) {
      if (item.guardrailResult.eligible) {
        // Calculate deterministic score based on optimization preference
        const { score, reasons } = GuardrailEngine.calculateRankingScore(
          item.product,
          item.guardrailResult.pricing,
          constraints,
          item.guardrailResult.softPreferences.brandMatch
        );

        eligibleList.push({
          product: item.product,
          guardrailResult: item.guardrailResult,
          score,
          reasons,
        });
      } else {
        // Track violation codes
        for (const code of item.guardrailResult.reasonCodes) {
          violationBreakdown[code] = (violationBreakdown[code] || 0) + 1;
        }

        disqualifiedCandidates.push({
          product: item.product,
          pricing: item.guardrailResult.pricing,
          guardrailResult: item.guardrailResult,
          failedReasonCodes: item.guardrailResult.reasonCodes,
          reasons: item.guardrailResult.violations.map((v) => v.message),
        });
      }
    }

    // Rank ONLY eligible products deterministically
    eligibleList.sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      // Deterministic tie-breaker 1: Lowest Landed Cost (Cents)
      if (a.guardrailResult.pricing.totalCostCents !== b.guardrailResult.pricing.totalCostCents) {
        return a.guardrailResult.pricing.totalCostCents - b.guardrailResult.pricing.totalCostCents;
      }
      // Deterministic tie-breaker 2: Fastest Delivery
      if (a.product.deliveryDays !== b.product.deliveryDays) {
        return a.product.deliveryDays - b.product.deliveryDays;
      }
      // Deterministic tie-breaker 3: Highest Rating
      if (b.product.rating !== a.product.rating) {
        return b.product.rating - a.product.rating;
      }
      // Final tie-breaker: Stable ID
      return a.product.id.localeCompare(b.product.id);
    });

    const rankedEligible: RankedProduct[] = eligibleList.map((item, index) => ({
      rank: index + 1,
      product: item.product,
      pricing: item.guardrailResult.pricing,
      guardrailResult: item.guardrailResult,
      score: item.score,
      reasons: item.reasons,
    }));

    const hasEligibleProducts = rankedEligible.length > 0;
    const selectedRecommendation = hasEligibleProducts ? rankedEligible[0] : null;

    // Generate actionable suggestions if no candidates are eligible
    const suggestedAdjustments: string[] = [];
    if (!hasEligibleProducts && products.length > 0) {
      if (violationBreakdown.EXCEEDS_BUDGET > 0) {
        // Find smallest budget overage
        const overages = disqualifiedCandidates
          .filter((d) => d.failedReasonCodes.includes("EXCEEDS_BUDGET"))
          .map((d) => Math.abs(d.guardrailResult.constraintDiffs.budgetCentsDiff));
        if (overages.length > 0) {
          const minOverage = Math.min(...overages);
          const suggestedBudget = (
            (Math.round(constraints.maxBudget * 100) + minOverage) /
            100
          ).toFixed(2);
          suggestedAdjustments.push(
            `Increase budget to at least $${suggestedBudget} to unlock closer candidate products.`
          );
        }
      }

      if (violationBreakdown.DELIVERY_TOO_SLOW > 0) {
        const fastestDisqualified = Math.min(
          ...disqualifiedCandidates
            .filter((d) => d.failedReasonCodes.includes("DELIVERY_TOO_SLOW"))
            .map((d) => d.product.deliveryDays)
        );
        if (Number.isFinite(fastestDisqualified)) {
          suggestedAdjustments.push(
            `Extend delivery timeline to ${fastestDisqualified} business days to include available inventory.`
          );
        }
      }

      if (violationBreakdown.RATING_TOO_LOW > 0) {
        suggestedAdjustments.push(
          `Adjust minimum rating filter to 3.5★ to view more value-oriented alternatives.`
        );
      }

      if (violationBreakdown.BRAND_MISMATCH > 0) {
        suggestedAdjustments.push(
          `Remove or broaden the brand filter "${constraints.preferredBrand}" to see compatible options from other verified makers.`
        );
      }
    } else if (!hasEligibleProducts && products.length === 0) {
      suggestedAdjustments.push(
        "No catalog items matched this search query or category. The demo catalog currently includes audio gear (headphones/earbuds), mechanical keyboards, computer mice, 4K monitors, docks/hubs, webcams, power banks, ergonomic chairs, and standing desks."
      );
    }

    // Explanation summary
    let explanation = "";
    if (hasEligibleProducts) {
      const top = rankedEligible[0];
      explanation = `Found ${rankedEligible.length} compliant product(s). Top choice is "${
        top.product.title
      }" with landed total $${(top.pricing.totalCostCents / 100).toFixed(
        2
      )} (${top.reasons.join(", ")}).`;
    } else {
      const reasonsList = Object.entries(violationBreakdown)
        .filter(([, count]) => count > 0)
        .map(([code, count]) => `${count} candidate(s) failed on ${code}`)
        .join("; ");
      if (reasonsList) {
        explanation = `No eligible products found satisfying all hard constraints. Filter breakdown: ${reasonsList}. Hard constraints will NOT be silently relaxed.`;
      } else {
        explanation =
          "No products in the catalog matched the search keywords or category. The demo catalog focuses on audio gear, keyboards, mice, monitors, office chairs, and desks.";
      }
    }

    return {
      hasEligibleProducts,
      selectedRecommendation,
      rankedEligible,
      disqualifiedCandidates,
      totalEvaluated: products.length,
      eligibleCount: rankedEligible.length,
      disqualifiedCount: disqualifiedCandidates.length,
      violationBreakdown,
      suggestedAdjustments,
      explanation,
    };
  }

  /**
   * Calculates deterministic ranking score for an ELIGIBLE candidate.
   */
  private static calculateRankingScore(
    product: CatalogProduct,
    pricing: AuthoritativePricing,
    constraints: ShoppingConstraints,
    brandMatch: boolean
  ): { score: number; reasons: string[] } {
    const reasons: string[] = [];
    let score = 1000; // Base score for fulfilling all hard constraints

    switch (constraints.optimizationPreference) {
      case "LOWEST_PRICE": {
        // Savings ratio relative to max budget
        const budgetCents = Math.round(constraints.maxBudget * 100);
        const savingsCents = Math.max(0, budgetCents - pricing.totalCostCents);
        const savingsPercentage = budgetCents > 0 ? (savingsCents / budgetCents) * 500 : 0;

        score += savingsPercentage;
        score += product.rating * 15;
        score += Math.max(0, 10 - product.deliveryDays) * 5;

        reasons.push(
          `Lowest Landed Cost ($${(pricing.totalCostCents / 100).toFixed(2)})`
        );
        if (pricing.shippingCostCents === 0) {
          reasons.push("Free Shipping");
        }
        break;
      }

      case "PREFERRED_BRAND": {
        if (brandMatch) {
          score += 600;
          reasons.push(`Preferred Brand (${product.brand})`);
        }
        score += product.rating * 40;
        score += (constraints.maxBudget - pricing.totalCost) * 1.5;
        score += Math.max(0, 7 - product.deliveryDays) * 10;
        reasons.push(`Fast ${product.deliveryDays}-day delivery`);
        break;
      }

      case "BEST_VALUE":
      default: {
        const ratingBonus = product.rating * 50;
        const reviewConfidence = Math.min(Math.log10(product.reviewCount + 1) * 30, 120);
        const budgetSavingsRatio =
          constraints.maxBudget > 0
            ? ((constraints.maxBudget - pricing.totalCost) / constraints.maxBudget) * 180
            : 0;
        const deliverySpeedBonus = Math.max(0, 7 - product.deliveryDays) * 15;
        const brandBonus = brandMatch ? 200 : 0;

        score += ratingBonus + reviewConfidence + budgetSavingsRatio + deliverySpeedBonus + brandBonus;

        reasons.push(
          `Top Value: ${product.rating}★ rating (${product.reviewCount.toLocaleString()} reviews)`
        );
        reasons.push(`${product.deliveryDays} business day delivery`);
        if (pricing.shippingCostCents === 0) {
          reasons.push("Free Shipping");
        }
        break;
      }
    }

    return { score: Math.round(score), reasons };
  }
}
