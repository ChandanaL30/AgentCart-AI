import { describe, expect, it } from "vitest";
import { AgentOrchestrator } from "../agent/orchestrator";
import { executeAgentTool } from "../agent/tools";

describe("Phase 3 — AI Agent Server-Side Tools", () => {
  it("executes search_catalog tool and filters by category", async () => {
    const result = await executeAgentTool("search_catalog", {
      category: "headphones",
      inStockOnly: true,
    });

    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const items = result.data as any[];
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((item) => item.category === "headphones")).toBe(true);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("executes get_product_details tool for specific product ID", async () => {
    const result = await executeAgentTool("get_product_details", {
      productId: "prod_sony_wh1000xm5",
    });

    expect(result.success).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const product = result.data as any;
    expect(product.id).toBe("prod_sony_wh1000xm5");
    expect(product.brand).toBe("Sony");
    expect(product.priceCents).toBe(34800);
  });

  it("executes calculate_landed_cost tool with exact integer minor units", async () => {
    // $100 base (10000 cents), $10 shipping (1000 cents), 8.25% tax (825 cents) -> 11825 cents
    const result = await executeAgentTool("calculate_landed_cost", {
      priceCents: 10000,
      shippingFeeCents: 1000,
      estimatedTaxRate: 0.0825,
      currency: "USD",
    });

    expect(result.success).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pricing = result.data as any;
    expect(pricing.itemPriceCents).toBe(10000);
    expect(pricing.shippingCostCents).toBe(1000);
    expect(pricing.estimatedTaxCents).toBe(825);
    expect(pricing.totalCostCents).toBe(11825);
    expect(pricing.totalCost).toBe(118.25);
  });

  it("executes check_guardrails tool and returns deterministic reason codes", async () => {
    // Check Fixture 2: over budget after shipping and tax
    const result = await executeAgentTool("check_guardrails", {
      productId: "prod_sony_wh1000xm5", // $348 base price
      constraints: {
        maxBudget: 200, // Budget is $200 (well under $348)
        maxDeliveryDays: 5,
        minRating: 4.0,
        optimizationPreference: "BEST_VALUE",
      },
      enforceBrand: false,
    });

    expect(result.success).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const guardrail = result.data as any;
    expect(guardrail.eligible).toBe(false);
    expect(guardrail.budgetPassed).toBe(false);
    expect(guardrail.reasonCodes).toContain("EXCEEDS_BUDGET");
  });

  it("executes compare_products tool and generates comparative metrics", async () => {
    const result = await executeAgentTool("compare_products", {
      productIds: ["prod_sony_wh1000xm5", "prod_anker_q30"],
    });

    expect(result.success).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const comp = result.data as any;
    expect(comp.products).toHaveLength(2);
    expect(comp.lowestLandedCostProductId).toBe("prod_anker_q30");
    expect(comp.explanation).toContain("lowest total landed cost");
  });

  it("safely handles unrecognized tool names without crashing", async () => {
    const result = await executeAgentTool("malicious_or_unknown_tool", {});
    expect(result.success).toBe(false);
    expect(result.error).toContain("Unrecognized agent tool");
  });
});

describe("Phase 3 — Autonomous Agent Orchestrator & Live Event Stream", () => {
  it("orchestrates multi-step tool-calling pipeline and emits live events", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const emittedEvents: any[] = [];

    const result = await AgentOrchestrator.execute({
      query: "Find noise-canceling headphones under $150",
      constraints: {
        maxBudget: 150,
        maxDeliveryDays: 5,
        minRating: 4.0,
        optimizationPreference: "BEST_VALUE",
      },
      runId: `test_run_${Date.now()}`,
      guestSessionTokenHash: "test_session_hash",
      onEvent: (event) => emittedEvents.push(event),
    });

    expect(result.success).toBe(true);
    expect(result.proposal).toBeDefined();
    expect(result.reasoning).toBeDefined();
    expect(result.proposal?.priceBreakdown.totalCostCents).toBeLessThanOrEqual(15000);

    // Verify tool execution history was recorded
    expect(result.toolHistory.length).toBeGreaterThanOrEqual(2);
    expect(
      result.toolHistory.some(
        (t) => t.toolName === "search_products" || t.toolName === "search_catalog"
      )
    ).toBe(true);
    expect(result.toolHistory.some((t) => t.toolName === "rank_and_evaluate_catalog")).toBe(true);
    expect(result.toolHistory.some((t) => t.toolName === "stage_purchase_proposal")).toBe(true);

    // Verify live event sequence contains tool call and tool result stages
    const stages = emittedEvents.map((e) => e.stage);
    expect(stages).toContain("INITIALIZE");
    expect(stages).toContain("PARSE_QUERY");
    expect(stages).toContain("TOOL_CALL");
    expect(stages).toContain("TOOL_RESULT");
    expect(stages).toContain("READY_FOR_REVIEW");

    // Verify all monetary calculations use integer cents
    expect(result.proposal?.priceBreakdown.itemPriceCents).toBeGreaterThan(0);
    expect(result.proposal?.priceBreakdown.totalCostCents).toBe(
      result.proposal!.priceBreakdown.itemPriceCents +
        result.proposal!.priceBreakdown.shippingCostCents +
        result.proposal!.priceBreakdown.estimatedTaxCents
    );
  });

  it("strictly enforces policy guardrails and refuses proposal when no products qualify", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const emittedEvents: any[] = [];

    // Set impossible budget ($15) for headphones
    const result = await AgentOrchestrator.execute({
      query: "wireless headphones",
      constraints: {
        maxBudget: 15.0, // Impossible budget
        maxDeliveryDays: 2,
        minRating: 4.8,
        optimizationPreference: "BEST_VALUE",
      },
      runId: `test_run_impossible_${Date.now()}`,
      guestSessionTokenHash: "test_session_hash",
      onEvent: (event) => emittedEvents.push(event),
    });

    expect(result.success).toBe(false);
    expect(result.noEligibleProducts).toBe(true);
    expect(result.proposal).toBeUndefined(); // Refuses to create proposal!
    expect(result.violationBreakdown?.EXCEEDS_BUDGET).toBeGreaterThan(0);
    expect(result.suggestedAdjustments?.length).toBeGreaterThan(0);

    // Verify error event was emitted explaining the policy failure
    const errorEvt = emittedEvents.find((e) => e.stage === "ERROR");
    expect(errorEvt).toBeDefined();
    expect(errorEvt.message).toContain("no eligible products found");
  });
});
