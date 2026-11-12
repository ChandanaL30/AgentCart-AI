import { z } from "zod";
import { catalogService } from "@/lib/catalog/service";
import { CatalogProduct, ProductComparisonResult } from "@/lib/catalog/types";
import { GuardrailEngine } from "@/lib/guardrails/engine";
import {
  AuthoritativePricing,
  GuardrailCheckResult,
  GuardrailEvaluationOutcome,
} from "@/lib/guardrails/types";
import { calculateAuthoritativePricing } from "@/lib/pricing/calculator";
import { proposalsStore } from "@/lib/proposals/store";
import { PurchaseProposalDto, ShoppingConstraintsSchema } from "@/lib/types/agent";

/**
 * Standard tool definition interface.
 */
export interface AgentTool<TInput = unknown, TOutput = unknown> {
  name: string;
  description: string;
  schema: z.ZodTypeAny;
  execute: (input: TInput) => Promise<TOutput>;
}

// ---------------------------------------------------------
// Tool 1: search_products (alias: search_catalog)
// ---------------------------------------------------------
export const SearchProductsInputSchema = z.object({
  query: z.string().optional().describe("Free-text keywords or product titles to search for"),
  category: z.string().optional().describe("Category filter (headphones, keyboards, electronics, accessories, home-office)"),
  brand: z.string().optional().describe("Brand filter (e.g. Sony, Logitech, Anker, Bose)"),
  maxBudgetCents: z.number().int().positive().optional().describe("Maximum landed budget in USD cents"),
  maxDeliveryDays: z.number().int().positive().optional().describe("Maximum allowed business delivery days"),
  minRating: z.number().min(1).max(5).optional().describe("Minimum customer star rating threshold"),
  inStockOnly: z.boolean().default(false).describe("Whether to filter for currently in-stock products"),
});
export type SearchProductsInput = z.infer<typeof SearchProductsInputSchema>;

export const searchProductsTool: AgentTool<SearchProductsInput, CatalogProduct[]> = {
  name: "search_products",
  description:
    "Queries the multi-vendor catalog inventory for products matching keywords, category, brand, stock, and budget filters.",
  schema: SearchProductsInputSchema,
  execute: async (input) => {
    return catalogService.searchAsync(input);
  },
};

export const searchCatalogTool = {
  ...searchProductsTool,
  name: "search_catalog",
};

// ---------------------------------------------------------
// Tool 2: compare_products
// ---------------------------------------------------------
export const CompareProductsInputSchema = z.object({
  productIds: z.array(z.string().min(1)).min(2).max(5).describe("List of 2 to 5 product IDs to compare side-by-side"),
});
export type CompareProductsInput = z.infer<typeof CompareProductsInputSchema>;

export const compareProductsTool: AgentTool<CompareProductsInput, ProductComparisonResult> = {
  name: "compare_products",
  description:
    "Performs side-by-side comparative analysis of candidate products using the canonical pricing service, returning item price, shipping, estimated tax, total landed cost in cents, delivery estimate, and concise comparison facts.",
  schema: CompareProductsInputSchema,
  execute: async (input: CompareProductsInput) => {
    return catalogService.compareProducts(input.productIds);
  },
};

// ---------------------------------------------------------
// Tool 3: verify_budget_guardrails (alias: check_guardrails)
// ---------------------------------------------------------
export const VerifyBudgetGuardrailsInputSchema = z.object({
  productId: z.string().min(1).describe("The ID of the catalog product to evaluate"),
  constraints: ShoppingConstraintsSchema.describe("User-defined shopping constraints"),
  enforceBrand: z.boolean().default(false).describe("Whether brand mismatch should disqualify the item"),
});
export type VerifyBudgetGuardrailsInput = z.infer<typeof VerifyBudgetGuardrailsInputSchema>;

export const verifyBudgetGuardrailsTool: AgentTool<VerifyBudgetGuardrailsInput, GuardrailCheckResult> = {
  name: "verify_budget_guardrails",
  description:
    "Calls the deterministic guardrail service to evaluate a product against hard budget, delivery, rating, and brand constraints. Returns eligibility and structured rejection reason codes. Never allows LLM overrides.",
  schema: VerifyBudgetGuardrailsInputSchema,
  execute: async (input) => {
    const product = catalogService.getProductById(input.productId);
    if (!product) {
      throw new Error(`Product not found with ID "${input.productId}"`);
    }
    return GuardrailEngine.evaluateProduct(product, input.constraints, {
      enforceBrandAsHardConstraint: input.enforceBrand,
    });
  },
};

export const checkGuardrailsTool = {
  ...verifyBudgetGuardrailsTool,
  name: "check_guardrails",
};

// ---------------------------------------------------------
// Tool 4: stage_purchase_proposal
// ---------------------------------------------------------
export const StagePurchaseProposalInputSchema = z.object({
  productId: z.string().min(1).describe("The catalog product ID to stage as purchase proposal"),
  constraints: ShoppingConstraintsSchema.describe("Validated user constraints snapshot"),
  runId: z.string().min(1).describe("The active agent run ID"),
  guestSessionTokenHash: z.string().min(1).optional().default("guest_default_session").describe("Guest session token hash binding"),
  explanation: z.string().optional().default("Verified recommendation based on shopping criteria"),
});
export type StagePurchaseProposalInput = z.infer<typeof StagePurchaseProposalInputSchema>;

export const stagePurchaseProposalTool: AgentTool<StagePurchaseProposalInput, PurchaseProposalDto> = {
  name: "stage_purchase_proposal",
  description:
    "Stages an expiring purchase proposal for a validated catalog product. Recalculates authoritative landed price and re-verifies hard guardrails server-side before persisting. Never creates a PayPal order or charges a buyer.",
  schema: StagePurchaseProposalInputSchema,
  execute: async (input) => {
    // 1. Validate product exists in catalog
    const product = catalogService.getProductById(input.productId);
    if (!product) {
      throw new Error(`Product not found with ID "${input.productId}"`);
    }

    // 2. Authoritative server-side guardrail re-verification
    const guardrailResult = GuardrailEngine.evaluateProduct(product, input.constraints);
    if (!guardrailResult.eligible) {
      throw new Error(
        `Cannot stage purchase proposal: Product "${product.title}" fails hard guardrails (${guardrailResult.reasonCodes.join(
          ", "
        )}). Landed total: $${guardrailResult.pricing.totalCost.toFixed(2)}, budget cap: $${input.constraints.maxBudget.toFixed(2)}.`
      );
    }

    // 3. Construct proposal DTO
    const proposalId = `prop_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    const createdAt = new Date().toISOString();

    const proposal: PurchaseProposalDto = {
      id: proposalId,
      runId: input.runId,
      productId: product.id,
      product: {
        id: product.id,
        title: product.title,
        brand: product.brand,
        model: product.model || product.externalId,
        seller: product.sellerName,
        imageUrl: product.imageUrl,
        productUrl: product.productUrl,
        marketplace: product.marketplace || "Multi-Vendor Marketplace",
        rating: product.rating,
        reviewCount: product.reviewCount,
        deliveryDays: product.deliveryDays,
        category: product.category,
        description: product.description,
        shipsFrom: product.shipsFrom,
        inStock: product.inStock,
        stockQuantity: product.stockQuantity,
        warranty: product.warranty || (product.attributes?.warranty as string) || undefined,
        returnPolicy: product.returnPolicy || "Standard 30-day return policy",
        compatibility: product.compatibility || (product.attributes?.compatibility as string) || undefined,
        specs: product.specs || product.attributes,
        attributes: product.attributes,
        isMockData: product.isMockData,
      },
      priceBreakdown: guardrailResult.pricing,
      constraintsSnapshot: input.constraints,
      constraintEvaluation: {
        passed: guardrailResult.eligible,
        budgetPassed: guardrailResult.budgetPassed,
        deliveryPassed: guardrailResult.deliveryPassed,
        ratingPassed: guardrailResult.ratingPassed,
        brandPassed: guardrailResult.brandPassed,
        details: {
          budgetDiff:
            (Math.round(input.constraints.maxBudget * 100) -
              guardrailResult.pricing.totalCostCents) /
            100,
          deliveryDiff: input.constraints.maxDeliveryDays - product.deliveryDays,
          ratingDiff:
            Math.round((product.rating - input.constraints.minRating) * 10) / 10,
          brandMatch:
            product.brand.toLowerCase() ===
            (input.constraints.preferredBrand || "").toLowerCase(),
        },
      },
      reason: input.explanation || "Verified recommendation compliant with all policy guardrails.",
      version: 1,
      expiresAt,
      status: "PENDING_REVIEW",
      createdAt,
    };

    // 4. Persist in proposalsStore bound to guest session
    proposalsStore.save({
      id: proposalId,
      runId: input.runId,
      guestSessionTokenHash: input.guestSessionTokenHash,
      productId: product.id,
      product: {
        id: product.id,
        title: product.title,
        brand: product.brand,
        model: product.model || product.externalId,
        seller: product.sellerName,
        imageUrl: product.imageUrl,
        productUrl: product.productUrl,
        marketplace: product.marketplace || "Multi-Vendor Marketplace",
        rating: product.rating,
        reviewCount: product.reviewCount,
        deliveryDays: product.deliveryDays,
        category: product.category,
        description: product.description,
        shipsFrom: product.shipsFrom,
        inStock: product.inStock,
        stockQuantity: product.stockQuantity,
        warranty: product.warranty || (product.attributes?.warranty as string) || undefined,
        returnPolicy: product.returnPolicy || "Standard 30-day return policy",
        compatibility: product.compatibility || (product.attributes?.compatibility as string) || undefined,
        specs: product.specs || product.attributes,
        attributes: product.attributes,
        isMockData: product.isMockData,
        basePrice: product.basePrice,
        shippingCost: product.shippingCost,
        estimatedTaxRate: product.estimatedTaxRate,
      },
      priceBreakdown: guardrailResult.pricing,
      constraintsSnapshot: input.constraints,
      reason: proposal.reason,
      version: 1,
      expiresAt,
      status: "PENDING_REVIEW",
      createdAt,
    });

    return proposal;
  },
};

// ---------------------------------------------------------
// Tool 5: get_product_details
// ---------------------------------------------------------
export const GetProductDetailsInputSchema = z.object({
  productId: z.string().min(1).describe("The unique catalog product identifier"),
});
export type GetProductDetailsInput = z.infer<typeof GetProductDetailsInputSchema>;

export const getProductDetailsTool: AgentTool<GetProductDetailsInput, CatalogProduct | null> = {
  name: "get_product_details",
  description:
    "Retrieves full specifications, vendor information, stock level, and attributes for a specific product ID.",
  schema: GetProductDetailsInputSchema,
  execute: async (input) => {
    return catalogService.getProductById(input.productId);
  },
};

// ---------------------------------------------------------
// Tool 6: calculate_landed_cost
// ---------------------------------------------------------
export const CalculateLandedCostInputSchema = z.object({
  priceCents: z.number().int().nonnegative().describe("Base product price in integer USD cents"),
  shippingFeeCents: z.number().int().nonnegative().default(0).describe("Shipping cost in integer USD cents"),
  estimatedTaxRate: z.number().positive().default(0.0825).describe("Simulated sales tax rate (e.g. 0.0825 for 8.25%)"),
  currency: z.string().default("USD").describe("Currency ISO code (default: USD)"),
});
export type CalculateLandedCostInput = z.infer<typeof CalculateLandedCostInputSchema>;

export const calculateLandedCostTool: AgentTool<CalculateLandedCostInput, AuthoritativePricing> = {
  name: "calculate_landed_cost",
  description:
    "Performs authoritative server-side pricing arithmetic in integer minor units (USD cents), returning an itemized breakdown of base price, freight, estimated sales tax, and total landed cost.",
  schema: CalculateLandedCostInputSchema,
  execute: async (input) => {
    return calculateAuthoritativePricing({
      priceCents: input.priceCents,
      shippingFeeCents: input.shippingFeeCents,
      estimatedTaxRate: input.estimatedTaxRate,
      currency: input.currency,
    });
  },
};

// ---------------------------------------------------------
// Tool 7: rank_and_evaluate_catalog
// ---------------------------------------------------------
export const RankAndEvaluateInputSchema = z.object({
  productIds: z.array(z.string()).optional().describe("Optional subset of product IDs to rank. If omitted, evaluates all catalog items."),
  constraints: ShoppingConstraintsSchema.describe("User-defined shopping constraints"),
});
export type RankAndEvaluateInput = z.infer<typeof RankAndEvaluateInputSchema>;

export const rankAndEvaluateTool: AgentTool<RankAndEvaluateInput, GuardrailEvaluationOutcome> = {
  name: "rank_and_evaluate_catalog",
  description:
    "Authoritatively evaluates all candidate items against policy guardrails, strictly disqualifies non-compliant items, and ranks eligible items based on user optimization preference. If no items qualify, returns violation breakdown and actionable adjustment suggestions.",
  schema: RankAndEvaluateInputSchema,
  execute: async (input) => {
    const products = input.productIds !== undefined
      ? input.productIds
          .map((id) => catalogService.getProductById(id))
          .filter((p): p is CatalogProduct => p !== null)
      : catalogService.getAllProducts();

    return GuardrailEngine.evaluateAndRank(products, input.constraints);
  },
};

/**
 * Registry of all available agent tools.
 */
export const AGENT_TOOLS = {
  search_products: searchProductsTool,
  search_catalog: searchCatalogTool,
  compare_products: compareProductsTool,
  verify_budget_guardrails: verifyBudgetGuardrailsTool,
  check_guardrails: checkGuardrailsTool,
  stage_purchase_proposal: stagePurchaseProposalTool,
  get_product_details: getProductDetailsTool,
  calculate_landed_cost: calculateLandedCostTool,
  rank_and_evaluate_catalog: rankAndEvaluateTool,
};

export type AgentToolName = keyof typeof AGENT_TOOLS;

/**
 * Universal server-side tool execution dispatcher.
 */
export async function executeAgentTool(
  toolName: string,
  rawInput: unknown
): Promise<{ success: boolean; data?: unknown; error?: string; durationMs: number }> {
  const startTime = Date.now();
  const tool = AGENT_TOOLS[toolName as AgentToolName];

  if (!tool) {
    return {
      success: false,
      error: `Unrecognized agent tool: "${toolName}". Available tools: ${Object.keys(AGENT_TOOLS).join(", ")}`,
      durationMs: Date.now() - startTime,
    };
  }

  try {
    const parsedInput = tool.schema.parse(rawInput);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (tool as AgentTool<any, any>).execute(parsedInput);
    return {
      success: true,
      data: result,
      durationMs: Date.now() - startTime,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Tool execution failed",
      durationMs: Date.now() - startTime,
    };
  }
}

/**
 * JSON Schema export formatted for OpenAI Tools specification.
 */
export const OPENAI_TOOLS_SPEC = [
  {
    type: "function" as const,
    function: {
      name: "search_products",
      description: searchProductsTool.description,
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query keywords" },
          category: { type: "string", description: "Product category" },
          brand: { type: "string", description: "Brand name" },
          maxBudgetCents: { type: "integer", description: "Budget limit in cents" },
          maxDeliveryDays: { type: "integer", description: "Max delivery days" },
          minRating: { type: "number", description: "Minimum rating" },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "compare_products",
      description: compareProductsTool.description,
      parameters: {
        type: "object",
        properties: {
          productIds: {
            type: "array",
            items: { type: "string" },
            description: "List of product IDs to compare",
          },
        },
        required: ["productIds"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "verify_budget_guardrails",
      description: verifyBudgetGuardrailsTool.description,
      parameters: {
        type: "object",
        properties: {
          productId: { type: "string", description: "Product ID to verify" },
          constraints: { type: "object", description: "Shopping constraints object" },
        },
        required: ["productId", "constraints"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "stage_purchase_proposal",
      description: stagePurchaseProposalTool.description,
      parameters: {
        type: "object",
        properties: {
          productId: { type: "string", description: "Product ID to stage" },
          constraints: { type: "object", description: "Validated constraints snapshot" },
          runId: { type: "string", description: "Agent run ID" },
          guestSessionTokenHash: { type: "string", description: "Session token hash" },
          explanation: { type: "string", description: "Reason for proposal" },
        },
        required: ["productId", "constraints", "runId", "guestSessionTokenHash"],
      },
    },
  },
];
