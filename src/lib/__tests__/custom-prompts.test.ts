import { describe, expect, it } from "vitest";
import { AgentOrchestrator } from "../agent/orchestrator";
import { catalogService } from "../catalog/service";
import { MockLlmAdapter } from "../llm/mock-adapter";
import { ShoppingConstraints } from "../types/agent";

describe("Bug Fix: Custom Shopping Requests vs Quick Prompts", () => {
  const defaultConstraints: ShoppingConstraints = {
    maxBudget: 200,
    maxDeliveryDays: 5,
    minRating: 4.5,
    preferredBrand: "",
    optimizationPreference: "BEST_VALUE",
  };

  const llm = new MockLlmAdapter();

  describe("Free-text constraint extraction", () => {
    it("extracts budget, currency, delivery deadline, minimum rating, brand, and optimization preference", async () => {
      const res = await llm.extractConstraints(
        "Find Sony noise cancelling headphones under $400 delivered in 2 days with 4.8 rating",
        defaultConstraints
      );

      expect(res.extractedConstraints.maxBudget).toBe(400);
      expect(res.extractedConstraints.currency).toBe("USD");
      expect(res.extractedConstraints.maxDeliveryDays).toBe(2);
      expect(res.extractedConstraints.minRating).toBe(4.8);
      expect(res.extractedConstraints.preferredBrand).toBe("Sony");
      expect(res.extractedConstraints.optimizationPreference).toBe("PREFERRED_BRAND");
      expect(res.detectedCategory).toBe("headphones");
    });

    it("does not assume all fields are present in every prompt and preserves fallbacks", async () => {
      const res = await llm.extractConstraints("Find a mechanical keyboard", defaultConstraints);

      expect(res.extractedConstraints.maxBudget).toBe(200);
      expect(res.extractedConstraints.maxDeliveryDays).toBe(5);
      expect(res.extractedConstraints.minRating).toBe(4.5);
      expect(res.extractedConstraints.preferredBrand || undefined).toBeUndefined();
      expect(res.detectedCategory).toBe("keyboards");
    });

    it("extracts lowest-price preference for budget keywords", async () => {
      const res = await llm.extractConstraints("cheapest wireless mouse under $50", defaultConstraints);
      expect(res.extractedConstraints.optimizationPreference).toBe("LOWEST_PRICE");
      expect(res.extractedConstraints.maxBudget).toBe(50);
      expect(res.detectedCategory).toBe("accessories");
    });

    it("recognizes all catalog brands including BenQ and UPLIFT", async () => {
      const benqRes = await llm.extractConstraints("BenQ monitor light bar under $200", defaultConstraints);
      expect(benqRes.extractedConstraints.preferredBrand).toBe("BenQ");

      const upliftRes = await llm.extractConstraints("UPLIFT standing desk", defaultConstraints);
      expect(upliftRes.extractedConstraints.preferredBrand).toBe("UPLIFT");
    });
  });

  describe("Catalog precision & stop-word pollution prevention", () => {
    it("never returns a monitor light bar when user searches for a chair", () => {
      const results = catalogService.search({
        query: "Ergonomic chair with 4.5+ rating",
        category: "home-office",
      });

      // Must find the chair
      expect(results.some((p) => p.title.toLowerCase().includes("chair"))).toBe(true);
      // Must NOT match BenQ monitor light bar purely on 'with' or '4.5+'
      expect(results.some((p) => p.id === "prod_benq_screenbar_halo")).toBe(false);
    });

    it("never returns a non-mechanical membrane keyboard when user searches for mechanical keyboard", () => {
      const results = catalogService.search({
        query: "Find a mechanical keyboard under $220",
        category: "keyboards",
      });

      expect(results.length).toBeGreaterThan(0);
      // Only genuine mechanical keyboards should match
      for (const item of results) {
        const text = `${item.title} ${item.description} ${JSON.stringify(item.attributes)}`.toLowerCase();
        expect(text).toMatch(/mechanical|switches|gasket/);
      }
      expect(results.some((p) => p.id === "prod_logi_mx_keys_s")).toBe(false);
      expect(results.some((p) => p.id === "prod_ecotype_membrane_keyboard")).toBe(false);
    });

    it("never returns a power bank when user searches for a 4K IPS monitor", () => {
      const results = catalogService.search({
        query: "4K IPS Monitor under $400",
        category: "electronics",
      });

      expect(results.some((p) => p.id === "prod_anker_737_powerbank")).toBe(false);
      expect(results.every((p) => p.title.toLowerCase().includes("monitor"))).toBe(true);
    });
  });

  describe("End-to-End Orchestrator Flows", () => {
    it("Working quick prompt: 'Find wireless headphones under $150' stages Anker Q30", async () => {
      const runId = `test_qp_${Date.now()}`;
      const result = await AgentOrchestrator.execute({
        query: "Find wireless headphones under $150",
        constraints: {
          maxBudget: 150,
          maxDeliveryDays: 3,
          minRating: 4.5,
          preferredBrand: "",
          optimizationPreference: "BEST_VALUE",
        },
        runId,
        guestSessionTokenHash: "dummy_hash_qp",
      });

      expect(result.success).toBe(true);
      expect(result.proposal).toBeDefined();
      expect(result.proposal?.product.id).toBe("prod_anker_q30");
      expect(result.proposal?.priceBreakdown.totalCostCents).toBeLessThanOrEqual(15000);
    });

    it("Failing custom prompt 1 fixed: 'Find a mechanical keyboard under $220' stages Keychron or Razer, not Logitech MX Keys", async () => {
      const runId = `test_custom_mech_${Date.now()}`;
      const result = await AgentOrchestrator.execute({
        query: "Find a mechanical keyboard under $220",
        constraints: defaultConstraints, // starts with default slider constraints
        runId,
        guestSessionTokenHash: "dummy_hash_mech",
      });

      expect(result.success).toBe(true);
      expect(result.proposal).toBeDefined();
      expect(["prod_keychron_q1_pro", "prod_razer_huntsman_mini"]).toContain(
        result.proposal?.product.id
      );
      expect(result.proposal?.product.id).not.toBe("prod_logi_mx_keys_s");
    });

    it("Failing custom prompt 2 fixed: 'Sony headphones under $400' stages Sony WH-1000XM5, not JBL or Anker", async () => {
      const runId = `test_custom_sony_${Date.now()}`;
      const result = await AgentOrchestrator.execute({
        query: "Sony headphones under $400",
        constraints: defaultConstraints,
        runId,
        guestSessionTokenHash: "dummy_hash_sony",
      });

      expect(result.success).toBe(true);
      expect(result.proposal).toBeDefined();
      expect(result.proposal?.product.id).toBe("prod_sony_wh1000xm5");
      expect(result.proposal?.product.brand).toBe("Sony");
    });

    it("Failing custom prompt 3 fixed: 'Ergonomic chair with 4.5+ rating' with $200 default budget does not stage a light bar, reports no-eligible with closest chair", async () => {
      const runId = `test_custom_chair_low_${Date.now()}`;
      const result = await AgentOrchestrator.execute({
        query: "Ergonomic chair with 4.5+ rating",
        constraints: defaultConstraints, // default maxBudget is $200
        runId,
        guestSessionTokenHash: "dummy_hash_chair_low",
      });

      // Must not stage BenQ ScreenBar Halo as a chair
      expect(result.proposal).toBeUndefined();
      expect(result.noEligibleProducts).toBe(true);
      expect(result.violationBreakdown?.EXCEEDS_BUDGET).toBeGreaterThan(0);
      expect(result.closestAlternative?.product.id).toBe("prod_steelcase_series1");
    });

    it("Custom prompt with sufficient budget: 'Ergonomic chair under $550' stages Steelcase Series 1", async () => {
      const runId = `test_custom_chair_high_${Date.now()}`;
      const result = await AgentOrchestrator.execute({
        query: "Ergonomic chair under $550",
        constraints: defaultConstraints,
        runId,
        guestSessionTokenHash: "dummy_hash_chair_high",
      });

      expect(result.success).toBe(true);
      expect(result.proposal).toBeDefined();
      expect(result.proposal?.product.id).toBe("prod_steelcase_series1");
      expect(result.proposal?.product.brand).toBe("Steelcase");
    });

    it("Disentangles budget from delivery days with currency: 'Find a face wash under ₹300 that can be delivered within 7 days'", async () => {
      const mockLlm = new MockLlmAdapter();
      const extracted = await mockLlm.extractConstraints(
        "Find a face wash under ₹300 that can be delivered within 7 days",
        defaultConstraints
      );

      // Must extract budget 300 (not 7 from 'within 7 days')
      expect(extracted.extractedConstraints.maxBudget).toBe(300);
      expect(extracted.extractedConstraints.maxDeliveryDays).toBe(7);
      expect(extracted.extractedConstraints.currency).toBe("INR");
    });

    it("Skincare custom prompt: 'find face wash for dry skin under $30' stages CeraVe or Cetaphil", async () => {
      const runId = `test_face_wash_${Date.now()}`;
      const result = await AgentOrchestrator.execute({
        query: "find face wash for dry skin under $30",
        constraints: {
          ...defaultConstraints,
          maxBudget: 30,
        },
        runId,
        guestSessionTokenHash: "dummy_hash_facewash",
      });

      expect(result.success).toBe(true);
      expect([
        "prod_cerave_hydrating_cleanser",
        "prod_cetaphil_gentle_cleanser",
        "prod_minimalist_salicylic_cleanser",
      ]).toContain(result.proposal?.product.id);
    });

    it("Dynamic synthesis: arbitrary custom prompt 'running shoes for men under $80' synthesizes compliant proposal", async () => {
      const runId = `test_running_shoes_${Date.now()}`;
      const result = await AgentOrchestrator.execute({
        query: "running shoes for men under $80",
        constraints: {
          ...defaultConstraints,
          maxBudget: 80,
        },
        runId,
        guestSessionTokenHash: "dummy_hash_shoes",
      });

      expect(result.success).toBe(true);
      expect(result.proposal).toBeDefined();
      expect(result.proposal?.product.title).toContain("Running Shoes");
      expect(result.proposal?.priceBreakdown.totalCostCents).toBeLessThanOrEqual(8000);
    });

    it("Drinkware precision: 'find thermo water bottle of 1 litre' stages a bottle, NEVER a face wash", async () => {
      const runId = `test_water_bottle_${Date.now()}`;
      const result = await AgentOrchestrator.execute({
        query: "find thermo water bottle of 1 litre",
        constraints: {
          ...defaultConstraints,
          maxBudget: 25,
        },
        runId,
        guestSessionTokenHash: "dummy_hash_bottle",
      });

      expect(result.success).toBe(true);
      expect(result.proposal).toBeDefined();
      expect(result.proposal?.product.title.toLowerCase()).toContain("bottle");
      expect(["prod_thermoflask_1l", "prod_hydroflask_32oz"]).toContain(result.proposal?.product.id);
      expect(result.proposal?.product.id).not.toBe("prod_laroche_hydrating_cleanser");
    });
  });
});

