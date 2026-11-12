import { executeAgentTool } from "./tools";
import { agentRunsStore } from "./runs-store";
import { CatalogProduct, ProductComparisonResult } from "@/lib/catalog/types";
import { GuardrailEvaluationOutcome, RankedProduct, DisqualifiedProduct } from "@/lib/guardrails/types";
import { getLlmAdapter } from "@/lib/llm/factory";
import {
  AgentActivityEvent,
  PurchaseProposalDto,
  ShoppingConstraints,
} from "@/lib/types/agent";

export interface ToolExecutionRecord {
  toolName: string;
  input: Record<string, unknown>;
  outputSummary: string;
  durationMs: number;
}

export interface AgentRunParams {
  query: string;
  constraints: ShoppingConstraints;
  runId: string;
  guestSessionTokenHash: string;
  onEvent?: (event: AgentActivityEvent) => void;
  timeoutMs?: number;
}

export interface AgentRunResult {
  success: boolean;
  runId: string;
  llmProvider: string;
  isMockMode: boolean;
  proposal?: PurchaseProposalDto;
  reasoning?: {
    headline: string;
    explanation: string;
    pros: string[];
    tradeoffs: string[];
    constraintComplianceSummary: string;
  };
  comparison?: ProductComparisonResult;
  alternatives?: Array<{
    product: CatalogProduct;
    breakdown: unknown;
    constraintEvaluation: { passed: boolean };
    notes: string[];
  }>;
  disqualifiedCandidates?: DisqualifiedProduct[];
  noEligibleProducts?: boolean;
  noExactMatch?: boolean;
  suggestedCategory?: string;
  error?: string;
  violationBreakdown?: Record<string, number>;
  suggestedAdjustments?: string[];
  explanation?: string;
  closestAlternative?: {
    product: CatalogProduct;
    pricing: unknown;
    reasons: string[];
  } | null;
  events: AgentActivityEvent[];
  toolHistory: ToolExecutionRecord[];
}

export const MAX_AGENT_TOOL_CALLS = 8;
export const DEFAULT_AGENT_TIMEOUT_MS = 25000;

/**
 * Autonomous AI Agent Orchestrator.
 * Coordinates multi-step tool-calling with authoritative server-side execution,
 * bounded tool call limits, and real-time event streaming.
 */
export class AgentOrchestrator {
  public static async execute(params: AgentRunParams): Promise<AgentRunResult> {
    const {
      query,
      constraints,
      runId,
      guestSessionTokenHash,
      onEvent,
      timeoutMs = DEFAULT_AGENT_TIMEOUT_MS,
    } = params;

    // Ensure run is initialized in persistence store
    agentRunsStore.getOrCreateRun({
      id: runId,
      guestSessionTokenHash,
      query,
      constraints,
    });

    const events: AgentActivityEvent[] = [];
    const toolHistory: ToolExecutionRecord[] = [];
    let sequence = 1;
    let toolCallCount = 0;

    function emitEvent(
      stage: AgentActivityEvent["stage"],
      eventType: AgentActivityEvent["eventType"],
      message: string,
      payload?: Record<string, unknown>
    ): AgentActivityEvent {
      const event: AgentActivityEvent = {
        id: `evt_${Date.now()}_${sequence}`,
        runId,
        sequence: sequence++,
        stage,
        eventType,
        message,
        payload,
        createdAt: new Date().toISOString(),
      };
      events.push(event);
      agentRunsStore.addEvent(runId, event);
      if (onEvent) {
        onEvent(event);
      }
      return event;
    }

    async function invokeTrackedTool(
      toolName: string,
      input: Record<string, unknown>
    ): Promise<{ success: boolean; data?: unknown; error?: string; durationMs: number }> {
      if (toolCallCount >= MAX_AGENT_TOOL_CALLS) {
        emitEvent(
          "ERROR",
          "ERROR",
          `Execution limit reached: Maximum of ${MAX_AGENT_TOOL_CALLS} tool calls exceeded. Halting tool loop.`,
          { toolCallCount, maxCalls: MAX_AGENT_TOOL_CALLS }
        );
        return {
          success: false,
          error: `Tool execution limit reached (${MAX_AGENT_TOOL_CALLS} calls).`,
          durationMs: 0,
        };
      }

      toolCallCount++;
      return executeAgentTool(toolName, input);
    }

    const runExecutionPromise = (async (): Promise<AgentRunResult> => {
      // Step 1: Initialize
      emitEvent(
        "INITIALIZE",
        "INFO",
        "Agent initialized. Establishing verified tool-calling pipeline with max 8 bounded executions."
      );

      // Step 2: Query Analysis & Constraint Extraction
      emitEvent("PARSE_QUERY", "INFO", `Analyzing query intent: "${query}"`);
      const llm = getLlmAdapter();
      const extractionResult = await llm.extractConstraints(query, constraints);

      const effectiveConstraints: ShoppingConstraints = {
        ...constraints,
        ...extractionResult.extractedConstraints,
      };

      const searchCategory =
        extractionResult.detectedCategory && extractionResult.detectedCategory !== "all"
          ? extractionResult.detectedCategory
          : undefined;

      emitEvent(
        "PARSE_QUERY",
        "DATA",
        `Intent confirmed: Category "${searchCategory || "all"}" • Budget cap $${effectiveConstraints.maxBudget.toFixed(
          2
        )} • Delivery ≤ ${effectiveConstraints.maxDeliveryDays}d.`,
        { effectiveConstraints, explanation: extractionResult.explanation }
      );

      // Step 3: Tool Call 1 — search_products
      const searchToolInput = {
        query,
        category: searchCategory,
        brand:
          effectiveConstraints.optimizationPreference === "PREFERRED_BRAND" &&
          effectiveConstraints.preferredBrand
            ? effectiveConstraints.preferredBrand
            : undefined,
        inStockOnly: false, // Guardrails will authoritatively check stock!
      };

      emitEvent(
        "TOOL_CALL",
        "TOOL",
        `[Tool Call 1/${MAX_AGENT_TOOL_CALLS}] invoking "search_products" with query: "${query}"`,
        { toolName: "search_products", input: searchToolInput }
      );

      const searchToolExec = await invokeTrackedTool("search_products", searchToolInput);
      if (!searchToolExec.success) {
        agentRunsStore.failRun(runId, searchToolExec.error || "Catalog search failed");
        return {
          success: false,
          runId,
          llmProvider: llm.providerName,
          isMockMode: llm.providerName === "mock",
          error: searchToolExec.error,
          events,
          toolHistory,
        };
      }

      const candidateProducts = (searchToolExec.data as CatalogProduct[]) || [];

      toolHistory.push({
        toolName: "search_products",
        input: searchToolInput,
        outputSummary: `Retrieved ${candidateProducts.length} candidate catalog item(s)`,
        durationMs: searchToolExec.durationMs,
      });

      emitEvent(
        "TOOL_RESULT",
        "DATA",
        `[Tool Result] "search_products" discovered ${candidateProducts.length} candidate product(s) in catalog.`,
        { candidateCount: candidateProducts.length, durationMs: searchToolExec.durationMs }
      );

      // Handle no matching products honestly without fabricating or silently substituting
      if (candidateProducts.length === 0) {
        const noMatchMsg = `No exact match found for "${query}". No unrelated products were substituted.`;
        emitEvent(
          "EVALUATE_CONSTRAINTS",
          "WARN",
          noMatchMsg,
          {
            noExactMatch: true,
            query,
            suggestedCategory: searchCategory || "all",
          }
        );

        emitEvent(
          "ERROR",
          "ERROR",
          `No exact match found. You can try searching more broadly${searchCategory ? ` in category "${searchCategory}"` : ""}.`,
          {
            noEligibleProducts: true,
            noExactMatch: true,
            suggestedCategory: searchCategory,
            explanation: noMatchMsg,
          }
        );

        agentRunsStore.completeRun(runId, {
          noEligibleProducts: true,
          noExactMatch: true,
          suggestedCategory: searchCategory,
          explanation: noMatchMsg,
          violationBreakdown: {
            budgetExceeded: 0,
            deliveryTooSlow: 0,
            ratingTooLow: 0,
            outOfStock: 0,
            brandMismatch: 0,
          },
          suggestedAdjustments: searchCategory
            ? [`Browse all ${searchCategory} products without specific keywords`]
            : ["Try a broader search term or explore categories"],
          closestAlternative: null,
        });

        return {
          success: false,
          runId,
          llmProvider: llm.providerName,
          isMockMode: llm.providerName === "mock",
          noEligibleProducts: true,
          noExactMatch: true,
          suggestedCategory: searchCategory,
          error: noMatchMsg,
          violationBreakdown: {
            budgetExceeded: 0,
            deliveryTooSlow: 0,
            ratingTooLow: 0,
            outOfStock: 0,
            brandMismatch: 0,
          },
          suggestedAdjustments: searchCategory
            ? [`Browse all ${searchCategory} products without specific keywords`]
            : ["Try a broader search term or explore categories"],
          explanation: noMatchMsg,
          closestAlternative: null,
          events,
          toolHistory,
        };
      }

      // Step 4: Tool Call 2 — rank_and_evaluate_catalog (Authoritative Hard Guardrails)
      const guardrailToolInput = {
        productIds: candidateProducts.map((p) => p.id),
        constraints: effectiveConstraints,
      };

      emitEvent(
        "TOOL_CALL",
        "TOOL",
        `[Tool Call 2/${MAX_AGENT_TOOL_CALLS}] invoking "rank_and_evaluate_catalog" to verify hard constraints and landed costs in integer cents`,
        { toolName: "rank_and_evaluate_catalog", input: guardrailToolInput }
      );

      const guardrailToolExec = await invokeTrackedTool(
        "rank_and_evaluate_catalog",
        guardrailToolInput
      );
      if (!guardrailToolExec.success) {
        agentRunsStore.failRun(runId, guardrailToolExec.error || "Guardrail evaluation failed");
        return {
          success: false,
          runId,
          llmProvider: llm.providerName,
          isMockMode: llm.providerName === "mock",
          error: guardrailToolExec.error,
          events,
          toolHistory,
        };
      }

      const guardrailOutcome = guardrailToolExec.data as GuardrailEvaluationOutcome;

      toolHistory.push({
        toolName: "rank_and_evaluate_catalog",
        input: guardrailToolInput,
        outputSummary: `Eligible: ${guardrailOutcome.eligibleCount}, Disqualified: ${guardrailOutcome.disqualifiedCount}`,
        durationMs: guardrailToolExec.durationMs,
      });

      emitEvent(
        "TOOL_RESULT",
        "DATA",
        `[Tool Result] "rank_and_evaluate_catalog" completed: ${guardrailOutcome.eligibleCount} eligible, ${guardrailOutcome.disqualifiedCount} disqualified.`,
        {
          eligibleCount: guardrailOutcome.eligibleCount,
          disqualifiedCount: guardrailOutcome.disqualifiedCount,
          violationBreakdown: guardrailOutcome.violationBreakdown,
          durationMs: guardrailToolExec.durationMs,
        }
      );

      // Step 5: Safety Guardrail Enforcement — Refuse proposal if 0 eligible
      if (!guardrailOutcome.hasEligibleProducts || !guardrailOutcome.selectedRecommendation) {
        const closest = guardrailOutcome.disqualifiedCandidates[0] || null;

        emitEvent(
          "EVALUATE_CONSTRAINTS",
          "WARN",
          "No catalog items satisfy all hard constraints. Refusing to silently relax constraints.",
          {
            violationBreakdown: guardrailOutcome.violationBreakdown,
            suggestedAdjustments: guardrailOutcome.suggestedAdjustments,
            closestAlternative: closest
              ? {
                  title: closest.product.title,
                  totalCost: closest.pricing.totalCost,
                  deliveryDays: closest.product.deliveryDays,
                  rating: closest.product.rating,
                }
              : null,
          }
        );

        emitEvent(
          "ERROR",
          "ERROR",
          "Policy guardrail violation: no eligible products found. Actionable adjustments available.",
          {
            noEligibleProducts: true,
            violationBreakdown: guardrailOutcome.violationBreakdown,
            suggestedAdjustments: guardrailOutcome.suggestedAdjustments,
            explanation: guardrailOutcome.explanation,
          }
        );

        agentRunsStore.completeRun(runId, {
          noEligibleProducts: true,
          violationBreakdown: guardrailOutcome.violationBreakdown,
          suggestedAdjustments: guardrailOutcome.suggestedAdjustments,
          explanation: guardrailOutcome.explanation,
          closestAlternative: closest,
        });

        return {
          success: false,
          runId,
          llmProvider: llm.providerName,
          isMockMode: llm.providerName === "mock",
          noEligibleProducts: true,
          error: "No products satisfy all hard constraints without relaxing parameters.",
          violationBreakdown: guardrailOutcome.violationBreakdown,
          suggestedAdjustments: guardrailOutcome.suggestedAdjustments,
          explanation: guardrailOutcome.explanation,
          closestAlternative: closest
            ? {
                product: closest.product,
                pricing: closest.pricing,
                reasons: closest.reasons,
              }
            : null,
          events,
          toolHistory,
        };
      }

      const topRanked: RankedProduct = guardrailOutcome.selectedRecommendation;
      const topProd = topRanked.product;

      emitEvent(
        "EVALUATE_CONSTRAINTS",
        "DATA",
        `Top compliant candidate verified: "${topProd.title}" — Landed total: $${(
          topRanked.pricing.totalCostCents / 100
        ).toFixed(2)} (${topRanked.reasons.join(", ")})`,
        {
          totalCostCents: topRanked.pricing.totalCostCents,
          reasons: topRanked.reasons,
        }
      );

      // Emit specific warning events for disqualified candidates (closest to budget first) so users & judges can inspect why items failed
      let sortedDisqualified: DisqualifiedProduct[] = [];
      if (guardrailOutcome.disqualifiedCandidates.length > 0) {
        sortedDisqualified = [...guardrailOutcome.disqualifiedCandidates].sort((a, b) => {
          const diffA = Math.abs(a.guardrailResult.constraintDiffs.budgetCentsDiff || 0);
          const diffB = Math.abs(b.guardrailResult.constraintDiffs.budgetCentsDiff || 0);
          return diffA - diffB;
        });

        for (const disq of sortedDisqualified.slice(0, 4)) {
          emitEvent(
            "EVALUATE_CONSTRAINTS",
            "WARN",
            `[Guardrail Enforced] Disqualified candidate "${disq.product.title}" — Sticker: $${(
              disq.product.priceCents / 100
            ).toFixed(2)}, Shipping: $${(disq.product.shippingFeeCents / 100).toFixed(
              2
            )}, Landed Total: $${(disq.pricing.totalCostCents / 100).toFixed(2)}. ${disq.reasons.join(". ")}`,
            {
              productTitle: disq.product.title,
              priceCents: disq.product.priceCents,
              shippingFeeCents: disq.product.shippingFeeCents,
              totalCostCents: disq.pricing.totalCostCents,
              reasons: disq.reasons,
              failedReasonCodes: disq.failedReasonCodes,
            }
          );
        }
      }

      // Step 6: Tool Call 3 — compare_products (If multiple eligible candidates exist)
      let comparisonResult: ProductComparisonResult | undefined;
      if (guardrailOutcome.rankedEligible.length >= 2) {
        const compareIds = guardrailOutcome.rankedEligible.slice(0, 3).map((r) => r.product.id);
        emitEvent(
          "TOOL_CALL",
          "TOOL",
          `[Tool Call 3/${MAX_AGENT_TOOL_CALLS}] invoking "compare_products" for top ${compareIds.length} eligible candidates`,
          { toolName: "compare_products", input: { productIds: compareIds } }
        );

        const compareExec = await invokeTrackedTool("compare_products", {
          productIds: compareIds,
        });
        if (compareExec.success) {
          comparisonResult = compareExec.data as ProductComparisonResult;

          toolHistory.push({
            toolName: "compare_products",
            input: { productIds: compareIds },
            outputSummary: comparisonResult.explanation,
            durationMs: compareExec.durationMs,
          });

          emitEvent(
            "COMPARE_PRODUCTS",
            "DATA",
            `[Tool Result] Product comparison complete: ${comparisonResult.explanation}`,
            { comparison: comparisonResult, durationMs: compareExec.durationMs }
          );
        }
      }

      // Step 7: Synthesize Transparent Recommendation Reasoning
      emitEvent(
        "GENERATE_PROPOSAL",
        "INFO",
        "Synthesizing structured agent recommendation rationale and trade-off analysis..."
      );

      const reasoning = await llm.generateReasoning({
        userQuery: query,
        product: {
          title: topProd.title,
          brand: topProd.brand,
          seller: topProd.sellerName,
          rating: topProd.rating,
          deliveryDays: topProd.deliveryDays,
        },
        breakdown: topRanked.pricing,
        constraints: effectiveConstraints,
      });

      // Step 8: Tool Call 4 — stage_purchase_proposal (Authoritative Proposal Staging)
      const stageInput = {
        productId: topProd.id,
        constraints: effectiveConstraints,
        runId,
        guestSessionTokenHash,
        explanation: reasoning.explanation,
      };

      emitEvent(
        "TOOL_CALL",
        "TOOL",
        `[Tool Call 4/${MAX_AGENT_TOOL_CALLS}] invoking "stage_purchase_proposal" to lock recommendation for "${topProd.title}"`,
        { toolName: "stage_purchase_proposal", input: { productId: topProd.id, runId } }
      );

      const stageExec = await invokeTrackedTool("stage_purchase_proposal", stageInput);
      if (!stageExec.success || !stageExec.data) {
        const errMsg = stageExec.error || "Failed to stage purchase proposal";
        emitEvent("ERROR", "ERROR", errMsg);
        agentRunsStore.failRun(runId, errMsg);
        return {
          success: false,
          runId,
          llmProvider: llm.providerName,
          isMockMode: llm.providerName === "mock",
          error: errMsg,
          events,
          toolHistory,
        };
      }

      const proposal = stageExec.data as PurchaseProposalDto;

      toolHistory.push({
        toolName: "stage_purchase_proposal",
        input: { productId: topProd.id, runId },
        outputSummary: `Staged proposal #${proposal.id} (status: PENDING_REVIEW, total: $${(
          proposal.priceBreakdown.totalCostCents / 100
        ).toFixed(2)})`,
        durationMs: stageExec.durationMs,
      });

      emitEvent(
        "TOOL_RESULT",
        "DATA",
        `[Tool Result] "stage_purchase_proposal" created proposal #${proposal.id} (locked for human review, no charges created)`,
        { proposalId: proposal.id, durationMs: stageExec.durationMs }
      );

      // Update run status in persistence store
      agentRunsStore.completeRun(runId, { proposal });

      // Step 9: Ready for Review
      emitEvent(
        "READY_FOR_REVIEW",
        "COMPLETE",
        `Proposal #${proposal.id} locked and ready for verified human review. Total: $${(
          topRanked.pricing.totalCostCents / 100
        ).toFixed(2)}`,
        {
          proposal: {
            ...proposal,
            headline: reasoning.headline,
            pros: reasoning.pros,
            tradeoffs: reasoning.tradeoffs,
            complianceSummary: reasoning.constraintComplianceSummary,
          },
          alternatives: guardrailOutcome.rankedEligible.slice(1, 4).map((r) => ({
            product: r.product,
            breakdown: r.pricing,
            constraintEvaluation: { passed: true },
            notes: r.reasons,
          })),
          disqualifiedCandidates:
            sortedDisqualified.length > 0 ? sortedDisqualified : guardrailOutcome.disqualifiedCandidates,
          toolHistory,
        }
      );

      return {
        success: true,
        runId,
        llmProvider: llm.providerName,
        isMockMode: llm.providerName === "mock",
        proposal,
        reasoning,
        comparison: comparisonResult,
        alternatives: guardrailOutcome.rankedEligible.slice(1, 4).map((r) => ({
          product: r.product,
          breakdown: r.pricing,
          constraintEvaluation: { passed: true },
          notes: r.reasons,
        })),
        disqualifiedCandidates:
          sortedDisqualified.length > 0 ? sortedDisqualified : guardrailOutcome.disqualifiedCandidates,
        events,
        toolHistory,
      };
    })();

    // Run with timeout safety
    const timeoutPromise = new Promise<AgentRunResult>((_, reject) =>
      setTimeout(
        () => reject(new Error(`Agent run timed out after ${timeoutMs}ms`)),
        timeoutMs
      )
    );

    try {
      return await Promise.race([runExecutionPromise, timeoutPromise]);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "Run execution failed";
      emitEvent("ERROR", "ERROR", errMsg);
      agentRunsStore.failRun(runId, errMsg);
      return {
        success: false,
        runId,
        llmProvider: "unknown",
        isMockMode: true,
        error: errMsg,
        events,
        toolHistory,
      };
    }
  }
}
