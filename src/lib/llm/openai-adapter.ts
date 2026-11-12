import { ShoppingConstraints } from "@/lib/types/agent";
import {
  ChatMessage,
  ExtractedConstraintsResult,
  ExtractedConstraintsResultSchema,
  LlmAdapter,
  RecommendationReasoningResult,
  RecommendationReasoningResultSchema,
} from "./types";

export class OpenAiLlmAdapter implements LlmAdapter {
  readonly providerName = "openai";
  private apiKey: string;
  private model: string;

  constructor(apiKey: string, model: string = "gpt-4o-mini") {
    if (!apiKey) {
      throw new Error("OpenAI API key is required when using OpenAiLlmAdapter");
    }
    this.apiKey = apiKey;
    this.model = model;
  }

  async complete(messages: ChatMessage[]): Promise<string> {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        temperature: 0.2,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`OpenAI API request failed (${res.status}): ${err}`);
    }

    const data = await res.json();
    return data.choices[0]?.message?.content || "";
  }

  async extractConstraints(
    userQuery: string,
    fallbackConstraints: ShoppingConstraints
  ): Promise<ExtractedConstraintsResult> {
    const prompt = `You are a precise e-commerce constraint extractor.
User shopping query: "${userQuery}"
Current fallback constraints: ${JSON.stringify(fallbackConstraints)}

Return a strict JSON object (and nothing else):
{
  "detectedCategory": "string",
  "extractedConstraints": {
    "maxBudget": number,
    "maxDeliveryDays": number,
    "minRating": number,
    "preferredBrand": "string or undefined",
    "optimizationPreference": "BEST_VALUE" | "LOWEST_PRICE" | "PREFERRED_BRAND"
  },
  "confidence": number between 0 and 1,
  "explanation": "concise explanation of extracted constraints"
}`;

    try {
      const content = await this.complete([
        { role: "system", content: "You extract e-commerce constraints in JSON format only." },
        { role: "user", content: prompt },
      ]);
      const jsonStart = content.indexOf("{");
      const jsonEnd = content.lastIndexOf("}");
      if (jsonStart !== -1 && jsonEnd !== -1) {
        const rawParsed = JSON.parse(content.substring(jsonStart, jsonEnd + 1));
        const validated = ExtractedConstraintsResultSchema.safeParse(rawParsed);
        if (validated.success) {
          return {
            detectedCategory: validated.data.detectedCategory || "general",
            extractedConstraints: {
              ...fallbackConstraints,
              ...validated.data.extractedConstraints,
            },
            confidence: validated.data.confidence,
            explanation: validated.data.explanation,
          };
        }
      }
    } catch (e) {
      console.warn("[OpenAiLlmAdapter] Extraction fallback triggered:", e);
    }

    return {
      extractedConstraints: fallbackConstraints,
      confidence: 0.5,
      explanation: "OpenAI parsing defaulted to user configuration.",
    };
  }

  async generateReasoning(params: {
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
  }): Promise<RecommendationReasoningResult> {
    const prompt = `Explain why the following recommendation satisfies the buyer's request:
Buyer Request: "${params.userQuery}"
Selected Product: ${JSON.stringify(params.product)}
Price Breakdown: ${JSON.stringify(params.breakdown)}
Buyer Constraints: ${JSON.stringify(params.constraints)}

Return strict JSON:
{
  "headline": "concise punchy title",
  "explanation": "2-3 sentences explaining why this fits best",
  "pros": ["bullet 1", "bullet 2", "bullet 3"],
  "tradeoffs": ["tradeoff 1", "tradeoff 2"],
  "constraintComplianceSummary": "sentence summarizing budget and delivery compliance"
}`;

    try {
      const content = await this.complete([
        { role: "system", content: "You are a fintech commerce agent. Output strict JSON only." },
        { role: "user", content: prompt },
      ]);
      const jsonStart = content.indexOf("{");
      const jsonEnd = content.lastIndexOf("}");
      if (jsonStart !== -1 && jsonEnd !== -1) {
        const rawParsed = JSON.parse(content.substring(jsonStart, jsonEnd + 1));
        const validated = RecommendationReasoningResultSchema.safeParse(rawParsed);
        if (validated.success) {
          return validated.data;
        }
      }
    } catch (e) {
      console.warn("[OpenAiLlmAdapter] Reasoning fallback triggered:", e);
    }

    return {
      headline: `Top Recommendation: ${params.product.title}`,
      explanation: `Selected as the best match for your budget of $${params.constraints.maxBudget.toFixed(
        2
      )} with delivery in ${params.product.deliveryDays} days.`,
      pros: [`Fully satisfies price constraint at $${params.breakdown.totalCost.toFixed(2)} total`],
      tradeoffs: ["Estimated regional tax will be confirmed at PayPal checkout"],
      constraintComplianceSummary: "Meets all verified user parameters.",
    };
  }
}
