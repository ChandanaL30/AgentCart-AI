import { CatalogProduct } from "../types";
import { extractBrandFromQuery } from "../brand-registry";

const STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "in", "on", "at", "to", "for", "with",
  "by", "of", "from", "as", "is", "are", "was", "were", "be", "been",
  "find", "looking", "look", "need", "want", "get", "show", "search", "give", "please",
  "under", "below", "above", "over", "around", "less", "more", "than",
  "rating", "rated", "stars", "star", "fast", "shipping", "delivery", "days", "day",
  "budget", "price", "dollars", "dollar", "usd", "cents", "max", "min", "up",
  "best", "top", "good", "great", "any", "me"
]);

const UNIT_PATTERNS = new Set([
  "1tb", "2tb", "4tb", "500gb", "256gb", "128gb",
  "1l", "2l", "32oz", "24oz", "16oz",
  "4k", "8k", "1080p", "1440p", "60hz", "120hz", "144hz", "165hz", "240hz",
  "6qt", "8qt", "10in1", "8in1", "140w", "100w", "65w", "30w",
  "8fl", "120ml", "200ml", "250ml", "50ml", "100ml"
]);

interface NounRule {
  allowed: RegExp;
  prohibited?: RegExp;
}

// Comprehensive noun category mapping to prevent cross-category hallucinations
const NOUN_RULES: Record<string, NounRule> = {
  ssd: { allowed: /\b(ssds?|solid\s+state|nvme|drives?|storage)\b/i, prohibited: /\b(headphones?|keyboards?|chairs?)\b/i },
  storage: { allowed: /\b(storage|ssds?|hard\s+drives?|drives?|flash)\b/i, prohibited: /\b(headphones?|keyboards?|chairs?)\b/i },
  keyboard: { allowed: /\b(keyboards?|keycaps?|switches|keebs?)\b/i, prohibited: /\b(mouse|mice|trackpads?|headphones?|chairs?)\b/i },
  keyboards: { allowed: /\b(keyboards?|keycaps?|switches|keebs?)\b/i, prohibited: /\b(mouse|mice|trackpads?|headphones?|chairs?)\b/i },
  mouse: { allowed: /\b(mouse|trackpads?|mice)\b/i, prohibited: /\b(keyboards?|headphones?|chairs?|docks?)\b/i },
  mice: { allowed: /\b(mouse|trackpads?|mice)\b/i, prohibited: /\b(keyboards?|headphones?|chairs?|docks?)\b/i },
  chair: { allowed: /\b(chairs?|seatings?|ergonomic\s+tasks?|stools?)\b/i, prohibited: /\b(desks?|keyboards?|mice|headphones?)\b/i },
  chairs: { allowed: /\b(chairs?|seatings?|ergonomic\s+tasks?|stools?)\b/i, prohibited: /\b(desks?|keyboards?|mice|headphones?)\b/i },
  desk: { allowed: /\b(desks?|workstations?|standing\s+desks?)\b/i, prohibited: /\b(chairs?|seatings?|headphones?)\b/i },
  desks: { allowed: /\b(desks?|workstations?|standing\s+desks?)\b/i, prohibited: /\b(chairs?|seatings?|headphones?)\b/i },
  headphone: { allowed: /\b(headphones?|earbuds?|earphones?|headsets?|audio)\b/i, prohibited: /\b(speakers?|soundbars?|keyboards?|mice|monitors?|chairs?)\b/i },
  headphones: { allowed: /\b(headphones?|earbuds?|earphones?|headsets?|audio)\b/i, prohibited: /\b(speakers?|soundbars?|keyboards?|mice|monitors?|chairs?)\b/i },
  earbuds: { allowed: /\b(earbuds?|headphones?|earphones?)\b/i, prohibited: /\b(speakers?|soundbars?|keyboards?|mice|monitors?)\b/i },
  earphone: { allowed: /\b(earphones?|earbuds?|headphones?)\b/i, prohibited: /\b(speakers?|soundbars?|keyboards?|mice|monitors?)\b/i },
  earphones: { allowed: /\b(earphones?|earbuds?|headphones?)\b/i, prohibited: /\b(speakers?|soundbars?|keyboards?|mice|monitors?)\b/i },
  speaker: { allowed: /\b(speakers?|soundbars?|smart\s*speakers?|audio\s*system)\b/i, prohibited: /\b(headphones?|earbuds?|earphones?|headsets?)\b/i },
  speakers: { allowed: /\b(speakers?|soundbars?|smart\s*speakers?|audio\s*system)\b/i, prohibited: /\b(headphones?|earbuds?|earphones?|headsets?)\b/i },
  monitor: { allowed: /\b(monitors?|displays?|screens?)\b/i, prohibited: /\b(laptops?|smartphones?|tvs?|televisions?)\b/i },
  monitors: { allowed: /\b(monitors?|displays?|screens?)\b/i, prohibited: /\b(laptops?|smartphones?|tvs?|televisions?)\b/i },
  laptop: { allowed: /\b(laptops?|notebooks?|macbooks?|chromebooks?)\b/i, prohibited: /\b(hub\s*monitors?|pc\s*monitors?|computer\s*monitors?)\b/i },
  laptops: { allowed: /\b(laptops?|notebooks?|macbooks?|chromebooks?)\b/i, prohibited: /\b(hub\s*monitors?|pc\s*monitors?|computer\s*monitors?)\b/i },
  camera: { allowed: /\b(cameras?|camcorders?|dslrs?|mirrorless|lens|lenses)\b/i, prohibited: /\b(headphones?|keyboards?|mice|chairs?)\b/i },
  cameras: { allowed: /\b(cameras?|camcorders?|dslrs?|mirrorless|lens|lenses)\b/i, prohibited: /\b(headphones?|keyboards?|mice|chairs?)\b/i },
  webcam: { allowed: /\b(webcams?|video\s*cams?|streaming\s*cams?)\b/i, prohibited: /\b(keyboards?|mouse|mice|headphones?)\b/i },
  webcams: { allowed: /\b(webcams?|video\s*cams?|streaming\s*cams?)\b/i, prohibited: /\b(keyboards?|mouse|mice|headphones?)\b/i },
  console: { allowed: /\b(consoles?|playstations?|ps5|ps4|xbox|nintendo|game\s*systems?)\b/i, prohibited: /\b(headphones?|keyboards?|monitors?|chairs?)\b/i },
  consoles: { allowed: /\b(consoles?|playstations?|ps5|ps4|xbox|nintendo|game\s*systems?)\b/i, prohibited: /\b(headphones?|keyboards?|monitors?|chairs?)\b/i },
  playstation: { allowed: /\b(playstations?|ps5|ps4|sony\s*playstation)\b/i, prohibited: /\b(headphones?|keyboards?|monitors?|cameras?)\b/i },
  tv: { allowed: /\b(tvs?|televisions?|smart\s*tvs?|oled\s*tv|bravia)\b/i, prohibited: /\b(hub\s*monitors?|pc\s*monitors?|computer\s*monitors?)\b/i },
  television: { allowed: /\b(tvs?|televisions?|smart\s*tvs?|oled\s*tv)\b/i, prohibited: /\b(hub\s*monitors?|pc\s*monitors?|computer\s*monitors?)\b/i },
  cooker: { allowed: /\b(cookers?|pots?|instant\s*pots?|fryers?|ovens?)\b/i, prohibited: /\b(headphones?|keyboards?|monitors?|chairs?)\b/i },
  cookers: { allowed: /\b(cookers?|pots?|instant\s*pots?|fryers?|ovens?)\b/i, prohibited: /\b(headphones?|keyboards?|monitors?|chairs?)\b/i },
  sunscreen: { allowed: /\b(sunscreens?|sunblocks?|spf|uv)\b/i, prohibited: /\b(monitors?|displays?|screens?)\b/i },
  cleanser: { allowed: /\b(cleansers?|wash(?:es)?|facewash(?:es)?|face\s+wash(?:es)?|soaps?)\b/i, prohibited: /\b(headphones?|electronics?)\b/i },
  bottle: { allowed: /\b(bottles?|flasks?|tumblers?|mugs?|drinkware)\b/i, prohibited: /\b(headphones?|electronics?|skincare)\b/i },
  shoes: { allowed: /\b(shoes?|sneakers?|boots?|footwear)\b/i, prohibited: /\b(headphones?|electronics?|skincare|bottles?)\b/i },
  shoe: { allowed: /\b(shoes?|sneakers?|boots?|footwear)\b/i, prohibited: /\b(headphones?|electronics?|skincare|bottles?)\b/i },
};

/**
 * Computes a grounded relevance score [0.0 - 1.0] between a user's search query and a product.
 * Returns 0 if:
 * 1. A critical product noun conflict is detected (e.g. an SSD or webcam query matching headphones).
 * 2. An explicit alphanumeric model conflict is detected (e.g. searching "XM4" when item is "XM5").
 * 3. The query contains substantive non-brand terms, but the product only matches the brand name.
 * 4. Overall score falls below strict 0.35 threshold.
 */
export function calculateProductRelevance(query: string, product: CatalogProduct): number {
  if (!query || query.trim().length === 0) return 1.0;

  const qClean = query.toLowerCase().replace(/[$€£₹★+]/g, " ").replace(/[^\w\s-]/g, " ");
  const queryTerms = qClean
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t) && !/^\d+(\.\d+)?$/.test(t));

  if (queryTerms.length === 0) return 1.0;

  const searchableProductText = [
    product.title,
    product.brand,
    product.model || "",
    product.externalId || "",
    product.description || "",
    product.category,
    ...Object.values(product.attributes || {}).map(String),
    ...Object.values(product.specs || {}).map(String),
  ]
    .join(" ")
    .toLowerCase();

  // 1. Strict Category / Noun Conflict Check
  for (const [noun, rule] of Object.entries(NOUN_RULES)) {
    if (queryTerms.includes(noun)) {
      if (!rule.allowed.test(searchableProductText)) {
        return 0; // Missing required noun pattern
      }
      if (rule.prohibited && rule.prohibited.test(searchableProductText) && !rule.allowed.test(product.title.toLowerCase())) {
        return 0; // Cross-category conflict
      }
    }
  }

  // 2. Critical Modifier Checks (e.g. "mechanical" keyboards, "4k" / "ips" displays)
  if (queryTerms.includes("mechanical")) {
    const isMechanical =
      /\bmechanical\b/i.test(searchableProductText) ||
      /\bgasket\b/i.test(searchableProductText) ||
      /\bswitches\b/i.test(searchableProductText);
    if (!isMechanical) {
      return 0;
    }
  }

  if (queryTerms.includes("4k")) {
    const is4K =
      /\b4k\b/i.test(searchableProductText) ||
      /\b3840\b/i.test(searchableProductText) ||
      /\buhd\b/i.test(searchableProductText);
    if (!is4K) {
      return 0;
    }
  }

  if (queryTerms.includes("ips")) {
    const isIps = /\bips\b/i.test(searchableProductText);
    if (!isIps) {
      return 0;
    }
  }

  // 3. Exact Model Conflict Check
  // Identifies alphanumeric model codes in query (e.g. xm4, xm5, rt100, q30, qc45, c300, 27up850, u2723qe, a6400)
  const queryModelTokens = queryTerms.filter((t) =>
    /[a-z]+-?\d+|\d+-?[a-z]+/i.test(t) && !UNIT_PATTERNS.has(t)
  );

  for (const modelToken of queryModelTokens) {
    const escaped = modelToken.replace(/[-]/g, "");
    const cleanSearchable = searchableProductText.replace(/[-]/g, "");
    if (!cleanSearchable.includes(escaped)) {
      // Model token requested by user is NOT in this product
      return 0;
    }
  }

  // 3. Substantive Non-Brand Term Grounding
  // If query specifies a brand + substantive words, at least one substantive word MUST match
  const detectedBrand = extractBrandFromQuery(query)?.toLowerCase();
  const substantiveTerms = queryTerms.filter((t) =>
    t !== detectedBrand &&
    !UNIT_PATTERNS.has(t) &&
    !["pro", "plus", "max", "mini", "ultra", "wireless", "wired", "bluetooth", "new", "black", "white", "silver"].includes(t)
  );

  if (substantiveTerms.length > 0) {
    const substantiveMatches = substantiveTerms.filter((term) => {
      const baseTerm = term.endsWith("s") && term.length > 3 ? term.slice(0, -1) : term;
      const escaped = baseTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(`\\b${escaped}(?:s|es)?\\b`, "i").test(searchableProductText);
    });

    if (substantiveMatches.length === 0) {
      // User searched for a specific product type/model, but product only matches brand or generic adjective
      return 0;
    }
  }

  // 4. Term match counting
  let matches = 0;
  for (const term of queryTerms) {
    const baseTerm = term.endsWith("s") && term.length > 3 ? term.slice(0, -1) : term;
    const escaped = baseTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const termRegex = new RegExp(`\\b${escaped}(?:s|es)?\\b`, "i");
    if (termRegex.test(searchableProductText)) {
      matches++;
    }
  }

  // Title match carries heavier weight
  const titleLower = product.title.toLowerCase();
  let titleMatches = 0;
  for (const term of queryTerms) {
    if (titleLower.includes(term)) {
      titleMatches++;
    }
  }

  const termRatio = matches / queryTerms.length;
  const titleRatio = titleMatches / queryTerms.length;

  const score = Math.min(1.0, termRatio * 0.6 + titleRatio * 0.4);
  return score >= 0.35 ? score : 0;
}
