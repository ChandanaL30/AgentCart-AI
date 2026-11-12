import { describe, expect, it } from "vitest";
import { AgentOrchestrator, MAX_AGENT_TOOL_CALLS } from "../agent/orchestrator";
import { agentRunsStore } from "../agent/runs-store";
import { executeAgentTool } from "../agent/tools";
import { proposalsStore } from "../proposals/store";

describe("Phase 3 — Typed Agent Tools & Validation", () => {
  it("strictly validates tool arguments using Zod and rejects invalid inputs", async () => {
    // 1. Invalid budget (negative number) for search_products
    const searchRes = await executeAgentTool("search_products", {
      maxBudgetCents: -500,
    });
    expect(searchRes.success).toBe(false);
    expect(searchRes.error).toBeDefined();

    // 2. compare_products requires between 2 and 5 items
    const compRes = await executeAgentTool("compare_products", {
      productIds: ["single_id_only"],
    });
    expect(compRes.success).toBe(false);
    expect(compRes.error).toBeDefined();

    // 3. verify_budget_guardrails requires valid productId and constraints object
    const guardrailRes = await executeAgentTool("verify_budget_guardrails", {
      productId: "",
      constraints: {},
    });
    expect(guardrailRes.success).toBe(false);
    expect(guardrailRes.error).toBeDefined();

    // 4. stage_purchase_proposal requires valid parameters
    const stageRes = await executeAgentTool("stage_purchase_proposal", {
      productId: "",
      constraints: {},
      runId: "",
      guestSessionTokenHash: "",
    });
    expect(stageRes.success).toBe(false);
    expect(stageRes.error).toBeDefined();
  });

  it("validates product IDs against catalog rather than trusting arbitrary inputs", async () => {
    const res = await executeAgentTool("stage_purchase_proposal", {
      productId: "prod_hallucinated_fake_id_999",
      constraints: {
        maxBudget: 200,
        maxDeliveryDays: 5,
        minRating: 4.0,
        optimizationPreference: "BEST_VALUE",
      },
      runId: "run_test_fake",
      guestSessionTokenHash: "hash_test",
      explanation: "Fake test recommendation",
    });

    expect(res.success).toBe(false);
    expect(res.error).toContain("Product not found");
  });

  it("never allows staging an ineligible product that fails hard guardrails", async () => {
    // prod_sony_wh1000xm5 has base price $348.00 (landed ~$376.71)
    // Providing maxBudget: $150 should be rejected by stage_purchase_proposal
    const res = await executeAgentTool("stage_purchase_proposal", {
      productId: "prod_sony_wh1000xm5",
      constraints: {
        maxBudget: 150, // Impossible for $348 item
        maxDeliveryDays: 5,
        minRating: 4.0,
        optimizationPreference: "BEST_VALUE",
      },
      runId: "run_test_guardrail_reject",
      guestSessionTokenHash: "hash_test",
      explanation: "Attempting to stage overbudget item",
    });

    expect(res.success).toBe(false);
    expect(res.error).toContain("fails hard guardrails");
    expect(res.error).toContain("EXCEEDS_BUDGET");
  });
});

describe("Phase 3 — Controlled Agent Loop & Bounded Execution", () => {
  it("enforces maximum bounded tool calls (max 8)", () => {
    expect(MAX_AGENT_TOOL_CALLS).toBe(8);
  });

  it("executes the full agentic loop: query -> search -> guardrails -> compare -> stage -> review", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const events: any[] = [];
    const runId = `run_workflow_test_${Date.now()}`;
    const tokenHash = "session_token_workflow_test";

    const result = await AgentOrchestrator.execute({
      query: "ANC wireless headphones under $160 delivered in 4 days",
      constraints: {
        maxBudget: 160,
        maxDeliveryDays: 4,
        minRating: 4.0,
        optimizationPreference: "BEST_VALUE",
      },
      runId,
      guestSessionTokenHash: tokenHash,
      onEvent: (e) => events.push(e),
    });

    expect(result.success).toBe(true);
    expect(result.proposal).toBeDefined();

    // Verify stage_purchase_proposal was invoked as a server tool
    expect(
      result.toolHistory.some((t) => t.toolName === "stage_purchase_proposal")
    ).toBe(true);

    // Verify proposal snapshot properties
    const proposal = result.proposal!;
    expect(proposal.status).toBe("PENDING_REVIEW"); // Crucial: research never captures payment!
    expect(proposal.priceBreakdown.totalCostCents).toBeLessThanOrEqual(16000);
    expect(proposal.priceBreakdown.currency).toBe("USD");
    expect(proposal.version).toBe(1);
    expect(new Date(proposal.expiresAt).getTime()).toBeGreaterThan(Date.now());

    // Verify proposal was stored with session binding
    const stored = proposalsStore.get(proposal.id);
    expect(stored).toBeDefined();
    expect(stored?.guestSessionTokenHash).toBe(tokenHash);
    expect(stored?.status).toBe("PENDING_REVIEW");
  });

  it("handles no-eligible-products safely without relaxing constraints", async () => {
    const runId = `run_no_eligible_${Date.now()}`;
    const tokenHash = "session_token_no_eligible";

    const result = await AgentOrchestrator.execute({
      query: "mechanical keyboard under $20", // Impossible budget for quality keyboard
      constraints: {
        maxBudget: 20,
        maxDeliveryDays: 2,
        minRating: 4.8,
        optimizationPreference: "BEST_VALUE",
      },
      runId,
      guestSessionTokenHash: tokenHash,
    });

    expect(result.success).toBe(false);
    expect(result.noEligibleProducts).toBe(true);
    expect(result.proposal).toBeUndefined(); // Zero invalid proposals staged!
    expect(result.violationBreakdown).toBeDefined();
    expect(result.suggestedAdjustments?.length).toBeGreaterThan(0);

    // Verify run status in runs store
    const storedRun = agentRunsStore.getRun(runId);
    expect(storedRun?.status).toBe("FAILED");
    expect(storedRun?.noEligibleProducts).toBe(true);
  });
});

describe("Phase 3 — Event Ordering, Monotonic Sequence & SSE Reconnection", () => {
  it("emits events with strictly monotonic sequence numbers", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const events: any[] = [];
    const runId = `run_sequence_test_${Date.now()}`;

    await AgentOrchestrator.execute({
      query: "wireless headphones",
      constraints: {
        maxBudget: 200,
        maxDeliveryDays: 5,
        minRating: 4.0,
        optimizationPreference: "BEST_VALUE",
      },
      runId,
      guestSessionTokenHash: "test_session_hash",
      onEvent: (e) => events.push(e),
    });

    expect(events.length).toBeGreaterThanOrEqual(4);

    // Verify strictly monotonic sequence numbers: 1, 2, 3, 4, ...
    for (let i = 0; i < events.length; i++) {
      expect(events[i].sequence).toBe(i + 1);
      expect(events[i].runId).toBe(runId);
      expect(events[i].createdAt).toBeDefined();
    }
  });

  it("supports event replay for SSE reconnection using Last-Event-ID / lastSequence", () => {
    const runId = `run_replay_test_${Date.now()}`;
    const tokenHash = "test_replay_session";

    agentRunsStore.createRun({
      id: runId,
      guestSessionTokenHash: tokenHash,
      query: "test query",
      constraints: {
        maxBudget: 200,
        maxDeliveryDays: 5,
        minRating: 4.0,
        optimizationPreference: "BEST_VALUE",
      },
    });

    // Add 5 synthetic events
    for (let i = 1; i <= 5; i++) {
      agentRunsStore.addEvent(runId, {
        id: `evt_${runId}_${i}`,
        runId,
        sequence: i,
        stage: "TOOL_CALL",
        eventType: "TOOL",
        message: `Event message ${i}`,
        createdAt: new Date().toISOString(),
      });
    }

    // Client reconnects having seen sequence 3 -> should receive sequences 4 and 5
    const replayed = agentRunsStore.getEventsAfterSequence(runId, 3);
    expect(replayed).toHaveLength(2);
    expect(replayed[0].sequence).toBe(4);
    expect(replayed[1].sequence).toBe(5);
  });

  it("enforces session ownership and isolates runs between different sessions", () => {
    const runIdA = `run_owner_A_${Date.now()}`;
    const runIdB = `run_owner_B_${Date.now()}`;

    agentRunsStore.createRun({
      id: runIdA,
      guestSessionTokenHash: "session_user_A",
      query: "laptop stand",
      constraints: {
        maxBudget: 100,
        maxDeliveryDays: 5,
        minRating: 4.0,
        optimizationPreference: "BEST_VALUE",
      },
    });

    agentRunsStore.createRun({
      id: runIdB,
      guestSessionTokenHash: "session_user_B",
      query: "mechanical keyboard",
      constraints: {
        maxBudget: 200,
        maxDeliveryDays: 5,
        minRating: 4.0,
        optimizationPreference: "BEST_VALUE",
      },
    });

    // User A should only see runIdA
    const runsForA = agentRunsStore.getRunsForSession("session_user_A");
    expect(runsForA.some((r) => r.id === runIdA)).toBe(true);
    expect(runsForA.some((r) => r.id === runIdB)).toBe(false);

    // User B should only see runIdB
    const runsForB = agentRunsStore.getRunsForSession("session_user_B");
    expect(runsForB.some((r) => r.id === runIdB)).toBe(true);
    expect(runsForB.some((r) => r.id === runIdA)).toBe(false);
  });
});

describe("Phase 3 — Fintech Rule: Research Never Creates or Captures a Payment", () => {
  it("guarantees research proposals remain PENDING_REVIEW and no PayPal orders or charges are created", async () => {
    const runId = `run_fintech_safety_${Date.now()}`;
    const tokenHash = "session_token_fintech";

    const result = await AgentOrchestrator.execute({
      query: "wireless headphones under $150",
      constraints: {
        maxBudget: 150,
        maxDeliveryDays: 5,
        minRating: 4.0,
        optimizationPreference: "BEST_VALUE",
      },
      runId,
      guestSessionTokenHash: tokenHash,
    });

    expect(result.success).toBe(true);
    expect(result.proposal).toBeDefined();

    const proposal = result.proposal!;
    // Status must be PENDING_REVIEW — requires explicit user action to lock/checkout
    expect(proposal.status).toBe("PENDING_REVIEW");

    // Must not contain any payment or order authorization
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((proposal as any).paypalOrderId).toBeUndefined();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((proposal as any).capturedPayment).toBeUndefined();

    // Stored proposal in persistence store must also remain PENDING_REVIEW
    const stored = proposalsStore.get(proposal.id);
    expect(stored?.status).toBe("PENDING_REVIEW");
  });
});
