import { PriceBreakdown, ProposalStatus, ShoppingConstraints } from "@/lib/types/agent";

export interface StoredProposal {
  id: string;
  runId: string;
  guestSessionTokenHash: string;
  productId: string;
  product: {
    id: string;
    title: string;
    brand: string;
    seller: string;
    imageUrl: string;
    rating: number;
    reviewCount: number;
    deliveryDays: number;
    category: string;
    basePrice: number;
    shippingCost: number;
    estimatedTaxRate: number;
    model?: string;
    description?: string;
    productUrl?: string;
    marketplace?: string;
    shipsFrom?: string;
    inStock?: boolean;
    stockQuantity?: number;
    warranty?: string;
    returnPolicy?: string;
    compatibility?: string;
    specs?: Record<string, string | number | boolean>;
    attributes?: Record<string, string | number | boolean>;
    isMockData?: boolean;
  };
  priceBreakdown: PriceBreakdown;
  constraintsSnapshot: ShoppingConstraints;
  reason: string;
  version: number;
  expiresAt: string;
  status: ProposalStatus;
  createdAt: string;
}

// Global in-memory storage for active proposals (survives hot-reloads during development)
declare global {
  var __agentcartProposals: Map<string, StoredProposal> | undefined;
}

const proposalsMap: Map<string, StoredProposal> =
  global.__agentcartProposals || new Map<string, StoredProposal>();

if (process.env.NODE_ENV !== "production") {
  global.__agentcartProposals = proposalsMap;
}

export const proposalsStore = {
  save(proposal: StoredProposal): void {
    proposalsMap.set(proposal.id, proposal);
  },

  get(id: string): StoredProposal | undefined {
    return proposalsMap.get(id);
  },

  getById(id: string): StoredProposal | undefined {
    return proposalsMap.get(id);
  },

  updateStatus(
    id: string,
    status: StoredProposal["status"]
  ): StoredProposal | undefined {
    const existing = proposalsMap.get(id);
    if (!existing) return undefined;
    const updated = { ...existing, status };
    proposalsMap.set(id, updated);
    return updated;
  },

  getAllForSession(tokenHash: string): StoredProposal[] {
    return Array.from(proposalsMap.values()).filter(
      (p) => p.guestSessionTokenHash === tokenHash
    );
  },
};
