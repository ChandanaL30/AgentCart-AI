import { ShoppingConstraints } from "@/lib/types/agent";
import { extractBrandFromQuery } from "@/lib/catalog/brand-registry";
import {
  ChatMessage,
  ExtractedConstraintsResult,
  LlmAdapter,
  RecommendationReasoningResult,
} from "./types";

export class MockLlmAdapter implements LlmAdapter {
  readonly providerName = "mock";

  async complete(messages: ChatMessage[]): Promise<string> {
    const lastUserMessage = [...messages].reverse().find((m) => m.role === "user")?.content || "";
    return `[Mock AI Assistant]: Processed request "${lastUserMessage}". Ready to assist with agentic shopping.`;
  }

  async extractConstraints(
    userQuery: string,
    fallbackConstraints: ShoppingConstraints
  ): Promise<ExtractedConstraintsResult> {
    const query = userQuery.toLowerCase();
    const extracted: Partial<ShoppingConstraints> = {};

    // 1. Detect budget expressions: "under $150", "below 150", "max 200", "up to $400", "within $300", "$500 max", "for $100", "$250", "200 dollars", "around $180"
    const budgetMatch =
      query.match(/(?:under|below|less than|max|up to|budget(?: of|:)?|at most|around|approx|approximately|<=?)\s*(?:[\$₹€£¥]|usd|inr|eur|gbp)?\s*(\d+(?:\.\d{1,2})?)(?!\s*days?)/i) ||
      query.match(/(?:[\$₹€£¥]|usd|inr|eur|gbp)\s*(\d+(?:\.\d{1,2})?)(?!\s*days?)/i) ||
      query.match(/(\d+(?:\.\d{1,2})?)\s*(?:max|budget|or less|dollars?|usd|rupees?|inr|euros?|pounds?)/i) ||
      query.match(/for\s*(?:[\$₹€£¥]|usd|inr|eur|gbp)?\s*(\d+(?:\.\d{1,2})?)(?!\s*days?)/i);
    if (budgetMatch && budgetMatch[1]) {
      extracted.maxBudget = parseFloat(budgetMatch[1]);
    }

    // 2. Detect currency: "$", "usd", "dollars", "₹", "inr", "rupees", "€", "eur", "£", "gbp"
    if (query.includes("₹") || query.includes("inr") || query.includes("rupee")) {
      extracted.currency = "INR";
    } else if (query.includes("€") || query.includes("eur")) {
      extracted.currency = "EUR";
    } else if (query.includes("£") || query.includes("gbp")) {
      extracted.currency = "GBP";
    } else if (query.includes("$") || query.includes("usd") || query.includes("dollars") || query.includes("dollar")) {
      extracted.currency = "USD";
    }

    // 3. Detect delivery expressions: "within 5 days", "under 3 days", "in 2 days", "2-day shipping", "next day", "fast delivery"
    const deliveryMatch =
      query.match(/(?:within|in|under|delivered in|<=?)\s*(\d+)\s*days?/i) ||
      query.match(/(\d+)[ -]day(?:\s+delivery|\s+shipping)?/i);
    if (deliveryMatch && deliveryMatch[1]) {
      extracted.maxDeliveryDays = parseInt(deliveryMatch[1], 10);
    } else if (query.includes("next day") || query.includes("overnight") || query.includes("same day")) {
      extracted.maxDeliveryDays = 1;
    } else if (query.includes("fast shipping") || query.includes("fast delivery") || query.includes("rush")) {
      extracted.maxDeliveryDays = 2;
    }

    // 4. Detect rating expressions: "4.5+ rating", "4.7 rating", "rated 4+", "at least 4 stars", "4.5 stars"
    const ratingMatch =
      query.match(/(?:rating of|rating|min rating|rated|at least)\s*(\d+(?:\.\d+)?)\s*(?:\+|stars?|★)?/i) ||
      query.match(/(\d+(?:\.\d+)?)\s*(?:\+|stars?|★)?\s*rating/i) ||
      query.match(/(\d+(?:\.\d+)?)\s*\+\s*(?:rating|stars?|★)?/i) ||
      query.match(/(\d+(?:\.\d+)?)\s*(?:stars?|★)/i);
    if (ratingMatch && ratingMatch[1]) {
      const parsedRating = parseFloat(ratingMatch[1]);
      if (parsedRating >= 1.0 && parsedRating <= 5.0) {
        extracted.minRating = parsedRating;
      }
    }

    // 5. Detect brand mentions dynamically across 150+ brands (Nykaa, Purplle, Amazon, Flipkart, Myntra, Ajio)
    const detectedBrand = extractBrandFromQuery(userQuery);
    if (detectedBrand) {
      extracted.preferredBrand = detectedBrand;
    }

    // 6. Detect optimization preference: LOWEST_PRICE, PREFERRED_BRAND, BEST_VALUE
    if (
      query.includes("cheapest") ||
      query.includes("lowest price") ||
      query.includes("cheap") ||
      query.includes("least expensive") ||
      query.includes("budget-friendly") ||
      query.includes("best price")
    ) {
      extracted.optimizationPreference = "LOWEST_PRICE";
    } else if (
      extracted.preferredBrand ||
      query.includes("brand") ||
      query.includes("only") ||
      query.includes("prefer")
    ) {
      extracted.optimizationPreference = "PREFERRED_BRAND";
    } else if (
      query.includes("best value") ||
      query.includes("value for money") ||
      query.includes("top rated") ||
      query.includes("best rated") ||
      query.includes("highest rating") ||
      query.includes("best overall")
    ) {
      extracted.optimizationPreference = "BEST_VALUE";
    }

    // 7. Detect category keywords mapped to canonical catalog categories (or undefined if multi-category / general)
    let detectedCategory: string | undefined = undefined;
    if (
      !query.includes("speaker") &&
      !query.includes("webcam") &&
      !query.includes("camera") &&
      (
        query.includes("headphone") ||
        query.includes("earbud") ||
        query.includes("earphone") ||
        query.includes("audio") ||
        query.includes("soundcore") ||
        query.includes("headset") ||
        query.includes("airpods") ||
        query.includes("noise cancel") ||
        query.includes("noise-cancel") ||
        query.includes("anc") ||
        query.includes("wh1000") ||
        query.includes("wh-1000") ||
        query.includes("qc45") ||
        query.includes("hd560") ||
        query.includes("tune510") ||
        query.includes("bose") ||
        query.includes("sennheiser") ||
        query.includes("jbl")
      )
    ) {
      detectedCategory = "headphones";
    } else if (
      query.includes("keyboard") ||
      query.includes("mechanical") ||
      query.includes("keychron") ||
      query.includes("huntsman") ||
      query.includes("mx keys") ||
      query.includes("switches") ||
      query.includes("keycaps") ||
      query.includes("typing") ||
      query.includes("razer")
    ) {
      detectedCategory = "keyboards";
    } else if (
      query.includes("sunscreen") ||
      query.includes("sunblock") ||
      query.includes("spf") ||
      query.includes("tinted") ||
      query.includes("skincare") ||
      query.includes("cleanser") ||
      query.includes("face wash") ||
      query.includes("facewash") ||
      query.includes("wash") ||
      query.includes("soap") ||
      query.includes("moisturizer") ||
      query.includes("moisturiser") ||
      query.includes("cerave") ||
      query.includes("cetaphil") ||
      query.includes("skin") ||
      query.includes("serum") ||
      query.includes("lotion") ||
      query.includes("cream") ||
      query.includes("balm") ||
      query.includes("beauty") ||
      query.includes("cosmetic")
    ) {
      // Skincare checked BEFORE electronics so "sunscreen" is never matched by "screen"
      detectedCategory = "skincare";
    } else if (
      query.includes("mouse") ||
      query.includes("mice") ||
      query.includes("mx master") ||
      query.includes("trackpad") ||
      query.includes("hub") ||
      query.includes("dock") ||
      query.includes("caldigit") ||
      query.includes("adapter") ||
      query.includes("accessory") ||
      query.includes("accessories")
    ) {
      detectedCategory = "accessories";
    } else if (
      query.includes("chair") ||
      (query.includes("desk") && !query.includes("desktop")) ||
      query.includes("standing desk") ||
      query.includes("ergonomic") ||
      query.includes("steelcase") ||
      query.includes("autonomous") ||
      query.includes("office") ||
      query.includes("seating") ||
      query.includes("ergochair") ||
      query.includes("ergodesk")
    ) {
      detectedCategory = "home-office";
    } else if (
      query.includes("monitor") ||
      query.includes("laptop") ||
      query.includes("display") ||
      query.includes("ssd") ||
      query.includes("storage") ||
      query.includes("solid state") ||
      query.includes("nvme") ||
      query.includes("camera") ||
      query.includes("speaker") ||
      query.includes("soundbar") ||
      query.includes("webcam") ||
      query.includes("console") ||
      query.includes("playstation") ||
      (/\b(screen|screens)\b/i.test(query) && !query.includes("sunscreen") && !query.includes("sunblock")) ||
      query.includes("4k") ||
      query.includes("ultrasharp") ||
      query.includes("power bank") ||
      query.includes("powerbank") ||
      query.includes("powercore")
    ) {
      detectedCategory = "electronics";
    } else if (
      query.includes("bottle") ||
      query.includes("flask") ||
      query.includes("tumbler") ||
      query.includes("drinkware") ||
      query.includes("thermo") ||
      query.includes("hydroflask") ||
      query.includes("owala") ||
      query.includes("cooker") ||
      query.includes("pot") ||
      query.includes("fryer") ||
      query.includes("instant pot") ||
      query.includes("shoes") ||
      query.includes("sneakers") ||
      query.includes("running")
    ) {
      detectedCategory = "lifestyle";
    }

    return {
      detectedCategory: detectedCategory ?? "all",
      extractedConstraints: {
        ...fallbackConstraints,
        ...extracted,
      },
      confidence: 0.95,
      explanation: `Parsed query intent${detectedCategory ? ` for ${detectedCategory}` : " across catalog"}. Extracted ${
        extracted.maxBudget ? `max budget $${extracted.maxBudget}` : "default budget"
      }${
        extracted.maxDeliveryDays
          ? `, max delivery ${extracted.maxDeliveryDays} days`
          : ""
      }${extracted.minRating ? `, min rating ${extracted.minRating}★` : ""}${
        extracted.preferredBrand ? `, preferred brand "${extracted.preferredBrand}"` : ""
      }${
        extracted.optimizationPreference ? `, optimization preference "${extracted.optimizationPreference}"` : ""
      }.`,
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
    const { product, breakdown, constraints } = params;
    const savings = constraints.maxBudget - breakdown.totalCost;

    return {
      headline: `Top Pick: ${product.title} from ${product.seller}`,
      explanation: `AgentCart evaluated available options against your criteria. This item delivers in ${product.deliveryDays} business day(s) with an all-inclusive estimated total of $${breakdown.totalCost.toFixed(
        2
      )} (item $${breakdown.itemPrice.toFixed(2)} + shipping $${breakdown.shippingCost.toFixed(
        2
      )} + tax $${breakdown.estimatedTax.toFixed(2)}).`,
      pros: [
        `Verified total cost is $${savings.toFixed(2)} under your $${constraints.maxBudget.toFixed(2)} cap`,
        `High user trust score of ${product.rating}★ rating`,
        product.deliveryDays <= constraints.maxDeliveryDays
          ? `Meets speed requirement: ${product.deliveryDays} days (allowed up to ${constraints.maxDeliveryDays})`
          : `Fast dispatch via ${product.seller}`,
      ],
      tradeoffs: [
        `Tax calculation is estimated at standard regional rates and will be finalized at PayPal checkout`,
        `Includes standard manufacturer warranty`,
      ],
      constraintComplianceSummary: `100% compliant with budget ($${breakdown.totalCost.toFixed(2)} <= $${constraints.maxBudget.toFixed(2)}) and delivery timing (${product.deliveryDays} <= ${constraints.maxDeliveryDays} days).`,
    };
  }
}
