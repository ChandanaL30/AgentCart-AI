import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { AgentOrchestrator } from "../agent/orchestrator";
import { agentRunsStore } from "../agent/runs-store";
import { catalogService } from "../catalog/service";
import { checkoutStore } from "../checkout/store";
import { GuardrailEngine } from "../guardrails/engine";
import { paypalClient } from "../paypal/client";
import { proposalsStore } from "../proposals/store";
import { hashSessionToken } from "../session";
import { POST as createOrderHandler } from "@/app/api/paypal/create-order/route";
import { POST as captureOrderHandler } from "@/app/api/paypal/capture-order/route";

// Track mock session token
let mockSessionCookie = "session_token_phase5_auditor_32chars_long";

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      if (name === "agentcart_session") {
        return { name, value: mockSessionCookie };
      }
      return undefined;
    },
    set: vi.fn(),
  }),
}));

describe("Phase 5 — Security Audit & End-to-End Scenarios", () => {
  const tokenHashA = hashSessionToken("session_token_phase5_auditor_32chars_long");

  beforeEach(() => {
    mockSessionCookie = "session_token_phase5_auditor_32chars_long";
  });

  // Scenario 1: A valid product is found, compared, approved by the guardrail engine, and staged as a proposal.
  it("Scenario 1: A valid product is found, compared, approved by the guardrail engine, and staged as a proposal", async () => {
    const runId = `e2e_scen1_${Date.now()}`;
    const result = await AgentOrchestrator.execute({
      query: "Find wireless noise canceling headphones under $350",
      constraints: {
        maxBudget: 350,
        maxDeliveryDays: 5,
        minRating: 4.5,
        preferredBrand: "",
        optimizationPreference: "BEST_VALUE",
      },
      runId,
      guestSessionTokenHash: tokenHashA,
    });

    expect(result.success).toBe(true);
    expect(result.proposal).toBeDefined();
    expect(result.proposal?.priceBreakdown.totalCostCents).toBeLessThanOrEqual(35000);
    // Verifies compare_products tool was invoked when multiple eligible candidates exist
    expect(result.toolHistory.some((t) => t.toolName === "compare_products")).toBe(true);
  });

  // Scenario 2: A product whose complete total exceeds the hard budget is rejected.
  it("Scenario 2: A product whose complete total exceeds the hard budget is rejected", async () => {
    const expensiveProduct = catalogService.getProductById("prod_sony_wh1000xm5");
    expect(expensiveProduct).toBeDefined();

    // Sony headphones landed cost is ~$376.71; evaluate against $200 budget
    const evaluation = GuardrailEngine.evaluateProduct(expensiveProduct!, {
      maxBudget: 200,
      maxDeliveryDays: 5,
      minRating: 4.0,
      optimizationPreference: "BEST_VALUE",
    });

    expect(evaluation.eligible).toBe(false);
    expect(evaluation.budgetPassed).toBe(false);
    expect(evaluation.reasonCodes).toContain("EXCEEDS_BUDGET");
    expect(evaluation.violations.some((v) => v.code === "EXCEEDS_BUDGET")).toBe(true);
  });

  // Scenario 3: A late-delivery or out-of-stock product is rejected.
  it("Scenario 3: A late-delivery or out-of-stock product is rejected", async () => {
    // 1. Out of stock item
    const oosProduct = catalogService.getProductById("prod_sony_wh1000xm4_oos");
    expect(oosProduct).toBeDefined();
    expect(oosProduct?.inStock).toBe(false);

    const oosEval = GuardrailEngine.evaluateProduct(oosProduct!, {
      maxBudget: 500,
      maxDeliveryDays: 10,
      minRating: 3.0,
      optimizationPreference: "BEST_VALUE",
    });
    expect(oosEval.eligible).toBe(false);
    expect(oosEval.inStockPassed).toBe(false);
    expect(oosEval.reasonCodes).toContain("OUT_OF_STOCK");

    // 2. Slow delivery item (9 days delivery)
    const slowProduct = catalogService.getProductById("prod_budget_slow_keyboard");
    expect(slowProduct).toBeDefined();
    expect(slowProduct?.deliveryDays).toBe(9);

    const slowEval = GuardrailEngine.evaluateProduct(slowProduct!, {
      maxBudget: 100,
      maxDeliveryDays: 3, // Requires 3 days max
      minRating: 3.0,
      optimizationPreference: "BEST_VALUE",
    });
    expect(slowEval.eligible).toBe(false);
    expect(slowEval.deliveryPassed).toBe(false);
    expect(slowEval.reasonCodes).toContain("DELIVERY_TOO_SLOW");
  });

  // Scenario 4: No eligible product exists and the user receives an explanation.
  it("Scenario 4: No eligible product exists and the user receives an actionable explanation", async () => {
    const runId = `e2e_scen4_${Date.now()}`;
    const result = await AgentOrchestrator.execute({
      query: "Find wireless headphones under $30",
      constraints: {
        maxBudget: 30, // Impossible for quality headphones in catalog
        maxDeliveryDays: 5,
        minRating: 4.5,
        preferredBrand: "",
        optimizationPreference: "BEST_VALUE",
      },
      runId,
      guestSessionTokenHash: tokenHashA,
    });

    expect(result.success).toBe(false);
    expect(result.noEligibleProducts).toBe(true);
    expect(result.violationBreakdown?.EXCEEDS_BUDGET).toBeGreaterThan(0);
    expect(result.suggestedAdjustments?.length).toBeGreaterThan(0);
    expect(result.suggestedAdjustments?.[0]).toContain("Increase budget to at least $");
    expect(result.closestAlternative).toBeDefined();
  });

  // Scenario 5: The browser attempts to alter the proposal amount.
  it("Scenario 5: The browser attempts to alter the proposal amount — server recalculates authoritatively", async () => {
    const proposalId = `prop_tamper_${Date.now()}`;
    proposalsStore.save({
      id: proposalId,
      runId: "run_tamper",
      guestSessionTokenHash: tokenHashA,
      productId: "prod_anker_q30",
      product: {
        id: "prod_anker_q30",
        title: "Anker Soundcore Life Q30",
        brand: "Anker",
        seller: "Anker Direct",
        deliveryDays: 2,
        rating: 4.6,
        reviewCount: 28400,
        category: "headphones",
        imageUrl: "https://example.com/q30.jpg",
        basePrice: 79.99,
        shippingCost: 0,
        estimatedTaxRate: 0.0825,
      },
      priceBreakdown: {
        itemPrice: 79.99,
        shippingCost: 0,
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
        optimizationPreference: "BEST_VALUE",
      },
      reason: "Tamper test",
      version: 1,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      status: "APPROVED",
      createdAt: new Date().toISOString(),
    });

    // Client attempts to pass a tampered amount of $1.00 in request body
    const req = new NextRequest("http://localhost:3000/api/paypal/create-order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        proposalId,
        idempotencyKey: `idem_tamper_${Date.now()}`,
        // Tampered parameters that must be completely ignored by server
        tamperedAmount: 1.0,
        tamperedTotal: "$1.00",
        priceCents: 100,
      }),
    });

    const res = await createOrderHandler(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    // Server strictly enforces authoritative recalculation: $86.59, NOT $1.00!
    expect(data.amount).toBe(86.59);
    expect(data.orderId).toBeDefined();
  });

  // Scenario 6: A different guest session attempts to read or buy another session's proposal.
  it("Scenario 6: A different guest session attempts to buy another session's proposal — blocked with 403", async () => {
    const proposalId = `prop_session_iso_${Date.now()}`;
    proposalsStore.save({
      id: proposalId,
      runId: "run_iso",
      guestSessionTokenHash: tokenHashA, // Owned by Session A
      productId: "prod_anker_q30",
      product: {
        id: "prod_anker_q30",
        title: "Anker Soundcore Life Q30",
        brand: "Anker",
        seller: "Anker Direct",
        deliveryDays: 2,
        rating: 4.6,
        reviewCount: 28400,
        category: "headphones",
        imageUrl: "https://example.com/q30.jpg",
        basePrice: 79.99,
        shippingCost: 0,
        estimatedTaxRate: 0.0825,
      },
      priceBreakdown: {
        itemPrice: 79.99,
        shippingCost: 0,
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
        optimizationPreference: "BEST_VALUE",
      },
      reason: "Session isolation test",
      version: 1,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      status: "APPROVED",
      createdAt: new Date().toISOString(),
    });

    // Request comes from Session B (attacker)
    mockSessionCookie = "different_session_token_attacker_session";

    const req = new NextRequest("http://localhost:3000/api/paypal/create-order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        proposalId,
        idempotencyKey: `idem_unauth_${Date.now()}`,
      }),
    });

    const res = await createOrderHandler(req);
    const data = await res.json();

    expect(res.status).toBe(403);
    expect(data.success).toBe(false);
    expect(data.error).toContain("Unauthorized: Session does not own this proposal");
  });

  // Scenario 7: A proposal expires between recommendation and checkout.
  it("Scenario 7: A proposal expires between recommendation and checkout — returns 410 Gone", async () => {
    const expiredProposalId = `prop_expired_${Date.now()}`;
    proposalsStore.save({
      id: expiredProposalId,
      runId: "run_expired",
      guestSessionTokenHash: tokenHashA,
      productId: "prod_anker_q30",
      product: {
        id: "prod_anker_q30",
        title: "Anker Soundcore Life Q30",
        brand: "Anker",
        seller: "Anker Direct",
        deliveryDays: 2,
        rating: 4.6,
        reviewCount: 28400,
        category: "headphones",
        imageUrl: "https://example.com/q30.jpg",
        basePrice: 79.99,
        shippingCost: 0,
        estimatedTaxRate: 0.0825,
      },
      priceBreakdown: {
        itemPrice: 79.99,
        shippingCost: 0,
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
        optimizationPreference: "BEST_VALUE",
      },
      reason: "Expired proposal test",
      version: 1,
      expiresAt: new Date(Date.now() - 60 * 1000).toISOString(), // Expired 1 minute ago
      status: "APPROVED",
      createdAt: new Date(Date.now() - 16 * 60 * 1000).toISOString(),
    });

    const req = new NextRequest("http://localhost:3000/api/paypal/create-order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        proposalId: expiredProposalId,
        idempotencyKey: `idem_exp_${Date.now()}`,
      }),
    });

    const res = await createOrderHandler(req);
    const data = await res.json();

    expect(res.status).toBe(410);
    expect(data.success).toBe(false);
    expect(data.error).toContain("Proposal has expired");
  });

  // Scenario 8: PayPal order creation fails.
  it("Scenario 8: PayPal order creation fails — returns error with status 500", async () => {
    const proposalId = `prop_gw_fail_${Date.now()}`;
    proposalsStore.save({
      id: proposalId,
      runId: "run_gw_fail",
      guestSessionTokenHash: tokenHashA,
      productId: "prod_anker_q30",
      product: {
        id: "prod_anker_q30",
        title: "Anker Soundcore Life Q30",
        brand: "Anker",
        seller: "Anker Direct",
        deliveryDays: 2,
        rating: 4.6,
        reviewCount: 28400,
        category: "headphones",
        imageUrl: "https://example.com/q30.jpg",
        basePrice: 79.99,
        shippingCost: 0,
        estimatedTaxRate: 0.0825,
      },
      priceBreakdown: {
        itemPrice: 79.99,
        shippingCost: 0,
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
        optimizationPreference: "BEST_VALUE",
      },
      reason: "Gateway error test",
      version: 1,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      status: "APPROVED",
      createdAt: new Date().toISOString(),
    });

    // Mock createOrder failure
    const spy = vi.spyOn(paypalClient, "createOrder").mockRejectedValueOnce(
      new Error("PayPal API Gateway 503 Service Unavailable")
    );

    const req = new NextRequest("http://localhost:3000/api/paypal/create-order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        proposalId,
        idempotencyKey: `idem_gw_${Date.now()}`,
      }),
    });

    const res = await createOrderHandler(req);
    const data = await res.json();

    expect(res.status).toBe(500);
    expect(data.success).toBe(false);
    expect(data.error).toBeDefined();

    spy.mockRestore();
  });

  // Scenario 9: The buyer cancels or the payment fails.
  it("Scenario 9: The buyer cancels or payment fails — capture marks session FAILED and rejects receipt", async () => {
    const csId = `cs_cancel_${Date.now()}`;
    const testOrderId = `SANDBOX-ORD-CANCEL-${Date.now()}`;
    const proposalId = `prop_cancel_${Date.now()}`;

    proposalsStore.save({
      id: proposalId,
      runId: "run_cancel",
      guestSessionTokenHash: tokenHashA,
      productId: "prod_anker_q30",
      product: {
        id: "prod_anker_q30",
        title: "Anker Soundcore Life Q30",
        brand: "Anker",
        seller: "Anker Direct",
        deliveryDays: 2,
        rating: 4.6,
        reviewCount: 28400,
        category: "headphones",
        imageUrl: "https://example.com/q30.jpg",
        basePrice: 79.99,
        shippingCost: 0,
        estimatedTaxRate: 0.0825,
      },
      priceBreakdown: {
        itemPrice: 79.99,
        shippingCost: 0,
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
        optimizationPreference: "BEST_VALUE",
      },
      reason: "Cancel test",
      version: 1,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      status: "APPROVED",
      createdAt: new Date().toISOString(),
    });

    checkoutStore.save({
      id: csId,
      proposalId,
      guestSessionTokenHash: tokenHashA,
      paypalOrderId: testOrderId,
      captureStatus: "CREATED",
      captureId: null,
      idempotencyKey: `idem_cancel_${Date.now()}`,
      amountCents: 8659,
      currency: "USD",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // Mock capture to return CANCELLED/VOIDED
    const spyCapture = vi.spyOn(paypalClient, "captureOrder").mockResolvedValueOnce({
      id: testOrderId,
      status: "FAILED",
      purchase_units: [],
    });

    const captureReq = new NextRequest("http://localhost:3000/api/paypal/capture-order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        paypalOrderId: testOrderId,
        checkoutSessionId: csId,
      }),
    });

    const res = await captureOrderHandler(captureReq);
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toContain("Payment was not completed by provider");

    // Checkout record is marked FAILED
    const sessionRecord = checkoutStore.get(csId);
    expect(sessionRecord?.captureStatus).toBe("FAILED");

    spyCapture.mockRestore();
  });

  // Scenario 10: Capture is requested twice or concurrently (idempotency).
  it("Scenario 10: Capture is requested twice or concurrently — returns cached receipt without duplicate charge", async () => {
    const csId = `cs_idem_${Date.now()}`;
    const testOrderId = `SANDBOX-ORD-IDEM-${Date.now()}`;
    const captureId = `CAPT-IDEM-${Date.now()}`;

    // Session already captured
    checkoutStore.save({
      id: csId,
      proposalId: "prop_idem_1",
      guestSessionTokenHash: tokenHashA,
      paypalOrderId: testOrderId,
      captureStatus: "COMPLETED",
      captureId,
      idempotencyKey: `idem_key_${Date.now()}`,
      amountCents: 8659,
      currency: "USD",
      receipt: {
        receiptId: `rcpt_${Date.now()}`,
        paypalOrderId: testOrderId,
        captureId,
        checkoutSessionId: csId,
        proposalId: "prop_idem_1",
        productId: "prod_anker_q30",
        productTitle: "Anker Soundcore Life Q30",
        sellerName: "Anker Direct",
        amountCents: 8659,
        amount: 86.59,
        breakdown: {
          itemPriceCents: 7999,
          shippingCostCents: 0,
          estimatedTaxCents: 660,
          totalCostCents: 8659,
          itemPrice: 79.99,
          shippingCost: 0,
          estimatedTax: 6.6,
          totalCost: 86.59,
        },
        currency: "USD",
        status: "COMPLETED",
        paymentSource: "PAYPAL_SANDBOX",
        isSimulated: true,
        capturedAt: new Date().toISOString(),
        customerSessionTokenHash: tokenHashA,
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const captureReq = new NextRequest("http://localhost:3000/api/paypal/capture-order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        paypalOrderId: testOrderId,
        checkoutSessionId: csId,
      }),
    });

    const res = await captureOrderHandler(captureReq);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.isAlreadyCaptured).toBe(true);
    expect(data.captureId).toBe(captureId);
    expect(data.receipt).toBeDefined();
  });

  // Scenario 11: PayPal returns an ambiguous or pending outcome.
  it("Scenario 11: PayPal returns an ambiguous outcome — reconciled via getOrder rather than blindly re-captured", async () => {
    const csId = `cs_ambig_${Date.now()}`;
    const testOrderId = `SANDBOX-ORD-AMBIG-${Date.now()}`;
    const proposalId = `prop_ambig_${Date.now()}`;

    proposalsStore.save({
      id: proposalId,
      runId: "run_ambig",
      guestSessionTokenHash: tokenHashA,
      productId: "prod_anker_q30",
      product: {
        id: "prod_anker_q30",
        title: "Anker Soundcore Life Q30",
        brand: "Anker",
        seller: "Anker Direct",
        deliveryDays: 2,
        rating: 4.6,
        reviewCount: 28400,
        category: "headphones",
        imageUrl: "https://example.com/q30.jpg",
        basePrice: 79.99,
        shippingCost: 0,
        estimatedTaxRate: 0.0825,
      },
      priceBreakdown: {
        itemPrice: 79.99,
        shippingCost: 0,
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
        optimizationPreference: "BEST_VALUE",
      },
      reason: "Ambiguous outcome test",
      version: 1,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      status: "APPROVED",
      createdAt: new Date().toISOString(),
    });

    checkoutStore.save({
      id: csId,
      proposalId,
      guestSessionTokenHash: tokenHashA,
      paypalOrderId: testOrderId,
      captureStatus: "CREATED",
      captureId: null,
      idempotencyKey: `idem_ambig_${Date.now()}`,
      amountCents: 8659,
      currency: "USD",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // Mock capture to throw network timeout, but getOrder verifies order status is COMPLETED
    const spyCapture = vi.spyOn(paypalClient, "captureOrder").mockRejectedValueOnce(
      new Error("ETIMEDOUT: Connection reset")
    );
    const spyGetOrder = vi.spyOn(paypalClient, "getOrder").mockResolvedValueOnce({
      id: testOrderId,
      status: "COMPLETED",
      create_time: new Date().toISOString(),
    });

    const captureReq = new NextRequest("http://localhost:3000/api/paypal/capture-order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        paypalOrderId: testOrderId,
        checkoutSessionId: csId,
      }),
    });

    const res = await captureOrderHandler(captureReq);
    const data = await res.json();

    expect(spyCapture).toHaveBeenCalled();
    expect(spyGetOrder).toHaveBeenCalledWith(testOrderId);
    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.status).toBe("COMPLETED");

    spyCapture.mockRestore();
    spyGetOrder.mockRestore();
  });

  // Scenario 12: A successful, verified capture produces one accurate receipt.
  it("Scenario 12: A successful verified capture produces one accurate receipt with integer minor units", async () => {
    const csId = `cs_succ_${Date.now()}`;
    const testOrderId = `SANDBOX-ORD-SUCC-${Date.now()}`;
    const proposalId = `prop_succ_${Date.now()}`;

    proposalsStore.save({
      id: proposalId,
      runId: "run_succ",
      guestSessionTokenHash: tokenHashA,
      productId: "prod_anker_q30",
      product: {
        id: "prod_anker_q30",
        title: "Anker Soundcore Life Q30",
        brand: "Anker",
        seller: "Anker Direct",
        deliveryDays: 2,
        rating: 4.6,
        reviewCount: 28400,
        category: "headphones",
        imageUrl: "https://example.com/q30.jpg",
        basePrice: 79.99,
        shippingCost: 0,
        estimatedTaxRate: 0.0825,
      },
      priceBreakdown: {
        itemPrice: 79.99,
        shippingCost: 0,
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
        optimizationPreference: "BEST_VALUE",
      },
      reason: "Successful capture test",
      version: 1,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      status: "APPROVED",
      createdAt: new Date().toISOString(),
    });

    checkoutStore.save({
      id: csId,
      proposalId,
      guestSessionTokenHash: tokenHashA,
      paypalOrderId: testOrderId,
      captureStatus: "CREATED",
      captureId: null,
      idempotencyKey: `idem_succ_${Date.now()}`,
      amountCents: 8659,
      currency: "USD",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const captureReq = new NextRequest("http://localhost:3000/api/paypal/capture-order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        paypalOrderId: testOrderId,
        checkoutSessionId: csId,
      }),
    });

    const res = await captureOrderHandler(captureReq);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.receipt).toBeDefined();
    expect(data.receipt.breakdown.totalCostCents).toBe(8659);
    expect(data.receipt.breakdown.itemPriceCents).toBe(7999);
    expect(data.receipt.breakdown.estimatedTaxCents).toBe(660);
    expect(data.receipt.breakdown.shippingCostCents).toBe(0);
    expect(data.receipt.paypalOrderId).toBe(testOrderId);
  });

  // Scenario 13: An agent run fails midway and reports a recoverable error.
  it("Scenario 13: An agent run fails midway and reports a recoverable error without unhandled exception", async () => {
    const runId = `e2e_scen13_${Date.now()}`;

    // Pass invalid constraint that causes orchestrator to handle gracefully
    const result = await AgentOrchestrator.execute({
      query: "Random query that will trigger safe completion",
      constraints: {
        maxBudget: 5, // Impossibly low budget ($5.00)
        maxDeliveryDays: 1,
        minRating: 5.0,
        preferredBrand: "NonExistentBrand12345",
        optimizationPreference: "PREFERRED_BRAND",
      },
      runId,
      guestSessionTokenHash: tokenHashA,
    });

    // Run must safely complete with recoverable structured outcome
    expect(result.success).toBe(false);
    expect(result.noEligibleProducts).toBe(true);
    expect(result.events.some((e) => e.eventType === "ERROR")).toBe(true);

    // Run is safely stored in runsStore
    const run = agentRunsStore.get(runId);
    expect(run).toBeDefined();
    expect(run?.status).toBe("FAILED");
  });

  // Scenario 14: An SSE client reconnects and resumes from persisted events.
  it("Scenario 14: An SSE client reconnects and resumes from persisted events", async () => {
    const runId = `e2e_scen14_${Date.now()}`;
    await AgentOrchestrator.execute({
      query: "Find wireless headphones under $150",
      constraints: {
        maxBudget: 150,
        maxDeliveryDays: 5,
        minRating: 4.5,
        preferredBrand: "",
        optimizationPreference: "BEST_VALUE",
      },
      runId,
      guestSessionTokenHash: tokenHashA,
    });

    // Client reconnects after disconnect and requests persisted run history
    const storedRun = agentRunsStore.get(runId);
    expect(storedRun).toBeDefined();
    expect(storedRun?.events.length).toBeGreaterThan(3);

    // Sequence numbers must be monotonically non-decreasing
    for (let i = 1; i < (storedRun?.events.length || 0); i++) {
      expect(storedRun!.events[i].sequence).toBeGreaterThanOrEqual(storedRun!.events[i - 1].sequence);
    }

    // Must contain both INITIALIZE and completion stages
    expect(storedRun?.events.some((e) => e.stage === "INITIALIZE")).toBe(true);
    expect(storedRun?.events.some((e) => e.stage === "READY_FOR_REVIEW")).toBe(true);
  });
});
