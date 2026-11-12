import { CheckoutReceipt, CheckoutStatus } from "@/lib/types/checkout";

export interface StoredCheckoutSession {
  id: string;
  proposalId: string;
  guestSessionTokenHash: string;
  paypalOrderId: string;
  captureStatus: CheckoutStatus;
  captureId?: string | null;
  idempotencyKey: string;
  amountCents: number;
  currency: string;
  receipt?: CheckoutReceipt | null;
  reconciliationData?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

declare global {
  var __agentcartCheckouts: Map<string, StoredCheckoutSession> | undefined;
}

const checkoutsMap: Map<string, StoredCheckoutSession> =
  global.__agentcartCheckouts || new Map<string, StoredCheckoutSession>();

if (process.env.NODE_ENV !== "production") {
  global.__agentcartCheckouts = checkoutsMap;
}

export const checkoutStore = {
  save(session: StoredCheckoutSession): void {
    checkoutsMap.set(session.id, session);
  },

  getById(id: string): StoredCheckoutSession | undefined {
    return checkoutsMap.get(id);
  },

  get(id: string): StoredCheckoutSession | undefined {
    return checkoutsMap.get(id);
  },

  getByOrderId(paypalOrderId: string): StoredCheckoutSession | undefined {
    return Array.from(checkoutsMap.values()).find(
      (c) => c.paypalOrderId === paypalOrderId
    );
  },

  getByIdempotencyKey(key: string): StoredCheckoutSession | undefined {
    return Array.from(checkoutsMap.values()).find(
      (c) => c.idempotencyKey === key
    );
  },

  getByProposalId(proposalId: string): StoredCheckoutSession | undefined {
    return Array.from(checkoutsMap.values()).find(
      (c) => c.proposalId === proposalId
    );
  },

  updateStatus(
    id: string,
    status: CheckoutStatus,
    reconciliationData?: Record<string, unknown>
  ): StoredCheckoutSession | undefined {
    const existing = checkoutsMap.get(id);
    if (!existing) return undefined;

    const updated: StoredCheckoutSession = {
      ...existing,
      captureStatus: status,
      reconciliationData: reconciliationData || existing.reconciliationData,
      updatedAt: new Date().toISOString(),
    };
    checkoutsMap.set(id, updated);
    return updated;
  },

  updateCapture(
    id: string,
    captureId: string,
    receipt: CheckoutReceipt,
    reconciliationData?: Record<string, unknown>
  ): StoredCheckoutSession | undefined {
    const existing = checkoutsMap.get(id);
    if (!existing) return undefined;

    const updated: StoredCheckoutSession = {
      ...existing,
      captureStatus: "COMPLETED",
      captureId,
      receipt,
      reconciliationData: reconciliationData || existing.reconciliationData,
      updatedAt: new Date().toISOString(),
    };
    checkoutsMap.set(id, updated);
    return updated;
  },
};
