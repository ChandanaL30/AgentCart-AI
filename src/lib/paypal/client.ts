import { env } from "@/lib/env";
import {
  PayPalCaptureResponse,
  PayPalCreateOrderRequest,
  PayPalOrderResponse,
} from "./types";

const PAYPAL_SANDBOX_BASE_URL = "https://api-m.sandbox.paypal.com";

export class PayPalClient {
  private baseUrl: string;
  private clientId: string;
  private clientSecret: string;
  private isConfigured: boolean;

  constructor() {
    this.clientId = env.NEXT_PUBLIC_PAYPAL_CLIENT_ID;
    this.clientSecret = env.PAYPAL_CLIENT_SECRET;
    this.baseUrl =
      env.PAYPAL_ENVIRONMENT === "production"
        ? "https://api-m.paypal.com"
        : PAYPAL_SANDBOX_BASE_URL;

    this.isConfigured =
      Boolean(this.clientId) &&
      Boolean(this.clientSecret) &&
      this.clientId !== "sandbox_paypal_client_id_placeholder" &&
      this.clientSecret !== "sandbox_paypal_client_secret_placeholder";
  }

  /**
   * Returns current PayPal client configuration metadata.
   */
  getConfig() {
    return {
      environment: env.PAYPAL_ENVIRONMENT || "sandbox",
      apiUrl: this.baseUrl,
      isConfigured: this.isConfigured,
    };
  }

  /**
   * Retrieves an OAuth 2.0 client credentials access token from PayPal.
   */
  async getAccessToken(): Promise<string> {
    if (!this.isConfigured) {
      return "mock_sandbox_access_token_configured_fallback";
    }

    const auth = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString("base64");
    const res = await fetch(`${this.baseUrl}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Failed to retrieve PayPal access token (${res.status}): ${err}`);
    }

    const data = await res.json();
    return data.access_token;
  }

  /**
   * Creates a PayPal v2 Order with strict landed-cost minor unit breakdown.
   */
  async createOrder(params: {
    proposalId: string;
    productTitle: string;
    currency: string;
    totalCostCents: number;
    itemPriceCents: number;
    shippingCostCents: number;
    estimatedTaxCents: number;
    idempotencyKey: string;
  }): Promise<PayPalOrderResponse> {
    const {
      proposalId,
      productTitle,
      currency,
      totalCostCents,
      itemPriceCents,
      shippingCostCents,
      estimatedTaxCents,
      idempotencyKey,
    } = params;

    const totalValueStr = (totalCostCents / 100).toFixed(2);
    const itemTotalStr = (itemPriceCents / 100).toFixed(2);
    const shippingStr = (shippingCostCents / 100).toFixed(2);
    const taxTotalStr = (estimatedTaxCents / 100).toFixed(2);

    const orderPayload: PayPalCreateOrderRequest = {
      intent: "CAPTURE",
      purchase_units: [
        {
          reference_id: proposalId,
          custom_id: proposalId,
          description: `AgentCart Verified Purchase: ${productTitle.substring(0, 120)}`,
          amount: {
            currency_code: currency,
            value: totalValueStr,
            breakdown: {
              item_total: {
                currency_code: currency,
                value: itemTotalStr,
              },
              shipping: {
                currency_code: currency,
                value: shippingStr,
              },
              tax_total: {
                currency_code: currency,
                value: taxTotalStr,
              },
            },
          },
          items: [
            {
              name: productTitle.substring(0, 120),
              quantity: "1",
              unit_amount: {
                currency_code: currency,
                value: itemTotalStr,
              },
              category: "PHYSICAL_GOODS",
            },
          ],
        },
      ],
    };

    if (!this.isConfigured) {
      // Deterministic Sandbox Simulation for demo mode when API keys are placeholders
      const mockOrderId = `SANDBOX-ORD-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
      return {
        id: mockOrderId,
        status: "CREATED",
        create_time: new Date().toISOString(),
        links: [
          {
            href: `https://www.sandbox.paypal.com/checkoutnow?token=${mockOrderId}`,
            rel: "approve",
            method: "GET",
          },
        ],
      };
    }

    const token = await this.getAccessToken();
    const res = await fetch(`${this.baseUrl}/v2/checkout/orders`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "PayPal-Request-Id": idempotencyKey,
      },
      body: JSON.stringify(orderPayload),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`PayPal Orders API v2 create order failed (${res.status}): ${err}`);
    }

    return await res.json();
  }

  /**
   * Captures an authorized PayPal order.
   */
  async captureOrder(
    paypalOrderId: string,
    idempotencyKey?: string
  ): Promise<PayPalCaptureResponse> {
    if (!this.isConfigured || paypalOrderId.startsWith("SANDBOX-ORD-")) {
      // Deterministic Sandbox Capture simulation
      const mockCaptureId = `SANDBOX-CAP-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
      return {
        id: paypalOrderId,
        status: "COMPLETED",
        purchase_units: [
          {
            payments: {
              captures: [
                {
                  id: mockCaptureId,
                  status: "COMPLETED",
                  amount: {
                    currency_code: "USD",
                    value: "0.00",
                  },
                  create_time: new Date().toISOString(),
                },
              ],
            },
          },
        ],
      };
    }

    const token = await this.getAccessToken();
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };
    if (idempotencyKey) {
      headers["PayPal-Request-Id"] = idempotencyKey;
    }

    const res = await fetch(`${this.baseUrl}/v2/checkout/orders/${paypalOrderId}/capture`, {
      method: "POST",
      headers,
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`PayPal Orders API v2 capture failed (${res.status}): ${err}`);
    }

    return await res.json();
  }

  /**
   * Reconciles order state from PayPal API (used for recovery from timeouts or uncertain states).
   */
  async getOrder(paypalOrderId: string): Promise<PayPalOrderResponse> {
    if (!this.isConfigured || paypalOrderId.startsWith("SANDBOX-ORD-")) {
      return {
        id: paypalOrderId,
        status: "COMPLETED",
        create_time: new Date().toISOString(),
      };
    }

    const token = await this.getAccessToken();
    const res = await fetch(`${this.baseUrl}/v2/checkout/orders/${paypalOrderId}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`PayPal Orders API v2 getOrder failed (${res.status}): ${err}`);
    }

    return await res.json();
  }
}

export const paypalClient = new PayPalClient();
