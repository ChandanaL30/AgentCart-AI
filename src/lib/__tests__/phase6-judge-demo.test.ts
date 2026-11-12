import { describe, expect, it } from "vitest";
import { AgentOrchestrator } from "../agent/orchestrator";
import { GuardrailEngine } from "../guardrails/engine";
import { DEMO_CATALOG_ITEMS } from "../catalog/seed-data";
import { hashSessionToken } from "../session";

describe("Phase 6 — Deterministic Judge Demo & Guardrail Verification", () => {
  const tokenHash = hashSessionToken("phase6_judge_demo_session_token_32chars");

  it("evaluates the candidate item ($145 base + $12 shipping) and confirms it violates the $150 hard budget", () => {
    const candidateItem = DEMO_CATALOG_ITEMS.find((p) => p.id === "prod_audiotechnica_m50xbt2");
    expect(candidateItem).toBeDefined();

    // Verify fixture parameters
    expect(candidateItem!.priceCents).toBe(14500); // $145.00
    expect(candidateItem!.shippingFeeCents).toBe(1200); // $12.00
    expect(candidateItem!.priceCents + candidateItem!.shippingFeeCents).toBe(15700); // $157.00 before tax!

    // Verify with $150 hard budget
    const evaluation = GuardrailEngine.evaluateProduct(candidateItem!, {
      maxBudget: 150,
      maxDeliveryDays: 3,
      minRating: 4.5,
      optimizationPreference: "BEST_VALUE",
    });

    // Must be rejected
    expect(evaluation.eligible).toBe(false);
    expect(evaluation.budgetPassed).toBe(false);
    expect(evaluation.reasonCodes).toContain("EXCEEDS_BUDGET");

    // Landed cost calculation in integer cents
    // $145 base + $12 shipping + $11.96 tax (8.25% of $145) = $168.96 (16896 cents)
    expect(evaluation.pricing.totalCostCents).toBe(16896);
    expect(evaluation.pricing.totalCost).toBe(168.96);
    expect(evaluation.pricing.itemPrice).toBe(145.0);
    expect(evaluation.pricing.shippingCost).toBe(12.0);

    // Violation message must explicitly explain the breach
    const budgetViolation = evaluation.violations.find((v) => v.code === "EXCEEDS_BUDGET");
    expect(budgetViolation).toBeDefined();
    expect(budgetViolation!.message).toContain("exceeds user budget limit ($150.00)");
  });

  it("runs the full Judge Demo scenario through the agent orchestrator: rejects $145 candidate and stages compliant alternative", async () => {
    const runId = `judge_demo_run_${Date.now()}`;

    const result = await AgentOrchestrator.execute({
      query: "Find wireless headphones under $150",
      constraints: {
        maxBudget: 150,
        maxDeliveryDays: 3,
        minRating: 4.5,
        optimizationPreference: "BEST_VALUE",
      },
      runId,
      guestSessionTokenHash: tokenHash,
    });

    // Orchestrator succeeded
    expect(result.success).toBe(true);
    expect(result.proposal).toBeDefined();

    // 1. The staged product is NOT the $145 candidate
    expect(result.proposal!.productId).not.toBe("prod_audiotechnica_m50xbt2");

    // 2. The staged product IS an eligible compliant alternative
    expect(result.proposal!.productId).toBe("prod_anker_q30");
    expect(result.proposal!.product.title).toContain("Anker Soundcore Life Q30");
    expect(result.proposal!.priceBreakdown.totalCostCents).toBe(8659); // $86.59 <= $150.00
    expect(result.proposal!.constraintEvaluation.passed).toBe(true);

    // 3. Disqualified candidate is present in audit records
    expect(result.disqualifiedCandidates).toBeDefined();
    const rejectedCandidate = result.disqualifiedCandidates!.find(
      (d) => d.product.id === "prod_audiotechnica_m50xbt2"
    );
    expect(rejectedCandidate).toBeDefined();
    expect(rejectedCandidate!.failedReasonCodes).toContain("EXCEEDS_BUDGET");
    expect(rejectedCandidate!.reasons[0]).toContain("exceeds user budget limit ($150.00)");

    // 4. SSE / Activity Event stream includes explicit guardrail rejection warning event
    const rejectionEvent = result.events.find(
      (e) =>
        e.stage === "EVALUATE_CONSTRAINTS" &&
        e.eventType === "WARN" &&
        e.message.includes("Disqualified candidate") &&
        e.message.includes("Audio-Technica")
    );
    expect(rejectionEvent).toBeDefined();
  });
});
