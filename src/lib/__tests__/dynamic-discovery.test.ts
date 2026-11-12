import { describe, expect, it } from "vitest";
import { AgentOrchestrator } from "../agent/orchestrator";
import { catalogService } from "../catalog/service";
import { dynamicDiscoveryEngine } from "../catalog/discovery/engine";
import { discoveryCache } from "../catalog/discovery/cache";
import { calculateAuthoritativePricing } from "../pricing/calculator";
import { DEMO_CATALOG_ITEMS } from "../catalog/seed-data";
import { ShoppingConstraints } from "../types/agent";

describe("Phase F: Dynamic Product Discovery & Isolation Tests", () => {
  const defaultConstraints: ShoppingConstraints = {
    maxBudget: 250,
    maxDeliveryDays: 5,
    minRating: 4.0,
    preferredBrand: "",
    optimizationPreference: "BEST_VALUE",
  };

  const guestSessionTokenHash = "test_discovery_session_hash";

  describe("1. External Retrieval & Unseeded Product Discovery", () => {
    it("confirms base seed catalog does NOT contain external SSDs, Epomaker, Sihoo, or Instant Pot", () => {
      // Verifies these test queries are genuinely unseeded in DEMO_CATALOG_ITEMS
      const seedTitles = DEMO_CATALOG_ITEMS.map((p) => p.title.toLowerCase());
      const seedBrands = DEMO_CATALOG_ITEMS.map((p) => p.brand.toLowerCase());

      expect(seedTitles.some((t) => t.includes("samsung t7") || t.includes("external ssd"))).toBe(false);
      expect(seedBrands.includes("epomaker")).toBe(false);
      expect(seedBrands.includes("sihoo")).toBe(false);
      expect(seedBrands.includes("instant pot")).toBe(false);
    });

    it("discovers a new external SSD model: Samsung T7 1TB external SSD", async () => {
      const runId = `test_ssd_${Date.now()}`;
      const result = await AgentOrchestrator.execute({
        query: "Samsung T7 1TB external SSD under $150",
        constraints: {
          ...defaultConstraints,
          maxBudget: 150,
        },
        runId,
        guestSessionTokenHash,
      });

      expect(result.success).toBe(true);
      expect(result.proposal).toBeDefined();

      const prod = result.proposal!.product;
      // Title and brand must match external SSD listing
      expect(prod.title).toContain("Samsung T7");
      expect(prod.title).toContain("SSD");
      expect(prod.brand).toBe("Samsung");
      expect(prod.model).toContain("T7");

      // Listing URL and Image must be grounded to the exact Samsung T7 listing
      expect(prod.productUrl).toMatch(/^https:\/\/www\.amazon\.com\/dp\/B0874XN4D8/);
      expect(prod.imageUrl).toContain("81b9eQzGg4L");
      // Must NOT be headphone image
      expect(prod.imageUrl).not.toContain("61+btxzpfDL");

      // Landed cost in integer cents must be <= $150
      expect(result.proposal!.priceBreakdown.totalCostCents).toBeLessThanOrEqual(15000);
      expect(result.proposal!.priceBreakdown.totalCostCents).toBeGreaterThan(10000);
    });

    it("discovers a new keyboard model: Epomaker RT100 mechanical keyboard", async () => {
      const runId = `test_epomaker_${Date.now()}`;
      const result = await AgentOrchestrator.execute({
        query: "Epomaker RT100 mechanical keyboard with mini TV display",
        constraints: {
          ...defaultConstraints,
          maxBudget: 150,
        },
        runId,
        guestSessionTokenHash,
      });

      expect(result.success).toBe(true);
      expect(result.proposal).toBeDefined();

      const prod = result.proposal!.product;
      expect(prod.title).toContain("Epomaker RT100");
      expect(prod.brand).toBe("Epomaker");
      expect(prod.productUrl).toMatch(/^https:\/\/www\.amazon\.com\/dp\/B0C39YZZQ7/);
      expect(prod.imageUrl).toContain("71v1ZJcKhpL");
      expect(prod.isMockData).toBe(false);
    });

    it("discovers a new office chair: Sihoo Doro C300 ergonomic chair", async () => {
      const runId = `test_sihoo_${Date.now()}`;
      const result = await AgentOrchestrator.execute({
        query: "Sihoo Doro C300 ergonomic office chair with dynamic lumbar under $350",
        constraints: {
          ...defaultConstraints,
          maxBudget: 350,
        },
        runId,
        guestSessionTokenHash,
      });

      expect(result.success).toBe(true);
      expect(result.proposal).toBeDefined();

      const prod = result.proposal!.product;
      expect(prod.title).toContain("Sihoo Doro C300");
      expect(prod.brand).toBe("Sihoo");
      expect(prod.category).toBe("home-office");
      expect(prod.productUrl).toMatch(/^https:\/\/www\.amazon\.com\/dp\/B0BS68P8H5/);
      expect(prod.imageUrl).toContain("71Yf0Y1Z2LL");
    });

    it("discovers a completely new product category: Instant Pot Pro 6Qt pressure cooker", async () => {
      const runId = `test_cooker_${Date.now()}`;
      const result = await AgentOrchestrator.execute({
        query: "Instant Pot Pro 10-in-1 multi-use pressure cooker 6 qt under $160",
        constraints: {
          ...defaultConstraints,
          maxBudget: 160,
        },
        runId,
        guestSessionTokenHash,
      });

      expect(result.success).toBe(true);
      expect(result.proposal).toBeDefined();

      const prod = result.proposal!.product;
      expect(prod.title).toContain("Instant Pot Pro");
      expect(prod.brand).toBe("Instant Pot");
      expect(prod.productUrl).toMatch(/^https:\/\/www\.amazon\.com\/dp\/B08PQ2KWHS/);
      expect(prod.imageUrl).toContain("71W2bB4mXWL");
    });
  });

  describe("2. Product Identity, Image & Link Grounding Integrity", () => {
    it("ensures product title, brand, model, image, and listing URL belong to the same record", async () => {
      const discovered = await dynamicDiscoveryEngine.discoverProducts({
        query: "Crucial X9 Pro 1TB external SSD",
      });

      expect(discovered.length).toBeGreaterThan(0);
      const crucial = discovered[0];

      expect(crucial.title).toContain("Crucial X9 Pro");
      expect(crucial.brand).toBe("Crucial");
      expect(crucial.model).toContain("Crucial X9 Pro");
      expect(crucial.productUrl).toBe("https://www.amazon.com/dp/B0C9W99QW7");
      expect(crucial.imageUrl).toBe("https://m.media-amazon.com/images/I/61NqK+bZp9L._AC_SL1500_.jpg");
      expect(crucial.sellerName).toBe("Crucial Direct");
    });

    it("never lets the LLM or engine invent image URLs or substitute generic stock images", async () => {
      const discovered = await dynamicDiscoveryEngine.discoverProducts({
        query: "Sony Alpha a6400 mirrorless camera",
      });

      expect(discovered.length).toBeGreaterThan(0);
      const cam = discovered[0];

      expect(cam.title).toContain("Sony Alpha a6400");
      expect(cam.imageUrl).toMatch(/^https:\/\/m\.media-amazon\.com\/images\/I\/.+\.jpg$/);
      // Confirms camera does not get headphone or keyboard images
      expect(cam.imageUrl).not.toContain("61+btxzpfDL");
      expect(cam.imageUrl).not.toContain("71v1ZJcKhpL");
    });
  });

  describe("3. Independent Evaluation & Zero Stale State Across Sequential Searches", () => {
    it("executes 5 sequential searches across distinct categories without state leakage", async () => {
      const searches = [
        {
          name: "Search 1: Audio",
          query: "Sony noise canceling headphones under $400",
          expectedCategory: "headphones",
          forbiddenWordsInTitle: ["keyboard", "ssd", "chair", "cooker"],
        },
        {
          name: "Search 2: Mechanical Keyboard",
          query: "Epomaker RT100 mechanical keyboard under $150",
          expectedCategory: "keyboards",
          forbiddenWordsInTitle: ["headphone", "wh-1000xm5", "ssd", "chair"],
        },
        {
          name: "Search 3: External SSD",
          query: "Samsung T7 1TB external SSD under $150",
          expectedCategory: "electronics",
          forbiddenWordsInTitle: ["headphone", "keyboard", "chair", "cooker"],
        },
        {
          name: "Search 4: Office Chair",
          query: "Sihoo Doro C300 ergonomic office chair under $350",
          expectedCategory: "home-office",
          forbiddenWordsInTitle: ["headphone", "keyboard", "ssd", "earbuds"],
        },
        {
          name: "Search 5: Kitchen Cooker",
          query: "Instant Pot Pro multi-use pressure cooker under $160",
          expectedCategory: "lifestyle",
          forbiddenWordsInTitle: ["headphone", "keyboard", "chair", "ssd"],
        },
      ];

      const capturedImages: string[] = [];
      const capturedListingUrls: string[] = [];

      for (let i = 0; i < searches.length; i++) {
        const item = searches[i];
        const runId = `seq_run_${i}_${Date.now()}`;
        const result = await AgentOrchestrator.execute({
          query: item.query,
          constraints: defaultConstraints,
          runId,
          guestSessionTokenHash,
        });

        expect(result.success).toBe(true);
        expect(result.proposal).toBeDefined();

        const prod = result.proposal!.product;
        const lowerTitle = prod.title.toLowerCase();

        // Check category isolation
        expect(prod.category).toBe(item.expectedCategory);

        // Check zero token/entity pollution from previous queries
        for (const forbidden of item.forbiddenWordsInTitle) {
          expect(lowerTitle).not.toContain(forbidden);
        }

        // Each search must yield a completely unique image and unique listing URL
        expect(capturedImages.includes(prod.imageUrl)).toBe(false);
        expect(capturedListingUrls.includes(prod.productUrl || "")).toBe(false);

        capturedImages.push(prod.imageUrl);
        if (prod.productUrl) {
          capturedListingUrls.push(prod.productUrl);
        }
      }
    });

    it("verifies isolated composite cache keys prevent cross-contamination", () => {
      const key1 = discoveryCache.generateKey({ query: "1TB external SSD", maxBudgetCents: 15000 });
      const key2 = discoveryCache.generateKey({ query: "mechanical keyboard", maxBudgetCents: 15000 });
      const key3 = discoveryCache.generateKey({ query: "1TB external SSD", maxBudgetCents: 8000 });

      expect(key1).not.toBe(key2);
      expect(key1).not.toBe(key3);
      expect(key2).not.toBe(key3);
    });
  });

  describe("4. Guardrail Evaluation & Authoritative Pricing on Discovered Items", () => {
    it("applies strict integer-cent landed cost guardrails to discovered items", async () => {
      // Herman Miller Aeron is $895.00 base + 8.25% tax = ~$968.84 total landed cost
      // User specifies budget $500 -> must be disqualified!
      const runId = `test_guardrail_budget_${Date.now()}`;
      const result = await AgentOrchestrator.execute({
        query: "Herman Miller Aeron chair under $500",
        constraints: {
          ...defaultConstraints,
          maxBudget: 500,
        },
        runId,
        guestSessionTokenHash,
      });

      // Refuses to silently substitute or violate the budget
      expect(result.success).toBe(false);
      expect(result.noEligibleProducts).toBe(true);
      expect(result.proposal).toBeUndefined();
    });

    it("authoritatively computes exact minor units for proposal stage", () => {
      // Samsung T7: 10999 cents ($109.99), tax rate 0.0825 (8.25%), free shipping
      const pricing = calculateAuthoritativePricing({
        priceCents: 10999,
        shippingFeeCents: 0,
        estimatedTaxRate: 0.0825,
      });

      // 10999 * 0.0825 = 907.4175 -> 907 cents
      expect(pricing.estimatedTaxCents).toBe(907);
      // Total = 10999 + 0 + 907 = 11906 cents ($119.06)
      expect(pricing.totalCostCents).toBe(11906);
      expect(pricing.totalCost).toBe(119.06);
    });
  });

  describe("5. Honest Handling of Unavailable or Irrelevant Search Queries", () => {
    it("honestly reports no eligible products when query matches no real items", async () => {
      const runId = `test_unmatched_${Date.now()}`;
      const result = await AgentOrchestrator.execute({
        query: "unobtainium anti-gravity flying hoverboard model 999 under $40",
        constraints: {
          ...defaultConstraints,
          maxBudget: 40,
        },
        runId,
        guestSessionTokenHash,
      });

      // Must NEVER fabricate simulated fake products or fall back to Sony headphones!
      expect(result.success).toBe(false);
      expect(result.noEligibleProducts).toBe(true);
      expect(result.proposal).toBeUndefined();
    });

    it("getProductById resolves both static seed items and dynamically registered items", async () => {
      // 1. Static seed item
      const sony = catalogService.getProductById("prod_sony_wh1000xm5");
      expect(sony).not.toBeNull();
      expect(sony?.brand).toBe("Sony");

      // 2. Dynamically discovered item
      const discovered = await catalogService.searchAsync({
        query: "Epomaker RT100",
      });
      expect(discovered.length).toBeGreaterThan(0);

      const epomakerId = discovered[0].id;
      const fetched = catalogService.getProductById(epomakerId);
      expect(fetched).not.toBeNull();
      expect(fetched?.id).toBe(epomakerId);
      expect(fetched?.brand).toBe("Epomaker");
    });
  });
});
