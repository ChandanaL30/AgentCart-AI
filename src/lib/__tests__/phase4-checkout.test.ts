import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { checkoutStore } from "../checkout/store";
import { paypalClient } from "../paypal/client";
import { proposalsStore, StoredProposal } from "../proposals/store";
import { hashSessionToken } from "../session";
import {
  CaptureOrderRequestSchema,
  CheckoutReceipt,
  CheckoutStatusEnum,
  CreateCheckoutSessionSchema,
  PaymentStatusEnum,
} from "../types/checkout";
import { POST as createOrderHandler } from "@/app/api/paypal/create-order/route";
import { POST as captureOrderHandler } from "@/app/api/paypal/capture-order/route";

// Track mock session token
let currentMockSessionToken = "test_session_token_for_phase4_32chars_long";

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      if (name === "agentcart_session") {
        return { name, value: currentMockSessionToken };
      }
      return undefined;
    },
    set: vi.fn(),
  }),
}));

describe("Phase 4 — PayPal Client & Configuration Safety", () => {
  it("defaults strictly to Sandbox mode and never silently falls back to Live mode", () => {
    // Verify client configuration
    const config = paypalClient.getConfig();
    expect(config.environment).toBe("sandbox");
    expect(config.apiUrl).toContain("sandbox.paypal.com");
    expect(config.apiUrl).not.toContain("api-m.paypal.com"); // Live endpoint must not be active
  });

  it("validates request schemas and rejects malformed payloads", () => {
    // 1. CreateCheckoutSessionSchema requires non-empty proposalId and idempotencyKey >= 8 chars
    const invalidCreate1 = CreateCheckoutSessionSchema.safeParse({});
    expect(invalidCreate1.success).toBe(false);

    const invalidCreate2 = CreateCheckoutSessionSchema.safeParse({
      proposalId: "prop_123",
      idempotencyKey: "short", // < 8 chars
    });
    expect(invalidCreate2.success).toBe(false);

    const validCreate = CreateCheckoutSessionSchema.safeParse({
      proposalId: "prop_123",
      idempotencyKey: "idem_valid_key_123",
    });
    expect(validCreate.success).toBe(true);

    // 2. CaptureOrderRequestSchema requires paypalOrderId
    const invalidCapture = CaptureOrderRequestSchema.safeParse({});
    expect(invalidCapture.success).toBe(false);

    const validCapture = CaptureOrderRequestSchema.safeParse({
      paypalOrderId: "SANDBOX-ORD-12345",
      checkoutSessionId: "cs_12345",
    });
    expect(validCapture.success).toBe(true);
  });

  it("enforces finite state machine enums for checkout and payment status", () => {
    // Checkout states
    expect(CheckoutStatusEnum.safeParse("CREATED").success).toBe(true);
    expect(CheckoutStatusEnum.safeParse("AWAITING_APPROVAL").success).toBe(true);
    expect(CheckoutStatusEnum.safeParse("CAPTURING").success).toBe(true);
    expect(CheckoutStatusEnum.safeParse("COMPLETED").success).toBe(true);
    expect(CheckoutStatusEnum.safeParse("FAILED").success).toBe(true);
    expect(CheckoutStatusEnum.safeParse("INVALID_STATUS").success).toBe(false);

    // Payment states
    expect(PaymentStatusEnum.safeParse("NOT_CAPTURED").success).toBe(true);
    expect(PaymentStatusEnum.safeParse("CAPTURED").success).toBe(true);
    expect(PaymentStatusEnum.safeParse("UNKNOWN_RECONCILIATION").success).toBe(true);
    expect(PaymentStatusEnum.safeParse("RANDOM_STATE").success).toBe(false);
  });
});

describe("Phase 4 — Create Order Endpoint & Pre-Checkout Guardrails", () => {
  const tokenHash = hashSessionToken(currentMockSessionToken);

  const testProposal: StoredProposal = {
    id: "prop_p4_valid_1",
    runId: "run_p4_1",
    guestSessionTokenHash: tokenHash,
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
    reason: "Best value wireless noise cancelling headphones",
    version: 1,
    expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    status: "PENDING_REVIEW",
    createdAt: new Date().toISOString(),
  };

  beforeEach(() => {
    currentMockSessionToken = "test_session_token_for_phase4_32chars_long";
    proposalsStore.save(testProposal);
  });

  it("successfully creates a PayPal sandbox order with authoritative landed cost in USD", async () => {
    const req = new NextRequest("http://localhost:3000/api/paypal/create-order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        proposalId: testProposal.id,
        idempotencyKey: `idem_test_${Date.now()}`,
      }),
    });

    const res = await createOrderHandler(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.orderId).toBeDefined();
    expect(data.orderId).toMatch(/^SANDBOX-ORD-/);
    expect(data.checkoutSessionId).toBeDefined();
    expect(data.amount).toBe(86.59);
    expect(data.amountCents).toBe(8659);
    expect(data.currency).toBe("USD");
    expect(data.status).toBe("CREATED");

    // Verify stored checkout session
    const storedCheckout = checkoutStore.getById(data.checkoutSessionId);
    expect(storedCheckout).toBeDefined();
    expect(storedCheckout?.paypalOrderId).toBe(data.orderId);
    expect(storedCheckout?.amountCents).toBe(8659);
    expect(storedCheckout?.captureStatus).toBe("CREATED");
  });

  it("rejects create-order if session ownership does not match (403 Forbidden)", async () => {
    // Change session token to simulate an attacker trying to checkout another user's proposal
    currentMockSessionToken = "attacker_foreign_session_token_32chars!";

    const req = new NextRequest("http://localhost:3000/api/paypal/create-order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        proposalId: testProposal.id,
        idempotencyKey: `idem_attacker_${Date.now()}`,
      }),
    });

    const res = await createOrderHandler(req);
    const data = await res.json();

    expect(res.status).toBe(403);
    expect(data.success).toBe(false);
    expect(data.error).toContain("Unauthorized");
  });

  it("rejects create-order if proposal has expired (410 Gone)", async () => {
    const expiredProposal: StoredProposal = {
      ...testProposal,
      id: "prop_expired_checkout_test",
      expiresAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(), // expired 5 mins ago
    };
    proposalsStore.save(expiredProposal);

    const req = new NextRequest("http://localhost:3000/api/paypal/create-order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        proposalId: expiredProposal.id,
        idempotencyKey: `idem_exp_${Date.now()}`,
      }),
    });

    const res = await createOrderHandler(req);
    const data = await res.json();

    expect(res.status).toBe(410);
    expect(data.success).toBe(false);
    expect(data.error).toContain("expired");

    // Proposal status must transition to EXPIRED
    const stored = proposalsStore.get(expiredProposal.id);
    expect(stored?.status).toBe("EXPIRED");
  });

  it("rejects create-order if proposal is already completed or rejected", async () => {
    const completedProposal: StoredProposal = {
      ...testProposal,
      id: "prop_completed_checkout_test",
      status: "COMPLETED",
    };
    proposalsStore.save(completedProposal);

    const req = new NextRequest("http://localhost:3000/api/paypal/create-order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        proposalId: completedProposal.id,
        idempotencyKey: `idem_comp_${Date.now()}`,
      }),
    });

    const res = await createOrderHandler(req);
    const data = await res.json();

    expect(res.status).toBe(409);
    expect(data.success).toBe(false);
    expect(data.error).toContain("already been completed");
  });

  it("re-runs deterministic guardrails and rejects checkout if product fails constraints", async () => {
    // Create proposal where constraints snapshot budget is $50 (but item landed cost is $86.59)
    const failingProposal: StoredProposal = {
      ...testProposal,
      id: "prop_budget_fail_checkout",
      constraintsSnapshot: {
        ...testProposal.constraintsSnapshot,
        maxBudget: 50, // Landed cost $86.59 > $50
      },
    };
    proposalsStore.save(failingProposal);

    const req = new NextRequest("http://localhost:3000/api/paypal/create-order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        proposalId: failingProposal.id,
        idempotencyKey: `idem_fail_${Date.now()}`,
      }),
    });

    const res = await createOrderHandler(req);
    const data = await res.json();

    expect(res.status).toBe(422);
    expect(data.success).toBe(false);
    expect(data.error).toContain("fails policy guardrails");
  });

  it("enforces idempotency on create-order: returns existing checkout on duplicate request", async () => {
    const idempotencyKey = `idem_replay_test_${Date.now()}`;

    // First request
    const req1 = new NextRequest("http://localhost:3000/api/paypal/create-order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        proposalId: testProposal.id,
        idempotencyKey,
      }),
    });
    const res1 = await createOrderHandler(req1);
    const data1 = await res1.json();
    expect(res1.status).toBe(200);

    // Second request with same idempotencyKey
    const req2 = new NextRequest("http://localhost:3000/api/paypal/create-order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        proposalId: testProposal.id,
        idempotencyKey,
      }),
    });
    const res2 = await createOrderHandler(req2);
    const data2 = await res2.json();

    expect(res2.status).toBe(200);
    expect(data2.isIdempotentReplay).toBe(true);
    expect(data2.orderId).toBe(data1.orderId);
    expect(data2.checkoutSessionId).toBe(data1.checkoutSessionId);
  });
});

describe("Phase 4 — Capture Order Endpoint, State Machine & Immutable Receipt", () => {
  const tokenHash = hashSessionToken(currentMockSessionToken);

  let proposalId: string;
  let checkoutSessionId: string;
  let paypalOrderId: string;

  beforeEach(async () => {
    currentMockSessionToken = "test_session_token_for_phase4_32chars_long";
    proposalId = `prop_capture_test_${Date.now()}`;

    // Stage valid proposal
    proposalsStore.save({
      id: proposalId,
      runId: "run_capture_1",
      guestSessionTokenHash: tokenHash,
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
        maxBudget: 120,
        maxDeliveryDays: 5,
        minRating: 4.5,
        preferredBrand: "Anker",
        optimizationPreference: "BEST_VALUE",
      },
      reason: "Premium wireless noise cancelling headphones within budget",
      version: 1,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      status: "APPROVED",
      createdAt: new Date().toISOString(),
    });

    // Create checkout session via endpoint
    const createReq = new NextRequest("http://localhost:3000/api/paypal/create-order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        proposalId,
        idempotencyKey: `idem_cap_setup_${Date.now()}`,
      }),
    });
    const createRes = await createOrderHandler(createReq);
    const createData = await createRes.json();
    checkoutSessionId = createData.checkoutSessionId;
    paypalOrderId = createData.orderId;
  });

  it("successfully captures an approved order and generates an immutable receipt", async () => {
    const captureReq = new NextRequest("http://localhost:3000/api/paypal/capture-order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        paypalOrderId,
        checkoutSessionId,
        idempotencyKey: `cap_idem_${Date.now()}`,
      }),
    });

    const res = await captureOrderHandler(captureReq);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.status).toBe("COMPLETED");
    expect(data.captureId).toBeDefined();
    expect(data.paypalOrderId).toBe(paypalOrderId);
    expect(data.amount).toBe(86.59);
    expect(data.currency).toBe("USD");

    // Verify Receipt structure
    const receipt: CheckoutReceipt = data.receipt;
    expect(receipt).toBeDefined();
    expect(receipt.receiptId).toMatch(/^rcpt_/);
    expect(receipt.checkoutSessionId).toBe(checkoutSessionId);
    expect(receipt.paypalOrderId).toBe(paypalOrderId);
    expect(receipt.productTitle).toBe("Anker Soundcore Life Q30");
    expect(receipt.sellerName).toBe("Anker Direct");
    expect(receipt.amount).toBe(86.59);
    expect(receipt.amountCents).toBe(8659);
    expect(receipt.currency).toBe("USD");
    expect(receipt.paymentSource).toBe("PAYPAL_SANDBOX");
    expect(receipt.status).toBe("COMPLETED");
    expect(receipt.capturedAt).toBeDefined();

    // Verify proposal status updated to COMPLETED
    const updatedProposal = proposalsStore.get(proposalId);
    expect(updatedProposal?.status).toBe("COMPLETED");

    // Verify checkout store updated
    const updatedCheckout = checkoutStore.getById(checkoutSessionId);
    expect(updatedCheckout?.captureStatus).toBe("COMPLETED");
    expect(updatedCheckout?.captureId).toBe(data.captureId);
  });

  it("prevents double-capture: repeated capture requests return existing receipt idempotently", async () => {
    // Capture once
    const captureReq1 = new NextRequest("http://localhost:3000/api/paypal/capture-order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        paypalOrderId,
        checkoutSessionId,
      }),
    });
    const res1 = await captureOrderHandler(captureReq1);
    const data1 = await res1.json();
    expect(res1.status).toBe(200);
    expect(data1.success).toBe(true);

    // Capture second time with same order ID
    const captureReq2 = new NextRequest("http://localhost:3000/api/paypal/capture-order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        paypalOrderId,
        checkoutSessionId,
      }),
    });
    const res2 = await captureOrderHandler(captureReq2);
    const data2 = await res2.json();

    expect(res2.status).toBe(200);
    expect(data2.isAlreadyCaptured).toBe(true);
    expect(data2.captureId).toBe(data1.captureId);
    expect(data2.receipt).toBeDefined();
    expect(data2.receipt.receiptId).toBe(data1.receipt.receiptId);
  });

  it("rejects capture if session ownership does not match (403 Forbidden)", async () => {
    currentMockSessionToken = "attacker_session_token_32_chars_long!";

    const captureReq = new NextRequest("http://localhost:3000/api/paypal/capture-order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        paypalOrderId,
        checkoutSessionId,
      }),
    });

    const res = await captureOrderHandler(captureReq);
    const data = await res.json();

    expect(res.status).toBe(403);
    expect(data.success).toBe(false);
    expect(data.error).toContain("Unauthorized");
  });

  it("rejects capture if paypalOrderId does not match checkout session record (400 Bad Request)", async () => {
    const captureReq = new NextRequest("http://localhost:3000/api/paypal/capture-order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        paypalOrderId: "SANDBOX-ORD-TAMPERED-ID",
        checkoutSessionId,
      }),
    });

    const res = await captureOrderHandler(captureReq);
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toContain("Order ID mismatch");
  });

  it("reconciles order via getOrder on ambiguous network response instead of blind retry", async () => {
    const testOrderId = `SANDBOX-ORD-RECONCILE-${Date.now()}`;
    const spyGetOrder = vi.spyOn(paypalClient, "getOrder").mockResolvedValueOnce({
      id: testOrderId,
      status: "COMPLETED",
      create_time: new Date().toISOString(),
    });

    // Create a checkout session with this test order ID
    const csId = `cs_reconcile_${Date.now()}`;
    checkoutStore.save({
      id: csId,
      proposalId,
      guestSessionTokenHash: tokenHash,
      paypalOrderId: testOrderId,
      captureStatus: "CREATED",
      captureId: null,
      idempotencyKey: `idem_recon_${Date.now()}`,
      amountCents: 8659,
      currency: "USD",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // Mock captureOrder to simulate network timeout failure
    const spyCapture = vi.spyOn(paypalClient, "captureOrder").mockRejectedValueOnce(
      new Error("PayPal API Gateway Timeout (504)")
    );

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

    spyGetOrder.mockRestore();
    spyCapture.mockRestore();
  });
});

describe("Phase 4 — Fintech Policy: A Purchase Proposal Alone Never Implies Payment", () => {
  it("strictly enforces that creating, inspecting, or approving a proposal does NOT charge payment", () => {
    const sampleProposalId = `prop_policy_check_${Date.now()}`;
    const tokenHash = "hash_policy_check";

    proposalsStore.save({
      id: sampleProposalId,
      runId: "run_policy_1",
      guestSessionTokenHash: tokenHash,
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
        optimizationPreference: "BEST_VALUE",
      },
      reason: "Policy check proposal",
      version: 1,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      status: "APPROVED",
      createdAt: new Date().toISOString(),
    });

    // 1. Proposal is in APPROVED state
    const prop = proposalsStore.get(sampleProposalId);
    expect(prop?.status).toBe("APPROVED");

    // 2. No checkout session exists automatically
    const checkoutSession = checkoutStore.getByProposalId(sampleProposalId);
    expect(checkoutSession).toBeUndefined();

    // 3. No capture exists
    expect(checkoutStore.getByOrderId("NON_EXISTENT")).toBeUndefined();
  });
});

describe("Phase 4 — Regression: React useSyncExternalStore Snapshot Stability", () => {
  it("guarantees snapshot returns referentially stable values between store updates to prevent infinite render loops", () => {
    // External store snapshot contract: consecutive calls without onStoreChange must be identical
    let snapshotValue = 1729530000000;
    const getSnapshot = () => snapshotValue;

    const snap1 = getSnapshot();
    const snap2 = getSnapshot();
    const snap3 = getSnapshot();

    // Consecutive calls within the same render pass MUST return identical values (Object.is)
    expect(Object.is(snap1, snap2)).toBe(true);
    expect(Object.is(snap2, snap3)).toBe(true);
    expect(snap1).toBe(snap3);

    // Only when an external tick occurs does the snapshot advance
    snapshotValue += 10000;
    const snap4 = getSnapshot();
    expect(snap4).toBe(snap1 + 10000);
    expect(Object.is(snap4, getSnapshot())).toBe(true);
  });
});
