import { ShoppingConstraints, ShoppingConstraintsSchema } from "@/lib/types/agent";
import { z } from "zod";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export const ExtractedConstraintsResultSchema = z.object({
  detectedCategory: z.string().optional(),
  extractedConstraints: ShoppingConstraintsSchema.partial().default({}),
  confidence: z.number().min(0).max(1).default(0.9),
  explanation: z.string().default("Extracted constraints"),
});
export type ExtractedConstraintsResult = z.infer<typeof ExtractedConstraintsResultSchema>;

export const RecommendationReasoningResultSchema = z.object({
  headline: z.string().min(1),
  explanation: z.string().min(1),
  pros: z.array(z.string()).default([]),
  tradeoffs: z.array(z.string()).default([]),
  constraintComplianceSummary: z.string().default("Meets constraints"),
});
export type RecommendationReasoningResult = z.infer<typeof RecommendationReasoningResultSchema>;

export interface LlmAdapter {
  readonly providerName: string;

  /**
   * General completion for unstructured LLM dialog.
   */
  complete(messages: ChatMessage[]): Promise<string>;

  /**
   * Extracts shopping intent, budget caps, and delivery speed constraints from natural language.
   */
  extractConstraints(
    userQuery: string,
    fallbackConstraints: ShoppingConstraints
  ): Promise<ExtractedConstraintsResult>;

  /**
   * Generates a clear, user-facing explanation for why a specific recommendation was selected.
   */
  generateReasoning(params: {
    userQuery: string;
    product: {
      title: string;
      brand: string;
      seller: string;
      rating: number;
      deliveryDays: number;
    };
    breakdown: {
      itemPrice: number;
      shippingCost: number;
      estimatedTax: number;
      totalCost: number;
    };
    constraints: ShoppingConstraints;
  }): Promise<RecommendationReasoningResult>;
}
