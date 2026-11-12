export type PayPalEnvironment = "sandbox" | "production";

export interface PayPalAccessTokenResponse {
  scope: string;
  access_token: string;
  token_type: string;
  app_id: string;
  expires_in: number;
  nonce: string;
}

export interface PayPalAmountBreakdown {
  currency_code: string;
  value: string; // Decimal string formatted to 2 decimal places e.g. "86.59"
  breakdown?: {
    item_total?: {
      currency_code: string;
      value: string;
    };
    shipping?: {
      currency_code: string;
      value: string;
    };
    tax_total?: {
      currency_code: string;
      value: string;
    };
  };
}

export interface PayPalItem {
  name: string;
  quantity: string;
  unit_amount: {
    currency_code: string;
    value: string;
  };
  category?: "PHYSICAL_GOODS" | "DIGITAL_GOODS";
}

export interface PayPalPurchaseUnitRequest {
  reference_id: string;
  custom_id: string;
  description: string;
  amount: PayPalAmountBreakdown;
  items?: PayPalItem[];
}

export interface PayPalCreateOrderRequest {
  intent: "CAPTURE" | "AUTHORIZE";
  purchase_units: PayPalPurchaseUnitRequest[];
}

export interface PayPalOrderResponse {
  id: string;
  status: "CREATED" | "SAVED" | "APPROVED" | "VOIDED" | "COMPLETED" | "PAYER_ACTION_REQUIRED";
  links?: Array<{
    href: string;
    rel: string;
    method: string;
  }>;
  create_time?: string;
  update_time?: string;
}

export interface PayPalCaptureResponse {
  id: string;
  status: "COMPLETED" | "DECLINED" | "FAILED" | "PENDING";
  payment_source?: Record<string, unknown>;
  purchase_units?: Array<{
    reference_id?: string;
    payments?: {
      captures?: Array<{
        id: string;
        status: string;
        amount: {
          currency_code: string;
          value: string;
        };
        final_capture?: boolean;
        seller_protection?: {
          status: string;
        };
        create_time?: string;
        update_time?: string;
      }>;
    };
  }>;
}
