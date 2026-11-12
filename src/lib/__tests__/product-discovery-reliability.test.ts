import { describe, it, expect, beforeEach } from "vitest";
import { CatalogService } from "@/lib/catalog/service";
import { AgentOrchestrator } from "@/lib/agent/orchestrator";
import { agentRunsStore } from "@/lib/agent/runs-store";
import { calculateProductRelevance } from "@/lib/catalog/discovery/relevance";
import { discoveryCache } from "@/lib/catalog/discovery/cache";
import { paypalClient } from "@/lib/paypal/client";
import { proposalsStore } from "@/lib/proposals/store";
import { DEMO_CATALOG_ITEMS } from "@/lib/catalog/seed-data";

describe("AgentCart AI — Product Discovery Reliability & Identity Verification", () => {
  let catalogService: CatalogService;
  const testSessionHash = "test_discovery_reliability_session_hash";

  beforeEach(() => {
    catalogService = new CatalogService();
    discoveryCache.clear();
  });

  describe("1. Exact Product Search", () => {
    it("reliably retrieves exact model 'Sony WH-1000XM5' and ranks it #1", async () => {
      const results = await catalogService.searchAsync({
        query: "Sony WH-1000XM5",
      });

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].id).toBe("prod_sony_wh1000xm5");
      expect(results[0].brand).toBe("Sony");
      expect(results[0].title).toContain("WH-1000XM5");
      expect(results[0].imageUrl).toMatch(/^https?:\/\//);
    });

    it("reliably retrieves exact keyboard model 'Epomaker RT100'", async () => {
      const results = await catalogService.searchAsync({
        query: "Epomaker RT100 mechanical keyboard",
      });

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].title.toLowerCase()).toContain("epomaker rt100");
      expect(results[0].brand.toLowerCase()).toBe("epomaker");
      expect(results[0].productUrl).toContain("amazon.com");
    });
  });

  describe("2. New / Unseen Product Dynamic Discovery", () => {
    it("dynamically discovers 'Samsung T7 1TB external SSD' from marketplace catalog", async () => {
      const results = await catalogService.searchAsync({
        query: "Samsung T7 1TB portable external SSD",
      });

      expect(results.length).toBeGreaterThan(0);
      const item = results[0];
      expect(item.brand).toBe("Samsung");
      expect(item.model).toContain("Samsung Portable SSD T7");
      expect(item.imageUrl).toMatch(/^https:\/\/m\.media-amazon\.com/);
      expect(item.productUrl).toMatch(/^https:\/\/www\.amazon\.com\/dp\/B0874XN4D8/);
      expect(item.priceCents).toBe(10999);
      expect(item.sellerName).toBe("Samsung Official Store");
    });

    it("dynamically discovers kitchen appliance 'Instant Pot Pro 10-in-1 multi-use pressure cooker'", async () => {
      const results = await catalogService.searchAsync({
        query: "Instant Pot Pro 10-in-1 multi-use pressure cooker",
      });

      expect(results.length).toBeGreaterThan(0);
      const item = results[0];
      expect(item.brand).toBe("Instant Pot");
      expect(item.model).toContain("Pro 10-in-1");
      expect(item.productUrl).toContain("amazon.com/dp/B08PQ2KWHS");
      expect(item.imageUrl).toContain("media-amazon.com");
    });
  });

  describe("3. Strict Unrelated Product Rejection", () => {
    it("never returns Sony headphones when user searches for 'Sony PlayStation 5 console'", async () => {
      const results = await catalogService.searchAsync({
        query: "Sony PlayStation 5 console",
      });

      expect(results.length).toBe(0);
      const sonyHeadphones = DEMO_CATALOG_ITEMS.find((p) => p.id === "prod_sony_wh1000xm5")!;
      const relevance = calculateProductRelevance("Sony PlayStation 5 console", sonyHeadphones);
      expect(relevance).toBe(0);
    });

    it("never returns Logitech keyboard/mouse when user searches for 'Logitech webcam'", async () => {
      const results = await catalogService.searchAsync({
        query: "Logitech 4K Pro webcam",
      });

      expect(results.length).toBe(0);
      const logiKeyboard = DEMO_CATALOG_ITEMS.find((p) => p.id === "prod_logi_mx_keys_s")!;
      expect(calculateProductRelevance("Logitech 4K Pro webcam", logiKeyboard)).toBe(0);
    });

    it("never returns Dell monitors when user searches for 'Dell XPS 13 laptop'", async () => {
      const results = await catalogService.searchAsync({
        query: "Dell XPS 13 laptop",
      });

      expect(results.length).toBe(0);
      const dellMonitor = DEMO_CATALOG_ITEMS.find((p) => p.id === "prod_dell_u2723qe")!;
      expect(calculateProductRelevance("Dell XPS 13 laptop", dellMonitor)).toBe(0);
    });

    it("never returns Bose headphones when user searches for 'Bose Bluetooth speaker'", async () => {
      const results = await catalogService.searchAsync({
        query: "Bose Bluetooth speaker",
      });

      expect(results.length).toBe(0);
      const boseHeadphones = DEMO_CATALOG_ITEMS.find((p) => p.id === "prod_bose_qc45")!;
      expect(calculateProductRelevance("Bose Bluetooth speaker", boseHeadphones)).toBe(0);
    });

    it("rejects model code conflict: user searching 'Sony WH-1000XM4' does not match XM5", () => {
      const sonyXM5 = DEMO_CATALOG_ITEMS.find((p) => p.id === "prod_sony_wh1000xm5")!;
      const relevance = calculateProductRelevance("Sony WH-1000XM4", sonyXM5);
      expect(relevance).toBe(0);
    });
  });

  describe("4. No-Results Handling & Honest Rejection", () => {
    it("reports clean 'noExactMatch' outcome without silently substituting unrelated products", async () => {
      const runId = `run_test_nomatch_${Date.now()}`;
      const result = await AgentOrchestrator.execute({
        query: "Logitech C920 HD Pro Webcam",
        constraints: {
          maxBudget: 150,
          maxDeliveryDays: 5,
          minRating: 4.0,
          optimizationPreference: "BEST_VALUE",
        },
        runId,
        guestSessionTokenHash: testSessionHash,
      });

      expect(result.success).toBe(false);
      expect(result.proposal).toBeUndefined();
      expect(result.noEligibleProducts).toBe(true);
      expect(result.noExactMatch).toBe(true);
      expect(result.error).toContain("No exact match found");
      expect(result.suggestedAdjustments).toBeDefined();

      // Verify persisted run record
      const persisted = agentRunsStore.get(runId);
      expect(persisted).toBeDefined();
      expect(persisted?.status).toBe("FAILED");
      expect(persisted?.noExactMatch).toBe(true);
    });
  });

  describe("5. Product Image and Identity Consistency", () => {
    it("ensures all seed catalog items have authentic, non-empty images, prices, and sellers", () => {
      for (const item of DEMO_CATALOG_ITEMS) {
        expect(item.id).toBeTruthy();
        expect(item.title).toBeTruthy();
        expect(item.brand).toBeTruthy();
        expect(item.priceCents).toBeGreaterThan(0);
        expect(item.imageUrl).toMatch(/^https?:\/\//);
        expect(item.sellerName).toBeTruthy();
      }
    });

    it("ensures live API provider does not fabricate mock products or fake Amazon URLs", async () => {
      const { liveApiProvider } = await import("@/lib/catalog/discovery/live-api-provider");
      const results = await liveApiProvider.search({
        query: "Unseen arbitrary product 1234567890",
      });

      // Honest empty array when no authenticated live API is configured
      expect(results).toEqual([]);
    });
  });

  describe("6. Existing Guardrails and PayPal Sandbox Checkout Preservation", () => {
    it("preserves integer-cent landed cost guardrails and proposal generation", async () => {
      const runId = `run_test_proposal_${Date.now()}`;
      const result = await AgentOrchestrator.execute({
        query: "Sony WH-1000XM5 headphones under $450",
        constraints: {
          maxBudget: 450,
          maxDeliveryDays: 3,
          minRating: 4.0,
          preferredBrand: "Sony",
          optimizationPreference: "PREFERRED_BRAND",
        },
        runId,
        guestSessionTokenHash: testSessionHash,
      });

      expect(result.success).toBe(true);
      expect(result.proposal).toBeDefined();
      const proposal = result.proposal!;
      expect(proposal.product.id).toBe("prod_sony_wh1000xm5");
      expect(proposal.priceBreakdown.totalCostCents).toBeGreaterThan(0);
      expect(proposal.priceBreakdown.totalCostCents).toBeLessThanOrEqual(45000);
      expect(proposal.priceBreakdown.currency).toBe("USD");

      // Verify proposal can be retrieved from proposal store
      const stored = proposalsStore.get(proposal.id);
      expect(stored).toBeDefined();
      expect(stored?.id).toBe(proposal.id);
    });

    it("preserves PayPal sandbox checkout payload consistency", async () => {
      // 1. Generate compliant proposal through orchestrator
      const runId = `run_test_checkout_${Date.now()}`;
      const runResult = await AgentOrchestrator.execute({
        query: "Anker Soundcore Life Q30 headphones under $100",
        constraints: {
          maxBudget: 100,
          maxDeliveryDays: 5,
          minRating: 4.0,
          optimizationPreference: "BEST_VALUE",
        },
        runId,
        guestSessionTokenHash: testSessionHash,
      });

      expect(runResult.success).toBe(true);
      expect(runResult.proposal).toBeDefined();
      const proposal = runResult.proposal!;

      // 2. Create PayPal sandbox order
      const order = await paypalClient.createOrder({
        proposalId: proposal.id,
        productTitle: proposal.product.title,
        currency: proposal.priceBreakdown.currency,
        totalCostCents: proposal.priceBreakdown.totalCostCents,
        itemPriceCents: proposal.priceBreakdown.itemPriceCents,
        shippingCostCents: proposal.priceBreakdown.shippingCostCents,
        estimatedTaxCents: proposal.priceBreakdown.estimatedTaxCents,
        idempotencyKey: `idem_${proposal.id}`,
      });

      expect(order.id).toBeTruthy();
      expect(order.status).toBe("CREATED");

      // 3. Verify capture behavior
      const captureResult = await paypalClient.captureOrder(order.id);
      expect(captureResult.status).toBe("COMPLETED");
      expect(captureResult.id).toBeTruthy();
    });
  });
});
