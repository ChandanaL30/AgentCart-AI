import { describe, expect, it } from "vitest";
import { AgentOrchestrator } from "../agent/orchestrator";
import { executeAgentTool } from "../agent/tools";
import { DEMO_CATALOG_ITEMS } from "../catalog/seed-data";
import {
  getResolvedExternalUrl,
  getStoreInfo,
  validateProductUrl,
} from "../catalog/url-validator";
import { calculateAuthoritativePricing } from "../pricing/calculator";
import { proposalsStore } from "../proposals/store";

describe("Product Identity, Image, Listing Link & Pre-Purchase Review End-to-End", () => {
  const guestSessionTokenHash = "test_session_hash_123";

  describe("1. URL Validator & Safe Listing Links", () => {
    it("accepts valid HTTPS and HTTP merchant listing URLs", () => {
      const sonyUrl = "https://electronics.sony.com/audio/headphones/headband-headphones/p/wh1000xm5-b";
      const validated = validateProductUrl(sonyUrl);
      expect(validated.isValid).toBe(true);
      expect(validated.safeUrl).toBe(sonyUrl);
      expect(validated.isDemoOnly).toBe(false);
    });

    it("rejects dangerous javascript: protocols", () => {
      const dangerous = "javascript:alert('xss')";
      const validated = validateProductUrl(dangerous);
      expect(validated.isValid).toBe(false);
      expect(validated.safeUrl).toBeNull();
      expect(validated.isDemoOnly).toBe(false);
      expect(validated.reason).toContain("Unsafe or prohibited URL protocol");
    });

    it("rejects dangerous data: and vbscript: protocols", () => {
      const dataUrl = "data:text/html,<script>alert(1)</script>";
      const validatedData = validateProductUrl(dataUrl);
      expect(validatedData.isValid).toBe(false);
      expect(validatedData.safeUrl).toBeNull();

      const vbUrl = "vbscript:msgbox('malicious')";
      const validatedVb = validateProductUrl(vbUrl);
      expect(validatedVb.isValid).toBe(false);
      expect(validatedVb.safeUrl).toBeNull();
    });

    it("flags missing or empty URLs as demo-only without error", () => {
      const emptyCheck = validateProductUrl(undefined);
      expect(emptyCheck.isValid).toBe(false);
      expect(emptyCheck.safeUrl).toBeNull();
      expect(emptyCheck.isDemoOnly).toBe(true);

      const blankCheck = validateProductUrl("   ");
      expect(blankCheck.isValid).toBe(false);
      expect(blankCheck.safeUrl).toBeNull();
      expect(blankCheck.isDemoOnly).toBe(true);
    });
  });

  describe("2. Catalog Seed Data & Distinct Product Identity", () => {
    it("ensures no non-headphone product shares a headphone image", () => {
      const headphoneItems = DEMO_CATALOG_ITEMS.filter((p) => p.category === "headphones");
      const headphoneImageUrls = new Set(headphoneItems.map((p) => p.imageUrl));

      const nonHeadphoneItems = DEMO_CATALOG_ITEMS.filter((p) => p.category !== "headphones");
      for (const item of nonHeadphoneItems) {
        expect(
          headphoneImageUrls.has(item.imageUrl),
          `Non-headphone item ${item.title} (${item.category}) must not reuse a headphone image`
        ).toBe(false);
      }
    });

    it("ensures keyboards have unique keyboard images and exact model numbers", () => {
      const keyboards = DEMO_CATALOG_ITEMS.filter((p) => p.category === "keyboards");
      expect(keyboards.length).toBeGreaterThanOrEqual(3);

      for (const kb of keyboards) {
        expect(kb.model).toBeDefined();
        expect(kb.model?.length).toBeGreaterThan(0);
        expect(kb.specs).toBeDefined();
        // Keyboard image must not contain the old headphone image id
        expect(kb.imageUrl).not.toContain("photo-1505740420928-5e560c06d30e");
      }
    });

    it("ensures non-audio categories (skincare & lifestyle) have correct categories and unique imagery", () => {
      const cerave = DEMO_CATALOG_ITEMS.find((p) => p.id === "prod_cerave_hydrating_cleanser");
      expect(cerave).toBeDefined();
      expect(cerave?.category).toBe("skincare");
      expect(cerave?.brand).toBe("CeraVe");
      expect(cerave?.model).toBe("301871370087 (8 fl oz)");
      expect(cerave?.imageUrl).toBeDefined();
      expect(cerave?.imageUrl).not.toContain("photo-1505740420928-5e560c06d30e");

      const bottle = DEMO_CATALOG_ITEMS.find((p) => p.id === "prod_thermoflask_1l");
      expect(bottle).toBeDefined();
      expect(bottle?.category).toBe("lifestyle");
      expect(bottle?.brand).toBe("ThermoFlask");
      expect(bottle?.model).toBe("TF-32OZ-CHUG-BLK");
      expect(bottle?.imageUrl).toBeDefined();
      expect(bottle?.imageUrl).not.toContain("photo-1505740420928-5e560c06d30e");
    });

    it("marks mock/demo catalog entries without real listings as demo-only", () => {
      const oosHeadphone = DEMO_CATALOG_ITEMS.find((p) => p.id === "prod_sony_wh1000xm4_oos");
      expect(oosHeadphone).toBeDefined();
      expect(oosHeadphone?.productUrl).toBeUndefined();

      const validation = validateProductUrl(oosHeadphone?.productUrl);
      expect(validation.isValid).toBe(false);
      expect(validation.isDemoOnly).toBe(true);
    });
  });

  describe("3. End-to-End Proposal Staging & Product Identity Flow", () => {
    it("preserves full product identity, model, specs, and landed cost when staging a proposal", async () => {
      const targetProduct = DEMO_CATALOG_ITEMS.find((p) => p.id === "prod_keychron_q1_pro")!;
      expect(targetProduct).toBeDefined();

      const stageResult = await executeAgentTool("stage_purchase_proposal", {
        productId: targetProduct.id,
        reason: "Best overall custom wireless mechanical keyboard with aluminum body.",
        runId: `run_test_${Date.now()}`,
        guestSessionTokenHash,
        constraints: {
          maxBudget: 250,
          maxDeliveryDays: 5,
          minRating: 4.0,
          optimizationPreference: "BEST_VALUE",
        },
      });

      expect(stageResult.success).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const proposal = stageResult.data as any;

      // Product identity must remain intact
      expect(proposal.productId).toBe(targetProduct.id);
      expect(proposal.product.title).toBe(targetProduct.title);
      expect(proposal.product.brand).toBe("Keychron");
      expect(proposal.product.model).toBe(targetProduct.model);
      expect(proposal.product.category).toBe("keyboards");
      expect(proposal.product.imageUrl).toBe(targetProduct.imageUrl);
      expect(proposal.product.seller).toBe(targetProduct.sellerName);
      expect(proposal.product.productUrl).toBe(targetProduct.productUrl);
      expect(proposal.product.specs).toBeDefined();
      expect(proposal.product.warranty).toContain("1-Year");

      // Verify stored proposal in database/store matches exactly
      const stored = proposalsStore.getById(proposal.id);
      expect(stored).toBeDefined();
      expect(stored?.productId).toBe(targetProduct.id);
      expect(stored?.product.title).toBe(targetProduct.title);
      expect(stored?.product.model).toBe(targetProduct.model);
      expect(stored?.priceBreakdown.totalCostCents).toBe(proposal.priceBreakdown.totalCostCents);
    });
  });

  describe("4. Category Switching & Zero Stale State Across 3 Distinct Categories", () => {
    it("Category 1 (Audio): Recommends headphone with headphone image and identity", async () => {
      const result = await AgentOrchestrator.execute({
        query: "noise cancelling headphones under $100 with fast delivery",
        constraints: {
          maxBudget: 100,
          maxDeliveryDays: 3,
          minRating: 4.0,
          optimizationPreference: "BEST_VALUE",
        },
        runId: `run_cat1_${Date.now()}`,
        guestSessionTokenHash,
      });

      expect(result.success).toBe(true);
      expect(result.proposal).toBeDefined();
      expect(result.proposal?.product.category).toBe("headphones");
      expect(result.proposal?.product.imageUrl).toBeDefined();
      expect(result.proposal?.product.model).toBeDefined();
      // Must NOT use keyboard or monitor images
      expect(result.proposal?.product.imageUrl).not.toContain("photo-1587829741301-dc798b83add3");
      expect(result.proposal?.product.imageUrl).not.toContain("photo-1527864550417-7fd91fc51a46");
    });

    it("Category 2 (Keyboards): Recommends keyboard with keyboard image, never headphone image", async () => {
      const result = await AgentOrchestrator.execute({
        query: "wireless mechanical keyboard under $150",
        constraints: {
          maxBudget: 150,
          maxDeliveryDays: 5,
          minRating: 4.0,
          optimizationPreference: "BEST_VALUE",
        },
        runId: `run_cat2_${Date.now()}`,
        guestSessionTokenHash,
      });

      expect(result.success).toBe(true);
      expect(result.proposal).toBeDefined();
      expect(result.proposal?.product.category).toBe("keyboards");
      expect(result.proposal?.product.imageUrl).toBeDefined();
      expect(result.proposal?.product.model).toBeDefined();
      // Must NOT use headphone image
      expect(result.proposal?.product.imageUrl).not.toContain("photo-1505740420928-5e560c06d30e");
      expect(result.proposal?.product.imageUrl).not.toContain("photo-1546435770-a3e426bf472b");
    });

    it("Category 3 (Skincare / Non-Audio): Recommends hydrating cleanser with skincare identity", async () => {
      const result = await AgentOrchestrator.execute({
        query: "hydrating facial cleanser under $25",
        constraints: {
          maxBudget: 25,
          maxDeliveryDays: 4,
          minRating: 4.0,
          optimizationPreference: "BEST_VALUE",
        },
        runId: `run_cat3_${Date.now()}`,
        guestSessionTokenHash,
      });

      expect(result.success).toBe(true);
      expect(result.proposal).toBeDefined();
      expect(result.proposal?.product.category).toBe("skincare");
      expect(result.proposal?.product.model).toBeDefined();
      expect(result.proposal?.product.imageUrl).toBeDefined();
      // Never inherits headphone or keyboard image
      expect(result.proposal?.product.imageUrl).not.toContain("photo-1505740420928-5e560c06d30e");
      expect(result.proposal?.product.imageUrl).not.toContain("photo-1587829741301-dc798b83add3");
    });
  });

  describe("5. Landed Cost & Guardrail Integrity Verification", () => {
    it("authoritative landed total strictly equals item price + shipping fee + estimated tax in integer cents", async () => {
      const item = DEMO_CATALOG_ITEMS.find((p) => p.id === "prod_sony_wh1000xm5")!;
      const landed = calculateAuthoritativePricing({
        priceCents: item.priceCents,
        shippingFeeCents: item.shippingFeeCents,
        estimatedTaxRate: 0.0825,
      });

      const expectedTaxCents = Math.round(item.priceCents * 0.0825);
      const expectedTotalCents = item.priceCents + item.shippingFeeCents + expectedTaxCents;

      expect(landed.totalCostCents).toBe(expectedTotalCents);
      expect(landed.totalCost).toBe(expectedTotalCents / 100);
      expect(landed.itemPrice).toBe(item.priceCents / 100);
      expect(landed.shippingCost).toBe(item.shippingFeeCents / 100);
    });

    it("rejects proposal verification when hard constraints are violated", async () => {
      // Stage Sony WH-1000XM5 ($348 base, ~$376.71 landed)
      const stageResult = await executeAgentTool("stage_purchase_proposal", {
        productId: "prod_sony_wh1000xm5",
        reason: "Premium noise cancelling headphones",
        runId: `run_sony_${Date.now()}`,
        guestSessionTokenHash,
        constraints: {
          maxBudget: 400,
          maxDeliveryDays: 5,
          minRating: 4.0,
          optimizationPreference: "BEST_VALUE",
        },
      });

      expect(stageResult.success).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const proposal = stageResult.data as any;

      // Verify with an impossible maxBudget ($100)
      const verifyCheck = await executeAgentTool("check_guardrails", {
        productId: proposal.productId,
        constraints: {
          maxBudget: 100, // Budget limit is $100, landed total is > $370
          maxDeliveryDays: 5,
          minRating: 4.0,
          optimizationPreference: "BEST_VALUE",
        },
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const guardrailOutcome = verifyCheck.data as any;
      expect(guardrailOutcome.eligible).toBe(false);
      expect(guardrailOutcome.budgetPassed).toBe(false);
      expect(guardrailOutcome.reasonCodes).toContain("EXCEEDS_BUDGET");
    });
  });

  describe("6. Marketplace Derivation & Safe Clickable URLs (Amazon / Flipkart)", () => {
    it("derives Amazon.com or Flipkart.com correctly from catalog metadata", () => {
      const sony = DEMO_CATALOG_ITEMS.find((p) => p.id === "prod_sony_wh1000xm5")!;
      const sonyStore = getStoreInfo(sony);
      expect(sonyStore.brandName).toBe("Amazon");
      expect(sonyStore.storeName).toContain("Amazon.com");

      const jbl = DEMO_CATALOG_ITEMS.find((p) => p.id === "prod_jbl_tune510bt")!;
      const jblStore = getStoreInfo(jbl);
      expect(jblStore.brandName).toBe("Flipkart");
      expect(jblStore.storeName).toContain("Flipkart.com");
    });

    it("generates safe, validated external clickable destination URLs", () => {
      const sony = DEMO_CATALOG_ITEMS.find((p) => p.id === "prod_sony_wh1000xm5")!;
      const sonyUrl = getResolvedExternalUrl(sony);
      expect(sonyUrl).toBe("https://www.amazon.com/dp/B09XS7JWHH");
      expect(validateProductUrl(sonyUrl).isValid).toBe(true);

      const jbl = DEMO_CATALOG_ITEMS.find((p) => p.id === "prod_jbl_tune510bt")!;
      const jblUrl = getResolvedExternalUrl(jbl);
      expect(jblUrl).toContain("https://www.flipkart.com");
      expect(validateProductUrl(jblUrl).isValid).toBe(true);
    });

    it("synthesizes water bottle query with hydration image and Flipkart/Amazon clickable listings", async () => {
      const result = await AgentOrchestrator.execute({
        query: "milton insulated water bottle under 25",
        constraints: {
          maxBudget: 25,
          maxDeliveryDays: 4,
          minRating: 4.0,
          optimizationPreference: "BEST_VALUE",
        },
        runId: `run_bottle_${Date.now()}`,
        guestSessionTokenHash,
      });

      expect(result.success).toBe(true);
      expect(result.proposal).toBeDefined();

      const prod = result.proposal!.product;
      // Image must be an authentic product image, NEVER generic yellow earphones
      expect(prod.imageUrl).not.toContain("photo-1505740420928-5e560c06d30e");
      expect(prod.imageUrl).toMatch(/(unsplash\.com|media-amazon\.com|flixcart\.com|nykaa\.com|ppl-media\.com|myntassets\.com)/);

      // Marketplace must be derived as Amazon, Flipkart, Nykaa, or Purplle
      const store = getStoreInfo(prod);
      expect(["Amazon", "Flipkart", "Nykaa", "Purplle"]).toContain(store.brandName);

      // Must have clickable external URL
      const resolvedUrl = getResolvedExternalUrl(prod);
      expect(resolvedUrl).toMatch(/^https:\/\/(www\.)?(amazon|flipkart|nykaa|purplle|myntra)\.(com|in)/);
      expect(validateProductUrl(resolvedUrl).isValid).toBe(true);
    });

    it("synthesizes face wash query with skincare image and Flipkart/Amazon clickable listings", async () => {
      const result = await AgentOrchestrator.execute({
        query: "himalaya neem face wash cleanser under 15",
        constraints: {
          maxBudget: 15,
          maxDeliveryDays: 3,
          minRating: 4.0,
          optimizationPreference: "BEST_VALUE",
        },
        runId: `run_facewash_${Date.now()}`,
        guestSessionTokenHash,
      });

      expect(result.success).toBe(true);
      expect(result.proposal).toBeDefined();

      const prod = result.proposal!.product;
      // Image must be a skincare image, NEVER earphones
      expect(prod.imageUrl).not.toContain("photo-1505740420928-5e560c06d30e");

      // Marketplace must be derived
      const store = getStoreInfo(prod);
      expect(["Amazon", "Flipkart"]).toContain(store.brandName);

      // Must have clickable external URL
      const resolvedUrl = getResolvedExternalUrl(prod);
      expect(resolvedUrl).toMatch(/^https:\/\/(www\.)?(amazon|flipkart)\.com/);
      expect(validateProductUrl(resolvedUrl).isValid).toBe(true);
    });
  });
});

