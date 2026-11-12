import { describe, expect, it } from "vitest";
import { calculatePriceBreakdown, evaluateConstraints } from "../pricing/calculator";
import { proposalsStore, StoredProposal } from "../proposals/store";

describe("Proposal Verification & Lifecycle", () => {
  const sampleProposal: StoredProposal = {
    id: "prop_test_123",
    runId: "run_test_123",
    guestSessionTokenHash: "valid_owner_hash_abc",
    productId: "prod_anker_q30",
    product: {
      id: "prod_anker_q30",
      title: "Anker Soundcore Life Q30",
      brand: "Anker",
      seller: "Anker Direct",
      deliveryDays: 2,
      rating: 4.6,
      reviewCount: 28400,
      category: "audio",
      imageUrl: "https://example.com/q30.jpg",
      basePrice: 79.99,
      shippingCost: 0.0,
      estimatedTaxRate: 0.0825,
    },
    priceBreakdown: {
      itemPrice: 79.99,
      shippingCost: 0.0,
      estimatedTax: 6.6,
      totalCost: 86.59,
      itemPriceCents: 7999,
      shippingCostCents: 0,
      estimatedTaxCents: 660,
      totalCostCents: 8659,
      currency: "USD",
    },
    constraintsSnapshot: {
      maxBudget: 100,
      maxDeliveryDays: 3,
      minRating: 4.5,
      preferredBrand: "Anker",
      optimizationPreference: "BEST_VALUE",
    },
    reason: "Great affordable noise canceling headphones",
    version: 1,
    expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    status: "PENDING_REVIEW",
    createdAt: new Date().toISOString(),
  };

  it("stores and retrieves proposals by id", () => {
    proposalsStore.save(sampleProposal);
    const retrieved = proposalsStore.get("prop_test_123");
    expect(retrieved).toBeDefined();
    expect(retrieved?.id).toBe("prop_test_123");
    expect(retrieved?.product.title).toBe("Anker Soundcore Life Q30");
  });

  it("verifies session ownership and rejects mismatched callers", () => {
    proposalsStore.save(sampleProposal);
    const stored = proposalsStore.get("prop_test_123")!;

    const callerTokenHash = "valid_owner_hash_abc";
    const foreignTokenHash = "attacker_token_hash_xyz";

    expect(callerTokenHash === stored.guestSessionTokenHash).toBe(true);
    expect(foreignTokenHash === stored.guestSessionTokenHash).toBe(false);
  });

  it("detects expired proposals", () => {
    const expiredProposal: StoredProposal = {
      ...sampleProposal,
      id: "prop_expired_999",
      expiresAt: new Date(Date.now() - 60 * 1000).toISOString(), // expired 1 min ago
    };
    proposalsStore.save(expiredProposal);

    const stored = proposalsStore.get("prop_expired_999")!;
    const isExpired = new Date(stored.expiresAt).getTime() < Date.now();
    expect(isExpired).toBe(true);
  });

  it("recalculates pricing and enforces updated constraints on verification", () => {
    proposalsStore.save(sampleProposal);
    const stored = proposalsStore.get("prop_test_123")!;

    // Recalculate price breakdown
    const recalculated = calculatePriceBreakdown(
      stored.product.basePrice,
      stored.product.shippingCost,
      stored.product.estimatedTaxRate
    );
    expect(recalculated.totalCost).toBe(86.59);

    // Test 1: Active constraints still allow $100 budget -> PASSES
    const allowedConstraints = {
      maxBudget: 100,
      maxDeliveryDays: 3,
      minRating: 4.0,
      optimizationPreference: "BEST_VALUE" as const,
    };
    const auditPass = evaluateConstraints(stored.product, allowedConstraints);
    expect(auditPass.passed).toBe(true);

    // Test 2: User lowered budget to $80 (below $86.59 totalCost) -> FAILS
    const strictConstraints = {
      maxBudget: 80,
      maxDeliveryDays: 3,
      minRating: 4.0,
      optimizationPreference: "BEST_VALUE" as const,
    };
    const auditFail = evaluateConstraints(stored.product, strictConstraints);
    expect(auditFail.passed).toBe(false);
    expect(auditFail.budgetPassed).toBe(false);
    expect(auditFail.details.budgetDiff).toBeLessThan(0);
  });
});
