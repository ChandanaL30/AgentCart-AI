import { describe, expect, it } from "vitest";
import { CatalogService } from "../catalog/service";
import { GuardrailEngine } from "../guardrails/engine";
import {
  FIXTURE_1_ELIGIBLE,
  FIXTURE_2_CONSTRAINTS,
  FIXTURE_2_LANDED_OVER_BUDGET,
  FIXTURE_3_SLOW_DELIVERY,
  FIXTURE_4_OUT_OF_STOCK,
  FIXTURE_5_LOW_RATING,
  FIXTURE_6_BRAND_MISMATCH,
  FIXTURE_7_CANDIDATES,
  FIXTURE_8_PRODUCT_A,
  FIXTURE_8_PRODUCT_B,
  FIXTURE_STANDARD_CONSTRAINTS,
} from "../guardrails/fixtures";
import { calculateAuthoritativePricing } from "../pricing/calculator";
import { ShoppingConstraints } from "../types/agent";

describe("Phase 2 — Authoritative Pricing & Integer Minor Units", () => {
  it("calculates landed cost breakdown strictly using integer minor units (cents)", () => {
    // $120.00 base, $5.99 shipping, 8.25% tax
    // Base: 12000 cents
    // Shipping: 599 cents
    // Tax: round(12000 * 0.0825) = round(990) = 990 cents ($9.90)
    // Total: 12000 + 599 + 990 = 13589 cents ($135.89)
    const pricing = calculateAuthoritativePricing({
      priceCents: 12000,
      shippingFeeCents: 599,
      estimatedTaxRate: 0.0825,
      currency: "USD",
    });

    expect(pricing.itemPriceCents).toBe(12000);
    expect(pricing.shippingCostCents).toBe(599);
    expect(pricing.estimatedTaxCents).toBe(990);
    expect(pricing.totalCostCents).toBe(13589);

    // Decimal outputs are strictly derived from cents
    expect(pricing.itemPrice).toBe(120.0);
    expect(pricing.shippingCost).toBe(5.99);
    expect(pricing.estimatedTax).toBe(9.9);
    expect(pricing.totalCost).toBe(135.89);
    expect(pricing.isEstimate).toBe(true);
  });

  it("handles fractional tax rates with exact nearest-cent rounding", () => {
    // $79.99 base (7999 cents), $0 shipping, 8.25% tax
    // Tax: 7999 * 0.0825 = 659.9175 -> 660 cents ($6.60)
    // Total: 7999 + 0 + 660 = 8659 cents ($86.59)
    const pricing = calculateAuthoritativePricing({
      priceCents: 7999,
      shippingFeeCents: 0,
      estimatedTaxRate: 0.0825,
    });

    expect(pricing.itemPriceCents).toBe(7999);
    expect(pricing.estimatedTaxCents).toBe(660);
    expect(pricing.totalCostCents).toBe(8659);
    expect(pricing.totalCost).toBe(86.59);
  });

  it("rejects negative or invalid price inputs without silent corruption", () => {
    expect(() =>
      calculateAuthoritativePricing({ priceCents: -500 })
    ).toThrowError(/Invalid item price cents/);

    expect(() =>
      calculateAuthoritativePricing({ priceCents: NaN })
    ).toThrowError(/Invalid item price cents/);
  });
});

describe("Phase 2 — Deterministic Hard Guardrails Engine", () => {
  it("Fixture 1: passes fully eligible product meeting all hard constraints", () => {
    const result = GuardrailEngine.evaluateProduct(
      FIXTURE_1_ELIGIBLE,
      FIXTURE_STANDARD_CONSTRAINTS
    );

    expect(result.eligible).toBe(true);
    expect(result.reasonCodes).toHaveLength(0);
    expect(result.inStockPassed).toBe(true);
    expect(result.budgetPassed).toBe(true);
    expect(result.deliveryPassed).toBe(true);
    expect(result.ratingPassed).toBe(true);
    expect(result.brandPassed).toBe(true);
    expect(result.pricing.totalCostCents).toBeLessThanOrEqual(
      FIXTURE_STANDARD_CONSTRAINTS.maxBudget * 100
    );
  });

  it("Fixture 2: REJECTS product whose sticker price is under budget but landed cost exceeds budget after shipping and tax", () => {
    // User Budget: $100.00 (10000 cents)
    // Sticker Price: $95.00 (under budget)
    // Shipping: $10.00
    // Tax: $7.84
    // Landed Total: $112.84 (exceeds budget by $12.84)
    const result = GuardrailEngine.evaluateProduct(
      FIXTURE_2_LANDED_OVER_BUDGET,
      FIXTURE_2_CONSTRAINTS
    );

    expect(result.eligible).toBe(false);
    expect(result.budgetPassed).toBe(false);
    expect(result.reasonCodes).toContain("EXCEEDS_BUDGET");
    expect(result.pricing.totalCostCents).toBe(11284);
    expect(result.violations[0].diff).toBe(-12.84);

    // Verify it is NEVER rounded down to become eligible
    expect(result.pricing.totalCost).toBeGreaterThan(FIXTURE_2_CONSTRAINTS.maxBudget);
  });

  it("Fixture 3: REJECTS product whose delivery timeline exceeds user deadline", () => {
    const result = GuardrailEngine.evaluateProduct(
      FIXTURE_3_SLOW_DELIVERY,
      FIXTURE_STANDARD_CONSTRAINTS // Max delivery is 3 days, product is 6 days
    );

    expect(result.eligible).toBe(false);
    expect(result.deliveryPassed).toBe(false);
    expect(result.reasonCodes).toContain("DELIVERY_TOO_SLOW");
    expect(result.constraintDiffs.deliveryDaysDiff).toBe(-3);
  });

  it("Fixture 4: REJECTS out-of-stock product", () => {
    const result = GuardrailEngine.evaluateProduct(
      FIXTURE_4_OUT_OF_STOCK,
      FIXTURE_STANDARD_CONSTRAINTS
    );

    expect(result.eligible).toBe(false);
    expect(result.inStockPassed).toBe(false);
    expect(result.reasonCodes).toContain("OUT_OF_STOCK");
  });

  it("Fixture 5: REJECTS product below user minimum rating", () => {
    const result = GuardrailEngine.evaluateProduct(
      FIXTURE_5_LOW_RATING,
      FIXTURE_STANDARD_CONSTRAINTS // Min rating is 4.5, product is 3.8
    );

    expect(result.eligible).toBe(false);
    expect(result.ratingPassed).toBe(false);
    expect(result.reasonCodes).toContain("RATING_TOO_LOW");
  });

  it("Fixture 6: REJECTS brand mismatch when required brand is enforced", () => {
    const brandEnforcedConstraints: ShoppingConstraints = {
      ...FIXTURE_STANDARD_CONSTRAINTS,
      preferredBrand: "Sony",
      optimizationPreference: "PREFERRED_BRAND",
    };

    const result = GuardrailEngine.evaluateProduct(
      FIXTURE_6_BRAND_MISMATCH, // Brand is Bose
      brandEnforcedConstraints,
      { enforceBrandAsHardConstraint: true }
    );

    expect(result.eligible).toBe(false);
    expect(result.brandPassed).toBe(false);
    expect(result.reasonCodes).toContain("BRAND_MISMATCH");
  });
});

describe("Phase 2 — Ranking & Landed Cost Alteration", () => {
  it("Fixture 8: shipping cost difference alters which product ranks first under LOWEST_PRICE", () => {
    // Product A: Base $80.00 + Ship $25.00 + Tax $6.60 = Landed $111.60
    // Product B: Base $85.00 + Ship $0.00  + Tax $7.01 = Landed $92.01
    const lowestPriceConstraints: ShoppingConstraints = {
      maxBudget: 150.0,
      maxDeliveryDays: 5,
      minRating: 4.0,
      preferredBrand: undefined,
      optimizationPreference: "LOWEST_PRICE",
    };

    const outcome = GuardrailEngine.evaluateAndRank(
      [FIXTURE_8_PRODUCT_A, FIXTURE_8_PRODUCT_B],
      lowestPriceConstraints
    );

    expect(outcome.hasEligibleProducts).toBe(true);
    expect(outcome.rankedEligible).toHaveLength(2);

    // Product B MUST rank #1 despite higher base sticker price ($85 vs $80)
    // because its landed total ($92.01) is lower than Product A's landed total ($111.60)
    const winner = outcome.rankedEligible[0];
    const runnerUp = outcome.rankedEligible[1];

    expect(winner.product.id).toBe(FIXTURE_8_PRODUCT_B.id);
    expect(winner.pricing.totalCostCents).toBe(9201);
    expect(runnerUp.product.id).toBe(FIXTURE_8_PRODUCT_A.id);
    expect(runnerUp.pricing.totalCostCents).toBe(11160);
    expect(winner.pricing.totalCostCents).toBeLessThan(runnerUp.pricing.totalCostCents);
  });

  it("maintains deterministic ranking order across multiple executions", () => {
    const outcome1 = GuardrailEngine.evaluateAndRank(
      [FIXTURE_1_ELIGIBLE, FIXTURE_8_PRODUCT_B],
      FIXTURE_STANDARD_CONSTRAINTS
    );
    const outcome2 = GuardrailEngine.evaluateAndRank(
      [FIXTURE_1_ELIGIBLE, FIXTURE_8_PRODUCT_B],
      FIXTURE_STANDARD_CONSTRAINTS
    );

    expect(outcome1.rankedEligible.map((r) => r.product.id)).toEqual(
      outcome2.rankedEligible.map((r) => r.product.id)
    );
    expect(outcome1.rankedEligible[0].score).toBe(outcome2.rankedEligible[0].score);
  });
});

describe("Phase 2 — No Eligible Products & Safety Safeguards", () => {
  it("Fixture 7: returns clear No-Eligible-Products outcome without relaxing hard constraints", () => {
    const outcome = GuardrailEngine.evaluateAndRank(
      FIXTURE_7_CANDIDATES,
      FIXTURE_2_CONSTRAINTS // Budget $100, Max delivery 5 days
    );

    expect(outcome.hasEligibleProducts).toBe(false);
    expect(outcome.selectedRecommendation).toBeNull();
    expect(outcome.rankedEligible).toHaveLength(0);
    expect(outcome.disqualifiedCandidates.length).toBe(FIXTURE_7_CANDIDATES.length);

    // Breakdown includes violated constraint codes
    expect(outcome.violationBreakdown.EXCEEDS_BUDGET).toBeGreaterThan(0);
    expect(outcome.violationBreakdown.OUT_OF_STOCK).toBeGreaterThan(0);

    // Offers transparent suggestions to the user
    expect(outcome.suggestedAdjustments.length).toBeGreaterThan(0);
    expect(outcome.explanation).toContain("No eligible products found");
  });

  it("CRITICAL SAFETY CHECK: NEVER recommends an ineligible product as the purchase choice", () => {
    // Only 1 product in catalog, and it exceeds the user budget
    const overBudgetCatalog = [FIXTURE_2_LANDED_OVER_BUDGET];

    const outcome = GuardrailEngine.evaluateAndRank(
      overBudgetCatalog,
      FIXTURE_2_CONSTRAINTS
    );

    // Guardrail must refuse to pick the product as selectedRecommendation
    expect(outcome.selectedRecommendation).toBeNull();
    expect(outcome.hasEligibleProducts).toBe(false);
    expect(outcome.rankedEligible).toHaveLength(0);

    // Disqualified product is properly recorded with its violation code
    expect(outcome.disqualifiedCandidates).toHaveLength(1);
    expect(outcome.disqualifiedCandidates[0].failedReasonCodes).toContain("EXCEEDS_BUDGET");
  });
});

describe("Phase 2 — Server-Side Catalog Service & Comparison", () => {
  const service = new CatalogService();

  it("filters products by category and stock status", () => {
    const results = service.search({
      category: "headphones",
      inStockOnly: true,
    });

    expect(results.length).toBeGreaterThan(0);
    results.forEach((item) => {
      expect(item.category).toBe("headphones");
      expect(item.inStock).toBe(true);
      expect(item.stockQuantity).toBeGreaterThan(0);
    });
  });

  it("filters products by landed budget cap in integer cents", () => {
    // Search with $100 budget cap (10000 cents)
    const results = service.search({
      maxBudgetCents: 10000,
    });

    results.forEach((item) => {
      const pricing = calculateAuthoritativePricing({
        priceCents: item.priceCents,
        shippingFeeCents: item.shippingFeeCents,
        estimatedTaxRate: item.estimatedTaxRate,
      });
      expect(pricing.totalCostCents).toBeLessThanOrEqual(10000);
    });
  });

  it("produces side-by-side comparison table and evidence-based explanation", () => {
    const comparison = service.compareProducts([
      "prod_sony_wh1000xm5",
      "prod_anker_q30",
    ]);

    expect(comparison.products).toHaveLength(2);
    expect(comparison.commonCategory).toBe("headphones");
    expect(comparison.lowestLandedCostProductId).toBe("prod_anker_q30");
    expect(comparison.fastestDeliveryProductId).toBeDefined();
    expect(comparison.explanation).toContain("offers the lowest total landed cost");
  });
});
