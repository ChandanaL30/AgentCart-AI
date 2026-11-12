/**
 * Safe URL validation for external merchant and product listings.
 * Strictly enforces allowed protocols (http: and https:) and blocks
 * unsafe protocols (javascript:, data:, vbscript:, file:, etc.)
 * to prevent XSS and open redirect vulnerabilities.
 */

export interface ValidatedProductUrl {
  isValid: boolean;
  safeUrl: string | null;
  isDemoOnly: boolean;
  reason?: string;
}

const ALLOWED_PROTOCOLS = new Set(["https:", "http:"]);

/**
 * Validates whether a product URL is safe to open in a new tab.
 * Returns a typed validation result with safe sanitized URL.
 */
export function validateProductUrl(rawUrl: unknown): ValidatedProductUrl {
  if (!rawUrl || typeof rawUrl !== "string" || rawUrl.trim().length === 0) {
    return {
      isValid: false,
      safeUrl: null,
      isDemoOnly: true,
      reason: "No external listing URL provided for this product.",
    };
  }

  const trimmed = rawUrl.trim();

  // Reject explicit dangerous patterns before URL parsing
  if (
    /^(javascript|data|vbscript|file|blob):/i.test(trimmed) ||
    trimmed.startsWith("//") ||
    trimmed.includes("<") ||
    trimmed.includes(">")
  ) {
    return {
      isValid: false,
      safeUrl: null,
      isDemoOnly: false,
      reason: "Unsafe or prohibited URL protocol rejected for buyer security.",
    };
  }

  try {
    const parsed = new URL(trimmed);

    if (!ALLOWED_PROTOCOLS.has(parsed.protocol.toLowerCase())) {
      return {
        isValid: false,
        safeUrl: null,
        isDemoOnly: false,
        reason: `Disallowed URL protocol: ${parsed.protocol}. Only HTTPS/HTTP are permitted.`,
      };
    }

    // Must have a valid hostname
    if (!parsed.hostname || parsed.hostname.length < 3) {
      return {
        isValid: false,
        safeUrl: null,
        isDemoOnly: false,
        reason: "Invalid hostname in external listing URL.",
      };
    }

    return {
      isValid: true,
      safeUrl: parsed.href,
      isDemoOnly: false,
    };
  } catch {
    return {
      isValid: false,
      safeUrl: null,
      isDemoOnly: false,
      reason: "Malformed URL syntax.",
    };
  }
}

/**
 * Derives user-facing store name and brand (e.g. Nykaa, Purplle, Flipkart, Amazon, Myntra, Ajio) from product metadata.
 */
export function getStoreInfo(product: {
  marketplace?: string;
  productUrl?: string;
  seller?: string;
  sellerName?: string;
}): { storeName: string; brandName: string } {
  const mkt = (product.marketplace || "").toLowerCase();
  const url = (product.productUrl || "").toLowerCase();
  const seller = (product.seller || product.sellerName || "").toLowerCase();

  if (mkt.includes("nykaa") || url.includes("nykaa") || seller.includes("nykaa")) {
    return {
      storeName: product.marketplace?.includes("Nykaa") ? product.marketplace : "Nykaa.com",
      brandName: "Nykaa",
    };
  }
  if (mkt.includes("purplle") || url.includes("purplle") || mkt.includes("purple") || url.includes("purple") || seller.includes("purplle")) {
    return {
      storeName: product.marketplace?.includes("Purplle") ? product.marketplace : "Purplle.com",
      brandName: "Purplle",
    };
  }
  if (mkt.includes("myntra") || url.includes("myntra") || seller.includes("myntra")) {
    return {
      storeName: product.marketplace?.includes("Myntra") ? product.marketplace : "Myntra.com",
      brandName: "Myntra",
    };
  }
  if (mkt.includes("ajio") || url.includes("ajio") || seller.includes("ajio")) {
    return {
      storeName: product.marketplace?.includes("Ajio") ? product.marketplace : "Ajio.com",
      brandName: "Ajio",
    };
  }
  if (mkt.includes("flipkart") || url.includes("flipkart") || seller.includes("flipkart")) {
    return {
      storeName: product.marketplace?.includes("Flipkart") ? product.marketplace : "Flipkart.com",
      brandName: "Flipkart",
    };
  }
  if (mkt.includes("amazon") || url.includes("amazon") || seller.includes("amazon")) {
    return {
      storeName: product.marketplace?.includes("Amazon") ? product.marketplace : "Amazon.com",
      brandName: "Amazon",
    };
  }
  if (product.marketplace && product.marketplace.trim().length > 0) {
    return {
      storeName: product.marketplace,
      brandName: product.marketplace.split(/[ .]/)[0] || "Store",
    };
  }
  return {
    storeName: "Amazon.com (Verified Seller)",
    brandName: "Amazon",
  };
}

/**
 * Resolves a guaranteed safe, clickable external destination URL on
 * Nykaa, Purplle, Flipkart, Amazon, Myntra, or Ajio.
 * If the product has a valid specific listing URL, it is validated and returned.
 * Otherwise, it automatically constructs a live search URL on that marketplace.
 */
export function getResolvedExternalUrl(product: {
  productUrl?: string;
  title: string;
  marketplace?: string;
  seller?: string;
  sellerName?: string;
}): string {
  if (product.productUrl) {
    const validated = validateProductUrl(product.productUrl);
    if (validated.isValid && validated.safeUrl) {
      return validated.safeUrl;
    }
  }

  const { brandName } = getStoreInfo(product);
  const encodedTitle = encodeURIComponent(product.title.trim());

  if (brandName.toLowerCase().includes("nykaa")) {
    return `https://www.nykaa.com/search/result/?q=${encodedTitle}`;
  }
  if (brandName.toLowerCase().includes("purplle") || brandName.toLowerCase().includes("purple")) {
    return `https://www.purplle.com/search?q=${encodedTitle}`;
  }
  if (brandName.toLowerCase().includes("myntra")) {
    return `https://www.myntra.com/${encodedTitle.replace(/%20/g, "-")}`;
  }
  if (brandName.toLowerCase().includes("ajio")) {
    return `https://www.ajio.com/search/?text=${encodedTitle}`;
  }
  if (brandName.toLowerCase().includes("flipkart")) {
    return `https://www.flipkart.com/search?q=${encodedTitle}`;
  }
  return `https://www.amazon.in/s?k=${encodedTitle}`;
}
