import { z } from "zod";

export const CheckoutStatusEnum = z.enum([
  "CREATED",
  "AWAITING_APPROVAL",
  "CAPTURING",
  "PENDING",
  "COMPLETED",
  "FAILED",
  "VOIDED",
  "SAVED",
  "APPROVED",
  "PAYER_ACTION_REQUIRED",
]);
export type CheckoutStatus = z.infer<typeof CheckoutStatusEnum>;

export const PaymentStatusEnum = z.enum([
  "NOT_CAPTURED",
  "PENDING",
  "CAPTURED",
  "FAILED",
  "UNKNOWN_RECONCILIATION",
]);
export type PaymentStatus = z.infer<typeof PaymentStatusEnum>;

export const CreateCheckoutSessionSchema = z.object({
  proposalId: z.string().min(1, "Proposal ID is required"),
  idempotencyKey: z.string().min(8, "Idempotency key must be at least 8 characters"),
});
export type CreateCheckoutSessionRequest = z.infer<typeof CreateCheckoutSessionSchema>;

export const CaptureOrderRequestSchema = z.object({
  paypalOrderId: z.string().min(1, "PayPal Order ID is required"),
  checkoutSessionId: z.string().optional(),
  idempotencyKey: z.string().optional(),
});
export type CaptureOrderRequest = z.infer<typeof CaptureOrderRequestSchema>;

export interface CheckoutReceipt {
  receiptId: string;
  checkoutSessionId: string;
  paypalOrderId: string;
  captureId: string;
  proposalId: string;
  productId: string;
  productTitle: string;
  sellerName: string;
  amountCents: number;
  amount: number;
  breakdown: {
    itemPriceCents: number;
    shippingCostCents: number;
    estimatedTaxCents: number;
    totalCostCents: number;
    itemPrice: number;
    shippingCost: number;
    estimatedTax: number;
    totalCost: number;
  };
  currency: string;
  status: "COMPLETED";
  paymentSource: string;
  isSimulated?: boolean;
  capturedAt: string;
  customerSessionTokenHash: string;
}

export interface CheckoutSessionDto {
  id: string;
  proposalId: string;
  paypalOrderId: string | null;
  captureStatus: CheckoutStatus;
  amount: number;
  amountCents: number;
  currency: string;
  approvalUrl?: string | null;
  receipt?: CheckoutReceipt | null;
  createdAt: string;
}

export const VerifyProposalSchema = z.object({
  proposalId: z.string().min(1),
  currentConstraints: z.object({
    maxBudget: z.number().positive(),
    maxDeliveryDays: z.number().int().positive(),
    minRating: z.number().min(1).max(5),
    preferredBrand: z.string().optional(),
    optimizationPreference: z.enum(["BEST_VALUE", "LOWEST_PRICE", "PREFERRED_BRAND"]).optional(),
  }),
});
export type VerifyProposalRequest = z.infer<typeof VerifyProposalSchema>;

