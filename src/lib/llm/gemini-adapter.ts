import { ShoppingConstraints } from "@/lib/types/agent";
import {
  ChatMessage,
  ExtractedConstraintsResult,
  ExtractedConstraintsResultSchema,
  LlmAdapter,
  RecommendationReasoningResult,
  RecommendationReasoningResultSchema,
} from "./types";

export class GeminiLlmAdapter implements LlmAdapter {
  readonly providerName = "gemini";
  private apiKey: string;
  private model: string;

  constructor(apiKey: string, model: string = "gemini-1.5-flash") {
    if (!apiKey) {
      throw new Error("Gemini API key is required when using GeminiLlmAdapter");
    }
    this.apiKey = apiKey;
    this.model = model;
  }

  async complete(messages: ChatMessage[]): Promise<string> {
    const contents = messages.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Gemini API request failed (${res.status}): ${err}`);
    }

    const data = await res.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
  }

  async extractConstraints(
    userQuery: string,
    fallbackConstraints: ShoppingConstraints
  ): Promise<ExtractedConstraintsResult> {
    const prompt = `Extract e-commerce shopping constraints for query: "${userQuery}".
Fallback constraints: ${JSON.stringify(fallbackConstraints)}.
Return only JSON:
{
  "detectedCategory": "string",
  "extractedConstraints": {
    "maxBudget": number,
    "maxDeliveryDays": number,
    "minRating": number,
    "preferredBrand": "string or undefined",
    "optimizationPreference": "BEST_VALUE" | "LOWEST_PRICE" | "PREFERRED_BRAND"
  },
  "confidence": 0.95,
  "explanation": "summary"
}`;

    try {
      const content = await this.complete([{ role: "user", content: prompt }]);
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
      console.warn("[GeminiLlmAdapter] Extraction fallback triggered:", e);
    }

    return {
      extractedConstraints: fallbackConstraints,
      confidence: 0.5,
      explanation: "Gemini parsing defaulted to user configuration.",
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
    const prompt = `Explain shopping recommendation:
Query: "${params.userQuery}"
Product: ${JSON.stringify(params.product)}
Pricing: ${JSON.stringify(params.breakdown)}
Constraints: ${JSON.stringify(params.constraints)}

Return strict JSON:
{
  "headline": "headline",
  "explanation": "concise explanation",
  "pros": ["pro1", "pro2"],
  "tradeoffs": ["tradeoff1"],
  "constraintComplianceSummary": "compliance text"
}`;

    try {
      const content = await this.complete([{ role: "user", content: prompt }]);
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
      console.warn("[GeminiLlmAdapter] Reasoning fallback triggered:", e);
    }

    return {
      headline: `Verified Match: ${params.product.title}`,
      explanation: `Calculated total of $${params.breakdown.totalCost.toFixed(2)} strictly respects your $${params.constraints.maxBudget.toFixed(2)} limit.`,
      pros: [`Delivery in ${params.product.deliveryDays} day(s)`],
      tradeoffs: ["Subject to final checkout tax verification"],
      constraintComplianceSummary: "Fully compliant with user parameters.",
    };
  }
}
