import { NextRequest, NextResponse } from "next/server";
import { catalogService } from "@/lib/catalog/service";
import { checkoutStore } from "@/lib/checkout/store";
import prisma from "@/lib/db/prisma";
import { GuardrailEngine } from "@/lib/guardrails/engine";
import { paypalClient } from "@/lib/paypal/client";
import { proposalsStore } from "@/lib/proposals/store";
import { getOrCreateSessionToken } from "@/lib/session";
import { ProposalStatus, ShoppingConstraints } from "@/lib/types/agent";
import { CreateCheckoutSessionSchema } from "@/lib/types/checkout";

/**
 * POST /api/paypal/create-order
 * Official PayPal Orders API v2 server endpoint.
 *
 * Enforces strict pre-order validation:
 * 1. Session authentication
 * 2. Proposal ownership verification
 * 3. Expiration validation (proposals are valid for 15 minutes)
 * 4. Authoritative catalog data reload
 * 5. Deterministic guardrail re-verification & integer minor unit recalculation
 * 6. Idempotency protection to prevent duplicate orders
 * 7. Server-authoritative order creation via PayPal client
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getOrCreateSessionToken();
    const body = await request.json();
    const parsed = CreateCheckoutSessionSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid checkout creation request payload",
          details: parsed.error.flatten().fieldErrors,
        },
        { status: 400 }
      );
    }

    const { proposalId, idempotencyKey } = parsed.data;

    // 1. Enforce idempotency: return existing checkout session if key already used
    const existing = checkoutStore.getByIdempotencyKey(idempotencyKey);
    if (existing) {
      return NextResponse.json({
        success: true,
        isIdempotentReplay: true,
        orderId: existing.paypalOrderId,
        paypalOrderId: existing.paypalOrderId,
        checkoutSessionId: existing.id,
        amount: existing.amountCents / 100,
        currency: existing.currency,
        status: existing.captureStatus,
      });
    }

    // 2. Load proposal from memory store or PostgreSQL
    let proposal = proposalsStore.get(proposalId);
    if (!proposal && process.env.DATABASE_URL) {
      try {
        const dbProp = await prisma.purchaseProposal.findUnique({
          where: { id: proposalId },
          include: { product: true, session: true },
        });
        if (dbProp) {
          proposal = {
            id: dbProp.id,
            runId: dbProp.runId,
            guestSessionTokenHash: dbProp.session.tokenHash,
            productId: dbProp.productId,
            product: {
              ...dbProp.product,
              specs: (dbProp.product.specs as Record<string, string | number | boolean>) || undefined,
              attributes: (dbProp.product.specs as Record<string, string | number | boolean>) || undefined,
              isMockData: true,
            },
            priceBreakdown: {
              itemPrice: dbProp.itemPrice,
              shippingCost: dbProp.shippingCost,
              estimatedTax: dbProp.estimatedTax,
              totalCost: dbProp.totalCost,
              itemPriceCents: Math.round(dbProp.itemPrice * 100),
              shippingCostCents: Math.round(dbProp.shippingCost * 100),
              estimatedTaxCents: Math.round(dbProp.estimatedTax * 100),
              totalCostCents: Math.round(dbProp.totalCost * 100),
              currency: dbProp.currency,
            },
            constraintsSnapshot: dbProp.constraintsSnapshot as unknown as ShoppingConstraints,
            reason: dbProp.reason,
            version: dbProp.version,
            expiresAt: dbProp.expiresAt.toISOString(),
            status: dbProp.status as ProposalStatus,
            createdAt: dbProp.createdAt.toISOString(),
          };
        }
      } catch (err) {
        console.warn("[PayPal Create Order] Database lookup failed:", err);
      }
    }

    if (!proposal) {
      return NextResponse.json(
        { success: false, error: `Proposal "${proposalId}" not found or expired.` },
        { status: 404 }
      );
    }

    // 3. Verify session ownership
    if (session.tokenHash !== proposal.guestSessionTokenHash) {
      return NextResponse.json(
        { success: false, error: "Unauthorized: Session does not own this proposal." },
        { status: 403 }
      );
    }

    // 4. Confirm proposal is unexpired
    const now = Date.now();
    const expiresAtMs = new Date(proposal.expiresAt).getTime();
    if (now > expiresAtMs) {
      proposalsStore.updateStatus(proposal.id, "EXPIRED");
      return NextResponse.json(
        {
          success: false,
          error: "Proposal has expired (proposals are valid for 15 minutes). Please run a new search.",
          expiresAt: proposal.expiresAt,
        },
        { status: 410 }
      );
    }

    // 5. Confirm proposal is in valid state (PENDING_REVIEW or APPROVED)
    if (proposal.status === "COMPLETED") {
      return NextResponse.json(
        { success: false, error: "Proposal has already been completed and captured." },
        { status: 409 }
      );
    }
    if (proposal.status === "REJECTED" || proposal.status === "SUPERSEDED") {
      return NextResponse.json(
        { success: false, error: `Proposal is in an invalid state: "${proposal.status}".` },
        { status: 422 }
      );
    }

    // 6. Reload authoritative catalog product and pricing data
    const liveProduct = catalogService.getProductById(proposal.productId);
    if (!liveProduct) {
      return NextResponse.json(
        { success: false, error: `Product "${proposal.productId}" is no longer available in inventory.` },
        { status: 404 }
      );
    }

    if (!liveProduct.inStock || liveProduct.stockQuantity <= 0) {
      return NextResponse.json(
        { success: false, error: `Product "${liveProduct.title}" is currently out of stock.` },
        { status: 422 }
      );
    }

    // 7. Recalculate landed cost and rerun all hard guardrails server-side
    const guardrailCheck = GuardrailEngine.evaluateProduct(
      liveProduct,
      proposal.constraintsSnapshot
    );

    if (!guardrailCheck.eligible) {
      proposalsStore.updateStatus(proposal.id, "REJECTED");
      return NextResponse.json(
        {
          success: false,
          error: `Proposal fails policy guardrails upon re-verification: ${guardrailCheck.reasonCodes.join(", ")}`,
          reasonCodes: guardrailCheck.reasonCodes,
        },
        { status: 422 }
      );
    }

    const authoritativePricing = guardrailCheck.pricing;

    // 8. Create PayPal Order on the server with authoritative amounts
    const paypalOrder = await paypalClient.createOrder({
      proposalId: proposal.id,
      productTitle: liveProduct.title,
      currency: authoritativePricing.currency,
      totalCostCents: authoritativePricing.totalCostCents,
      itemPriceCents: authoritativePricing.itemPriceCents,
      shippingCostCents: authoritativePricing.shippingCostCents,
      estimatedTaxCents: authoritativePricing.estimatedTaxCents,
      idempotencyKey,
    });

    // 9. Persist checkout attempt
    const checkoutSessionId = `cs_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const nowIso = new Date().toISOString();

    const checkoutSession = {
      id: checkoutSessionId,
      proposalId: proposal.id,
      guestSessionTokenHash: session.tokenHash,
      paypalOrderId: paypalOrder.id,
      captureStatus: "CREATED" as const,
      captureId: null,
      idempotencyKey,
      amountCents: authoritativePricing.totalCostCents,
      currency: authoritativePricing.currency,
      reconciliationData: {
        orderId: paypalOrder.id,
        status: paypalOrder.status,
        createTime: paypalOrder.create_time,
      },
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    checkoutStore.save(checkoutSession);

    // 10. Attempt PostgreSQL persistence if configured
    if (process.env.DATABASE_URL) {
      prisma.guestSession
        .findUnique({ where: { tokenHash: session.tokenHash } })
        .then(async (dbSession) => {
          if (dbSession) {
            await prisma.checkoutSession.create({
              data: {
                id: checkoutSessionId,
                proposalId: proposal.id,
                guestSessionId: dbSession.id,
                paypalOrderId: paypalOrder.id,
                captureStatus: "CREATED",
                idempotencyKey,
                amount: authoritativePricing.totalCost,
                currency: authoritativePricing.currency,
                reconciliationData: checkoutSession.reconciliationData,
              },
            });
          }
        })
        .catch(() => {});
    }

    return NextResponse.json({
      success: true,
      orderId: paypalOrder.id,
      paypalOrderId: paypalOrder.id,
      checkoutSessionId,
      amount: authoritativePricing.totalCost,
      amountCents: authoritativePricing.totalCostCents,
      currency: authoritativePricing.currency,
      status: "CREATED",
      approvalUrl: paypalOrder.links?.find((l) => l.rel === "approve")?.href || null,
    });
  } catch (error) {
    console.error("[PayPal Create Order Error]:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to create PayPal checkout order",
      },
      { status: 500 }
    );
  }
}
