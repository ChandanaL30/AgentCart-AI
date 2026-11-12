import { describe, expect, it } from "vitest";
import { evaluateConstraints, rankProducts } from "../pricing/calculator";
import { ShoppingConstraints } from "../types/agent";

describe("Constraint Evaluation & Ranking", () => {
  const sampleConstraints: ShoppingConstraints = {
    maxBudget: 150.0,
    maxDeliveryDays: 3,
    minRating: 4.5,
    preferredBrand: "Sony",
    optimizationPreference: "BEST_VALUE",
  };

  const withinBudgetProduct = {
    id: "p1",
    title: "Sony WH-CH720N Noise Canceling Headphones",
    brand: "Sony",
    seller: "Sony Direct",
    basePrice: 120.0,
    shippingCost: 0,
    estimatedTaxRate: 0.08,
    rating: 4.6,
    reviewCount: 3200,
    deliveryDays: 2,
  };

  const overBudgetProduct = {
    id: "p2",
    title: "Bose 700 Headphones",
    brand: "Bose",
    seller: "Audio Store",
    basePrice: 250.0,
    shippingCost: 5,
    estimatedTaxRate: 0.08,
    rating: 4.8,
    reviewCount: 4500,
    deliveryDays: 2,
  };

  const slowDeliveryProduct = {
    id: "p3",
    title: "Sony Extra Bass",
    brand: "Sony",
    seller: "Electronics Depot",
    basePrice: 90.0,
    shippingCost: 0,
    estimatedTaxRate: 0.08,
    rating: 4.6,
    reviewCount: 1100,
    deliveryDays: 6, // exceeds max 3 days
  };

  it("passes product that satisfies budget, delivery, and rating constraints", () => {
    const result = evaluateConstraints(withinBudgetProduct, sampleConstraints);
    expect(result.passed).toBe(true);
    expect(result.budgetPassed).toBe(true);
    expect(result.deliveryPassed).toBe(true);
    expect(result.ratingPassed).toBe(true);
    expect(result.details.brandMatch).toBe(true);
  });

  it("fails product when total landed cost exceeds budget constraint", () => {
    const result = evaluateConstraints(overBudgetProduct, sampleConstraints);
    expect(result.passed).toBe(false);
    expect(result.budgetPassed).toBe(false);
    expect(result.details.budgetDiff).toBeLessThan(0);
  });

  it("fails product when delivery estimate exceeds maximum delivery days", () => {
    const result = evaluateConstraints(slowDeliveryProduct, sampleConstraints);
    expect(result.passed).toBe(false);
    expect(result.deliveryPassed).toBe(false);
    expect(result.details.deliveryDiff).toBeLessThan(0);
  });

  it("ranks compliant candidates higher than non-compliant candidates", () => {
    const ranked = rankProducts(
      [overBudgetProduct, withinBudgetProduct, slowDeliveryProduct],
      sampleConstraints
    );

    expect(ranked[0].product.id).toBe("p1");
    expect(ranked[0].constraintEvaluation.passed).toBe(true);
  });

  it("prioritizes lowest price when optimization preference is LOWEST_PRICE", () => {
    const cheaperCompliantProduct = {
      id: "p4",
      title: "Anker Q20",
      brand: "Anker",
      seller: "Anker Store",
      basePrice: 59.99,
      shippingCost: 0,
      estimatedTaxRate: 0.08,
      rating: 4.5,
      reviewCount: 9000,
      deliveryDays: 2,
    };

    const lowestPriceConstraints: ShoppingConstraints = {
      ...sampleConstraints,
      preferredBrand: undefined,
      optimizationPreference: "LOWEST_PRICE",
    };

    const ranked = rankProducts(
      [withinBudgetProduct, cheaperCompliantProduct],
      lowestPriceConstraints
    );

    expect(ranked[0].product.id).toBe("p4");
    expect(ranked[0].breakdown.totalCost).toBeLessThan(ranked[1].breakdown.totalCost);
  });
});
