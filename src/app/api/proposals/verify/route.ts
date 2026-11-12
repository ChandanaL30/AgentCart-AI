import { NextRequest, NextResponse } from "next/server";
import { isDatabaseConfigured, prisma } from "@/lib/db/prisma";
import { calculatePriceBreakdown, evaluateConstraints } from "@/lib/pricing/calculator";
import { proposalsStore } from "@/lib/proposals/store";
import { getOrCreateSessionToken } from "@/lib/session";
import { ShoppingConstraints } from "@/lib/types/agent";
import { VerifyProposalSchema } from "@/lib/types/checkout";

export async function POST(request: NextRequest) {
  try {
    const session = await getOrCreateSessionToken();
    const body = await request.json();
    const parsed = VerifyProposalSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid proposal verification payload",
          details: parsed.error.flatten().fieldErrors,
        },
        { status: 400 }
      );
    }

    const { proposalId, currentConstraints } = parsed.data;

    // 1. Load proposal from persistent storage (Prisma DB or active store)
    let proposal: {
      id: string;
      guestSessionTokenHash: string;
      product: {
        id: string;
        title: string;
        brand: string;
        seller: string;
        deliveryDays: number;
        rating: number;
        basePrice: number;
        shippingCost: number;
        estimatedTaxRate: number;
      };
      expiresAt: string;
      status: string;
    } | null = null;

    if (isDatabaseConfigured()) {
      try {
        const dbProposal = await prisma.purchaseProposal.findUnique({
          where: { id: proposalId },
          include: { product: true, session: true },
        });
        if (dbProposal) {
          proposal = {
            id: dbProposal.id,
            guestSessionTokenHash: dbProposal.session.tokenHash,
            product: {
              id: dbProposal.product.id,
              title: dbProposal.product.title,
              brand: dbProposal.product.brand,
              seller: dbProposal.product.seller,
              deliveryDays: dbProposal.product.deliveryDays,
              rating: dbProposal.product.rating,
              basePrice: dbProposal.product.basePrice,
              shippingCost: dbProposal.product.shippingCost,
              estimatedTaxRate: dbProposal.product.estimatedTaxRate,
            },
            expiresAt: dbProposal.expiresAt.toISOString(),
            status: dbProposal.status,
          };
        }
      } catch (dbErr) {
        console.warn("[PostgreSQL Proposal Lookup Warning]:", dbErr instanceof Error ? dbErr.message : dbErr);
      }
    }

    if (!proposal) {
      const stored = proposalsStore.get(proposalId);
      if (stored) {
        proposal = stored;
      }
    }

    if (!proposal) {
      return NextResponse.json(
        { success: false, error: `Proposal "${proposalId}" not found or expired.` },
        { status: 404 }
      );
    }

    // 2. Verify session ownership
    const isOwner = session.tokenHash === proposal.guestSessionTokenHash;
    if (!isOwner) {
      return NextResponse.json(
        { success: false, error: "Unauthorized: Session ownership mismatch for this proposal." },
        { status: 403 }
      );
    }

    // 3. Check expiration
    const isExpired = new Date(proposal.expiresAt).getTime() < Date.now();
    if (isExpired) {
      proposalsStore.updateStatus(proposal.id, "EXPIRED");
      return NextResponse.json(
        {
          success: false,
          status: "EXPIRED",
          error: "Proposal has expired (proposals are valid for 15 minutes). Please run a new search.",
          expiresAt: proposal.expiresAt,
        },
        { status: 410 }
      );
    }

    // 4. Recalculate price breakdown
    const recalculatedBreakdown = calculatePriceBreakdown(
      proposal.product.basePrice,
      proposal.product.shippingCost,
      proposal.product.estimatedTaxRate
    );

    // 5. Rerun hard constraints against current constraints
    const fullConstraints: ShoppingConstraints = {
      maxBudget: currentConstraints.maxBudget,
      maxDeliveryDays: currentConstraints.maxDeliveryDays,
      minRating: currentConstraints.minRating,
      preferredBrand: currentConstraints.preferredBrand,
      optimizationPreference: "BEST_VALUE",
    };

    const constraintAudit = evaluateConstraints(proposal.product, fullConstraints);

    if (!constraintAudit.passed) {
      return NextResponse.json(
        {
          success: false,
          status: "REJECTED_CONSTRAINTS_VIOLATED",
          error: "Proposal violates current constraints upon re-evaluation.",
          recalculatedBreakdown,
          constraintAudit,
        },
        { status: 422 }
      );
    }

    // 6. Update proposal status
    proposalsStore.updateStatus(proposal.id, "APPROVED");

    if (isDatabaseConfigured()) {
      try {
        await prisma.purchaseProposal.update({
          where: { id: proposal.id },
          data: { status: "APPROVED" },
        });
      } catch (dbErr) {
        console.warn("[PostgreSQL Proposal Update Warning]:", dbErr instanceof Error ? dbErr.message : dbErr);
      }
    }

    return NextResponse.json({
      success: true,
      proposalId: proposal.id,
      sessionVerified: true,
      status: "APPROVED_FOR_CHECKOUT",
      recalculatedBreakdown,
      constraintAudit,
      expiresAt: proposal.expiresAt,
      verifiedAt: new Date().toISOString(),
      message: "Proposal integrity verified against live pricing and constraints.",
    });
  } catch (error) {
    console.error("[Proposal Verification Error]:", error);
    return NextResponse.json(
      { success: false, error: "Failed to verify proposal" },
      { status: 500 }
    );
  }
}
