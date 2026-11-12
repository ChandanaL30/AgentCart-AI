"use client";

import React, { useEffect, useState } from "react";
import { PayPalButtons, PayPalScriptProvider } from "@paypal/react-paypal-js";
import {
  AgentActivityEvent,
  OptimizationPreference,
  PurchaseProposalDto,
  ShoppingConstraints,
} from "@/lib/types/agent";
import { CheckoutReceipt } from "@/lib/types/checkout";
import {
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  Bot,
  Building2,
  CheckCircle2,
  Clock,
  CreditCard,
  ExternalLink,
  Eye,
  History,
  Layers,
  Receipt,
  RotateCcw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Sliders,
  Sparkles,
  Star,
  Store,
  Terminal,
  Truck,
  X,
  Zap,
} from "lucide-react";
import { ProductThumbnail } from "@/app/components/ProductThumbnail";
import {
  ProductDetailsModal,
  DetailedProductItem,
} from "@/app/components/ProductDetailsModal";
import {
  getResolvedExternalUrl,
  getStoreInfo,
} from "@/lib/catalog/url-validator";

const DEFAULT_CONSTRAINTS: ShoppingConstraints = {
  maxBudget: 200,
  maxDeliveryDays: 5,
  minRating: 4.5,
  preferredBrand: "",
  optimizationPreference: "BEST_VALUE",
};

const QUICK_PROMPTS = [
  {
    text: "Find wireless headphones under $150",
    badge: "Judge Demo ($150 vs $12 Shipping)",
    budget: 150,
    days: 3,
    rating: 4.5,
    note: "Tests hard budget: rejects $145 candidate + $12 shipping ($157+ landed); stages $86.59 compliant alternative",
  },
  {
    text: "Find a mechanical keyboard under $220",
    badge: "Hardware Specs",
    budget: 220,
    days: 4,
    rating: 4.7,
    note: "Keychron Q1 Pro gasket-mount mechanical keyboard ($215.42 landed)",
  },
  {
    text: "4K IPS Monitor under $450",
    badge: "Value Tech",
    budget: 450,
    days: 4,
    rating: 4.6,
    note: "LG 27UP850N-W 4K USB-C Display ($411.34 landed)",
  },
  {
    text: "Ergonomic chair with 4.5+ rating",
    badge: "Home Office",
    budget: 550,
    days: 5,
    rating: 4.6,
    note: "Steelcase Series 1 Ergonomic Task Chair ($518.52 landed)",
  },
];

interface DisqualifiedCandidateView {
  product: {
    id: string;
    title: string;
    brand: string;
    model?: string;
    category?: string;
    sellerName?: string;
    seller?: string;
    imageUrl?: string;
    productUrl?: string;
    marketplace?: string;
    deliveryDays: number;
    rating: number;
    reviewCount?: number;
    priceCents?: number;
    shippingFeeCents?: number;
    specs?: Record<string, string | number | boolean>;
    attributes?: Record<string, unknown>;
  };
  pricing: {
    itemPrice: number;
    shippingCost: number;
    estimatedTax: number;
    totalCost: number;
    totalCostCents?: number;
  };
  failedReasonCodes: string[];
  reasons: string[];
}

interface AlternativeProduct {
  product: {
    id: string;
    title: string;
    brand: string;
    model?: string;
    category?: string;
    imageUrl?: string;
    productUrl?: string;
    marketplace?: string;
    seller: string;
    sellerName?: string;
    deliveryDays: number;
    rating: number;
    reviewCount: number;
    specs?: Record<string, string | number | boolean>;
    attributes?: Record<string, unknown>;
  };
  breakdown: {
    itemPrice: number;
    shippingCost: number;
    estimatedTax: number;
    totalCost: number;
  };
  constraintEvaluation: {
    passed: boolean;
  };
  notes: string[];
}

interface NoEligibleOutcome {
  violationBreakdown: Record<string, number>;
  suggestedAdjustments: string[];
  explanation: string;
  noExactMatch?: boolean;
  suggestedCategory?: string;
  closestAlternative: {
    product: {
      id: string;
      title: string;
      brand: string;
      model?: string;
      category?: string;
      sellerName?: string;
      seller?: string;
      imageUrl?: string;
      productUrl?: string;
      deliveryDays: number;
      rating: number;
      reviewCount: number;
    };
    pricing?: {
      itemPrice: number;
      shippingCost: number;
      estimatedTax: number;
      totalCost: number;
    };
    breakdown?: {
      itemPrice: number;
      shippingCost: number;
      estimatedTax: number;
      totalCost: number;
    };
    reasons?: string[];
  } | null;
}

interface CatalogItemDto {
  id: string;
  title: string;
  description: string;
  category: string;
  brand: string;
  model?: string;
  externalId?: string;
  imageUrl: string;
  productUrl?: string;
  sellerName: string;
  marketplace?: string;
  priceCents: number;
  shippingFeeCents: number;
  deliveryDays: number;
  rating: number;
  reviewCount: number;
  inStock: boolean;
  stockQuantity: number;
  shipsFrom?: string;
  warranty?: string;
  returnPolicy?: string;
  compatibility?: string;
  specs?: Record<string, string | number | boolean>;
  attributes?: Record<string, unknown>;
  isMockData?: boolean;
  landedPricing?: {
    itemPrice: number;
    shippingCost: number;
    estimatedTax: number;
    totalCost: number;
  };
}

// Stable external store for periodic expiry checking
let currentTimeSnapshot = typeof window !== "undefined" ? Date.now() : 0;
const timeListeners = new Set<() => void>();
let timeIntervalId: ReturnType<typeof setInterval> | null = null;

function subscribeToTime(listener: () => void) {
  timeListeners.add(listener);
  if (timeIntervalId === null && typeof window !== "undefined") {
    timeIntervalId = setInterval(() => {
      currentTimeSnapshot = Date.now();
      timeListeners.forEach((l) => l());
    }, 10000);
  }
  return () => {
    timeListeners.delete(listener);
    if (timeListeners.size === 0 && timeIntervalId !== null) {
      clearInterval(timeIntervalId);
      timeIntervalId = null;
    }
  };
}

function getTimeSnapshot(): number {
  return currentTimeSnapshot;
}

function getServerTimeSnapshot(): number {
  return 0;
}

function useCurrentTime(): number {
  return React.useSyncExternalStore(
    subscribeToTime,
    getTimeSnapshot,
    getServerTimeSnapshot
  );
}

export default function AgentCartApp() {
  const currentTime = useCurrentTime();
  const [query, setQuery] = useState("");
  const [constraints, setConstraints] = useState<ShoppingConstraints>(DEFAULT_CONSTRAINTS);
  const [isRunning, setIsRunning] = useState(false);
  const [events, setEvents] = useState<AgentActivityEvent[]>([]);
  const [proposal, setProposal] = useState<PurchaseProposalDto | null>(null);
  const [reasoning, setReasoning] = useState<{
    headline: string;
    explanation: string;
    pros: string[];
    tradeoffs: string[];
    constraintComplianceSummary: string;
  } | null>(null);
  const [alternatives, setAlternatives] = useState<AlternativeProduct[]>([]);
  const [disqualifiedCandidates, setDisqualifiedCandidates] = useState<DisqualifiedCandidateView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [noEligibleOutcome, setNoEligibleOutcome] = useState<NoEligibleOutcome | null>(null);
  const [verificationStatus, setVerificationStatus] = useState<string | null>(null);
  const [verificationError, setVerificationError] = useState<string | null>(null);
  const [guestSessionId, setGuestSessionId] = useState<string>("session_initializing...");
  const [llmProviderName, setLlmProviderName] = useState<string>("mock");
  const [isMockMode, setIsMockMode] = useState<boolean>(true);
  const [isStreaming, setIsStreaming] = useState<boolean>(false);

  // PayPal Checkout State
  const [receipt, setReceipt] = useState<CheckoutReceipt | null>(null);
  const [checkoutSessionId, setCheckoutSessionId] = useState<string | null>(null);
  const [isCapturing, setIsCapturing] = useState<boolean>(false);
  const [isCreatingOrder, setIsCreatingOrder] = useState<boolean>(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  const isProposalExpired = Boolean(
    proposal?.expiresAt &&
      currentTime > 0 &&
      new Date(proposal.expiresAt).getTime() < currentTime
  );

  // Run History state
  interface PastRunSummary {
    id: string;
    query: string;
    status: string;
    createdAt: string;
    proposal?: PurchaseProposalDto;
    noEligibleProducts?: boolean;
    violationBreakdown?: Record<string, number>;
    suggestedAdjustments?: string[];
    explanation?: string;
    closestAlternative?: unknown;
    events?: AgentActivityEvent[];
    constraints?: ShoppingConstraints;
  }
  const [pastRuns, setPastRuns] = useState<PastRunSummary[]>([]);

  const fetchPastRuns = () => {
    fetch("/api/agent/runs")
      .then((res) => res.json())
      .then((data) => {
        if (data.success && Array.isArray(data.runs)) {
          setPastRuns(data.runs);
        }
      })
      .catch(() => {});
  };

  // Catalog Explorer Modal state
  const [showCatalogModal, setShowCatalogModal] = useState<boolean>(false);
  const [catalogItems, setCatalogItems] = useState<CatalogItemDto[]>([]);
  const [catalogCategoryFilter, setCatalogCategoryFilter] = useState<string>("all");
  const [catalogLoading, setCatalogLoading] = useState<boolean>(false);

  // Active Product Details Modal state
  const [selectedProductForDetails, setSelectedProductForDetails] =
    useState<DetailedProductItem | null>(null);

  const mapProposalToDetail = (prop: PurchaseProposalDto): DetailedProductItem => {
    return {
      id: prop.product.id,
      title: prop.product.title,
      brand: prop.product.brand,
      model: prop.product.model || prop.productId,
      category: prop.product.category,
      imageUrl: prop.product.imageUrl,
      productUrl: prop.product.productUrl,
      seller: prop.product.seller,
      marketplace: prop.product.marketplace || `${prop.product.seller} Storefront`,
      price: prop.priceBreakdown.itemPrice,
      shippingCost: prop.priceBreakdown.shippingCost,
      estimatedTax: prop.priceBreakdown.estimatedTax,
      totalCost: prop.priceBreakdown.totalCost,
      rating: prop.product.rating,
      reviewCount: prop.product.reviewCount,
      deliveryDays: prop.product.deliveryDays,
      shipsFrom: prop.product.shipsFrom || "United States Distribution Center",
      inStock: prop.product.inStock ?? true,
      stockQuantity: prop.product.stockQuantity ?? 45,
      description: prop.product.description || prop.reason,
      warranty: prop.product.warranty || "1-Year Standard Limited Warranty",
      returnPolicy: prop.product.returnPolicy || "30-Day Hassle-Free Returns",
      compatibility: prop.product.compatibility || "Standard universal device compatibility",
      specs: prop.product.specs || prop.product.attributes,
      attributes: prop.product.attributes,
      isMockData: prop.product.isMockData ?? true,
    };
  };

  const mapCatalogItemToDetail = (item: CatalogItemDto): DetailedProductItem => {
    const basePrice = item.priceCents / 100;
    const shipping = item.shippingFeeCents / 100;
    const tax =
      item.landedPricing?.estimatedTax ??
      Math.round(item.priceCents * 0.0825) / 100;
    const total =
      item.landedPricing?.totalCost ?? (basePrice + shipping + tax);

    return {
      id: item.id,
      title: item.title,
      brand: item.brand,
      model: item.model || item.externalId || item.id,
      category: item.category,
      imageUrl: item.imageUrl,
      productUrl: item.productUrl,
      seller: item.sellerName,
      marketplace: item.marketplace || `${item.sellerName} Direct`,
      price: basePrice,
      shippingCost: shipping,
      estimatedTax: tax,
      totalCost: total,
      rating: item.rating,
      reviewCount: item.reviewCount,
      deliveryDays: item.deliveryDays,
      shipsFrom: item.shipsFrom || "Regional Logistics Center",
      inStock: item.inStock && item.stockQuantity > 0,
      stockQuantity: item.stockQuantity,
      description: item.description,
      warranty: item.warranty || (item.attributes?.warranty as string) || undefined,
      returnPolicy: item.returnPolicy || "30-Day Easy Return Policy",
      compatibility: item.compatibility || (item.attributes?.compatibility as string) || undefined,
      specs: item.specs || (item.attributes as Record<string, string | number | boolean>) || undefined,
      attributes: (item.attributes as Record<string, string | number | boolean>) || undefined,
      isMockData: item.isMockData ?? true,
    };
  };

  const mapAlternativeToDetail = (alt: AlternativeProduct): DetailedProductItem => {
    const p = alt.product;
    const b = alt.breakdown;
    const basePrice = b.itemPrice;
    const shipping = b.shippingCost;
    const tax = b.estimatedTax;
    const total = b.totalCost;
    const store = getStoreInfo(p);

    return {
      id: p.id,
      title: p.title,
      brand: p.brand,
      model: p.model || p.id,
      category: p.category || "general",
      imageUrl: p.imageUrl,
      productUrl: p.productUrl,
      seller: p.seller || p.sellerName || "Marketplace Merchant",
      marketplace: store.storeName,
      price: basePrice,
      shippingCost: shipping,
      estimatedTax: tax,
      totalCost: total,
      rating: p.rating,
      reviewCount: p.reviewCount,
      deliveryDays: p.deliveryDays,
      shipsFrom: "United States Fulfillment Center",
      inStock: true,
      stockQuantity: 50,
      description: `Compliant alternative identified during agent multi-vendor comparison. Landed total: $${total.toFixed(2)} USD.`,
      warranty: (p.specs?.warranty as string) || "1-Year Standard Limited Warranty",
      returnPolicy: "30-Day Satisfaction Returns",
      compatibility: (p.specs?.compatibility as string) || "Standard compatibility",
      specs: p.specs,
      attributes: p.specs,
      isMockData: true,
    };
  };

  const mapDisqualifiedToDetail = (disq: DisqualifiedCandidateView): DetailedProductItem => {
    const p = disq.product;
    const pr = disq.pricing;
    const basePrice = pr.itemPrice;
    const shipping = pr.shippingCost;
    const tax = pr.estimatedTax;
    const total = pr.totalCost;
    const store = getStoreInfo(p);

    return {
      id: p.id,
      title: p.title,
      brand: p.brand,
      model: p.model || p.id,
      category: p.category || "general",
      imageUrl: p.imageUrl,
      productUrl: p.productUrl,
      seller: p.seller || p.sellerName || "Marketplace Seller",
      marketplace: store.storeName,
      price: basePrice,
      shippingCost: shipping,
      estimatedTax: tax,
      totalCost: total,
      rating: p.rating,
      reviewCount: p.reviewCount ?? 50,
      deliveryDays: p.deliveryDays,
      shipsFrom: "Warehouse Distribution Center",
      inStock: true,
      stockQuantity: 20,
      description: `Disqualification analysis: ${disq.reasons.join(". ")}`,
      warranty: (p.specs?.warranty as string) || "Standard Manufacturer Warranty",
      returnPolicy: "30-Day Return Guarantee",
      compatibility: (p.specs?.compatibility as string) || undefined,
      specs: p.specs,
      attributes: p.specs,
      isMockData: true,
    };
  };

  useEffect(() => {
    // Initialize guest session on mount
    fetch("/api/session", { method: "POST" })
      .then((res) => res.json())
      .then((data) => {
        if (data.sessionId) setGuestSessionId(data.sessionId);
      })
      .catch(() => setGuestSessionId("guest_local_demo"));

    // Check system health & active LLM provider
    fetch("/api/health")
      .then((res) => res.json())
      .then((data) => {
        if (data.llm?.provider) {
          setLlmProviderName(data.llm.provider);
          setIsMockMode(data.llm.provider === "mock");
        }
      })
      .catch(() => {});

    // Fetch persisted session run history
    fetchPastRuns();
  }, []);

  const openCatalogModal = async () => {
    setShowCatalogModal(true);
    setCatalogLoading(true);
    try {
      const res = await fetch(`/api/catalog?category=${catalogCategoryFilter === "all" ? "" : catalogCategoryFilter}&inStockOnly=false`);
      const data = await res.json();
      if (data.products) {
        setCatalogItems(data.products);
      }
    } catch (err) {
      console.error("Failed to load catalog:", err);
    } finally {
      setCatalogLoading(false);
    }
  };

  const executeDirectRun = async (targetQuery: string, constraintsOverride?: ShoppingConstraints) => {
    const activeConstraints = constraintsOverride || constraints;
    try {
      const response = await fetch("/api/agent/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: targetQuery,
          constraints: {
            ...activeConstraints,
            preferredBrand: activeConstraints.preferredBrand?.trim() || undefined,
          },
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        if (data.noEligibleProducts) {
          setNoEligibleOutcome({
            violationBreakdown: data.violationBreakdown || {},
            suggestedAdjustments: data.suggestedAdjustments || [],
            explanation: data.explanation || data.error,
            noExactMatch: data.noExactMatch || false,
            suggestedCategory: data.suggestedCategory,
            closestAlternative: data.closestAlternative || null,
          });
        } else {
          setError(data.error || "Failed to execute agent run");
        }
        if (data.events) setEvents(data.events);
      } else {
        setProposal(data.proposal);
        setReasoning(data.reasoning);
        setAlternatives(data.alternatives || []);
        setDisqualifiedCandidates(data.disqualifiedCandidates || []);
        setEvents(data.events || []);
        if (data.llmProvider) {
          setLlmProviderName(data.llmProvider);
          setIsMockMode(data.isMockMode ?? data.llmProvider === "mock");
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error contacting shopping agent");
    } finally {
      setIsRunning(false);
      setIsStreaming(false);
      fetchPastRuns();
    }
  };

  const handleSelectPastRun = async (pastRunId: string) => {
    try {
      setReceipt(null);
      setCheckoutSessionId(null);
      setIsCapturing(false);
      setIsCreatingOrder(false);
      setCheckoutError(null);

      const res = await fetch(`/api/agent/runs/${pastRunId}`);
      const data = await res.json();
      if (data.success && data.run) {
        setQuery(data.run.query);
        if (data.run.constraints) {
          setConstraints(data.run.constraints);
        }
        setEvents(data.run.events || []);
        if (data.run.proposal) {
          setProposal(data.run.proposal);
          setReasoning({
            headline: `Top Pick: ${data.run.proposal.product.title}`,
            explanation: data.run.proposal.reason,
            pros: ["Verified total landed cost within budget"],
            tradeoffs: ["Subject to checkout regional tax confirmation"],
            constraintComplianceSummary: "Meets active shopping constraints.",
          });
          setNoEligibleOutcome(null);
        } else if (data.run.noEligibleProducts) {
          setProposal(null);
          setReasoning(null);
          setNoEligibleOutcome({
            violationBreakdown: data.run.violationBreakdown || {},
            suggestedAdjustments: data.run.suggestedAdjustments || [],
            explanation: data.run.explanation || "No products satisfy all hard constraints.",
            noExactMatch: data.run.noExactMatch || false,
            suggestedCategory: data.run.suggestedCategory,
            closestAlternative: (data.run.closestAlternative || null) as NoEligibleOutcome["closestAlternative"],
          });
        }
      }
    } catch (err) {
      console.error("Failed to restore past run:", err);
    }
  };

  const handleStartRun = async (searchQuery?: string, constraintsOverride?: ShoppingConstraints) => {
    const targetQuery = searchQuery || query;
    if (!targetQuery.trim()) return;

    let activeConstraints = constraintsOverride || constraints;
    if (!constraintsOverride) {
      const qLower = targetQuery.toLowerCase();
      const updated: Partial<ShoppingConstraints> = {};

      // 1. Budget extraction
      const budgetMatch =
        targetQuery.match(/(?:under|below|less than|max|up to|budget(?: of|:)?|at most|around|approx|approximately|<=?)\s*(?:[\$₹€£¥]|usd|inr|eur|gbp)?\s*(\d+(?:\.\d{1,2})?)(?!\s*days?)/i) ||
        targetQuery.match(/(?:[\$₹€£¥]|usd|inr|eur|gbp)\s*(\d+(?:\.\d{1,2})?)(?!\s*days?)/i) ||
        targetQuery.match(/(\d+(?:\.\d{1,2})?)\s*(?:max|budget|or less|dollars?|usd|rupees?|inr|euros?|pounds?)/i) ||
        targetQuery.match(/for\s*(?:[\$₹€£¥]|usd|inr|eur|gbp)?\s*(\d+(?:\.\d{1,2})?)(?!\s*days?)/i);
      if (budgetMatch && budgetMatch[1]) {
        updated.maxBudget = parseFloat(budgetMatch[1]);
      }

      // 2. Delivery days extraction
      const deliveryMatch =
        targetQuery.match(/(?:within|in|under|delivered in|<=?)\s*(\d+)\s*days?/i) ||
        targetQuery.match(/(\d+)[ -]day(?:\s+delivery|\s+shipping)?/i);
      if (deliveryMatch && deliveryMatch[1]) {
        updated.maxDeliveryDays = parseInt(deliveryMatch[1], 10);
      } else if (qLower.includes("next day") || qLower.includes("overnight") || qLower.includes("same day")) {
        updated.maxDeliveryDays = 1;
      } else if (qLower.includes("fast shipping") || qLower.includes("fast delivery") || qLower.includes("rush")) {
        updated.maxDeliveryDays = 2;
      }

      // 3. Rating extraction
      const ratingMatch =
        targetQuery.match(/(?:rating of|rating|min rating|rated|at least)\s*(\d+(?:\.\d+)?)\s*(?:\+|stars?|★)?/i) ||
        targetQuery.match(/(\d+(?:\.\d+)?)\s*(?:\+|stars?|★)?\s*rating/i) ||
        targetQuery.match(/(\d+(?:\.\d+)?)\s*\+\s*(?:rating|stars?|★)?/i) ||
        targetQuery.match(/(\d+(?:\.\d+)?)\s*(?:stars?|★)/i);
      if (ratingMatch && ratingMatch[1]) {
        const parsedRating = parseFloat(ratingMatch[1]);
        if (parsedRating >= 1.0 && parsedRating <= 5.0) {
          updated.minRating = parsedRating;
        }
      }

      // 4. Brand extraction
      const brandMap: Record<string, string> = {
        sony: "Sony",
        apple: "Apple",
        bose: "Bose",
        dell: "Dell",
        lg: "LG",
        keychron: "Keychron",
        anker: "Anker",
        samsung: "Samsung",
        steelcase: "Steelcase",
        logitech: "Logitech",
        razer: "Razer",
        corsair: "Corsair",
        jbl: "JBL",
        sennheiser: "Sennheiser",
        caldigit: "CalDigit",
        autonomous: "Autonomous",
        benq: "BenQ",
        uplift: "UPLIFT",
        ecotype: "EcoType",
        cerave: "CeraVe",
        cetaphil: "Cetaphil",
        "la roche-posay": "La Roche-Posay",
        laroche: "La Roche-Posay",
        minimalist: "Minimalist",
        neutrogena: "Neutrogena",
        thermoflask: "ThermoFlask",
        "hydro flask": "Hydro Flask",
        hydroflask: "Hydro Flask",
        owala: "Owala",
      };
      for (const [key, brandName] of Object.entries(brandMap)) {
        if (new RegExp(`\\b${key}\\b`, "i").test(qLower)) {
          updated.preferredBrand = brandName;
          break;
        }
      }

      // 5. Optimization preference extraction
      if (
        qLower.includes("cheapest") ||
        qLower.includes("lowest price") ||
        qLower.includes("cheap") ||
        qLower.includes("least expensive") ||
        qLower.includes("budget-friendly") ||
        qLower.includes("best price")
      ) {
        updated.optimizationPreference = "LOWEST_PRICE";
      } else if (
        updated.preferredBrand ||
        qLower.includes("brand") ||
        qLower.includes("only") ||
        qLower.includes("prefer")
      ) {
        updated.optimizationPreference = "PREFERRED_BRAND";
      } else if (
        qLower.includes("best value") ||
        qLower.includes("value for money") ||
        qLower.includes("top rated") ||
        qLower.includes("best rated") ||
        qLower.includes("highest rating") ||
        qLower.includes("best overall")
      ) {
        updated.optimizationPreference = "BEST_VALUE";
      }

      activeConstraints = { ...activeConstraints, ...updated };
      setConstraints(activeConstraints);
    }

    setIsRunning(true);
    setError(null);
    setNoEligibleOutcome(null);
    setEvents([]);
    setProposal(null);
    setReasoning(null);
    setAlternatives([]);
    setDisqualifiedCandidates([]);
    setVerificationStatus(null);
    setVerificationError(null);
    setReceipt(null);
    setCheckoutSessionId(null);
    setIsCapturing(false);
    setIsCreatingOrder(false);
    setCheckoutError(null);
    setSelectedProductForDetails(null);

    // Attempt live Server-Sent Events (SSE) stream
    if (typeof window !== "undefined" && typeof EventSource !== "undefined") {
      setIsStreaming(true);
      let streamCompleted = false;

      const params = new URLSearchParams({
        query: targetQuery,
        maxBudget: activeConstraints.maxBudget.toString(),
        maxDeliveryDays: activeConstraints.maxDeliveryDays.toString(),
        minRating: activeConstraints.minRating.toString(),
        preferredBrand: activeConstraints.preferredBrand?.trim() || "",
        optimizationPreference: activeConstraints.optimizationPreference,
      });

      const es = new EventSource(`/api/agent/stream?${params.toString()}`);

      es.addEventListener("agent-event", (event: MessageEvent) => {
        try {
          const evt: AgentActivityEvent = JSON.parse(event.data);
          setEvents((prev) => {
            const exists = prev.some((e) => e.sequence === evt.sequence && e.stage === evt.stage);
            return exists ? prev : [...prev, evt];
          });

          if (evt.stage === "PARSE_QUERY" && evt.payload?.effectiveConstraints) {
            const eff = evt.payload.effectiveConstraints as ShoppingConstraints;
            setConstraints((prev) => ({
              ...prev,
              ...eff,
            }));
          }

          if (evt.stage === "READY_FOR_REVIEW" && evt.payload?.proposal) {
            streamCompleted = true;
            const p = evt.payload.proposal as PurchaseProposalDto & {
              headline?: string;
              pros?: string[];
              tradeoffs?: string[];
              complianceSummary?: string;
            };
            setProposal(p);
            if (evt.payload.alternatives && Array.isArray(evt.payload.alternatives)) {
              setAlternatives(evt.payload.alternatives as unknown as AlternativeProduct[]);
            }
            if (evt.payload.disqualifiedCandidates && Array.isArray(evt.payload.disqualifiedCandidates)) {
              setDisqualifiedCandidates(evt.payload.disqualifiedCandidates as unknown as DisqualifiedCandidateView[]);
            }
            setReasoning({
              headline: p.headline || `Top Pick: ${p.product.title}`,
              explanation: p.reason,
              pros: p.pros || ["Verified total landed cost within budget"],
              tradeoffs: p.tradeoffs || ["Estimated regional sales tax"],
              constraintComplianceSummary: p.complianceSummary || "Fully satisfies all active shopping constraints.",
            });
            setIsRunning(false);
            setIsStreaming(false);
            fetchPastRuns();
            es.close();
          }

          if (evt.eventType === "ERROR") {
            streamCompleted = true;
            if (evt.payload?.noEligibleProducts) {
              setNoEligibleOutcome({
                violationBreakdown: (evt.payload.violationBreakdown || {}) as Record<string, number>,
                suggestedAdjustments: (evt.payload.suggestedAdjustments || []) as string[],
                explanation: (evt.payload.explanation || evt.message) as string,
                noExactMatch: (evt.payload.noExactMatch || false) as boolean,
                suggestedCategory: (evt.payload.suggestedCategory || undefined) as string | undefined,
                closestAlternative: (evt.payload.closestAlternative || null) as NoEligibleOutcome["closestAlternative"],
              });
            } else {
              setError(evt.message);
            }
            setIsRunning(false);
            setIsStreaming(false);
            fetchPastRuns();
            es.close();
          }
        } catch (err) {
          console.error("SSE parsing error:", err);
        }
      });

      es.onerror = () => {
        es.close();
        setIsStreaming(false);
        if (!streamCompleted) {
          executeDirectRun(targetQuery, activeConstraints);
        }
      };
    } else {
      await executeDirectRun(targetQuery, activeConstraints);
    }
  };

  const handleVerifyProposal = async () => {
    if (!proposal) return;
    setVerificationStatus("verifying");
    setVerificationError(null);

    try {
      const res = await fetch("/api/proposals/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          proposalId: proposal.id,
          currentConstraints: constraints,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setVerificationStatus("verified");
        setVerificationError(null);
      } else {
        setVerificationStatus("failed");
        setVerificationError(data.error || "Proposal failed verification.");
      }
    } catch {
      setVerificationStatus("failed");
      setVerificationError("Network error while verifying proposal.");
    }
  };

  const handleDirectSandboxCheckout = async () => {
    if (!proposal) return;
    setIsCapturing(true);
    setCheckoutError(null);
    try {
      // 1. Authoritative create-order call
      const idempotencyKey = `idem_${proposal.id}_${Date.now()}`;
      const createRes = await fetch("/api/paypal/create-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          proposalId: proposal.id,
          idempotencyKey,
        }),
      });
      const createData = await createRes.json();
      if (!createRes.ok || !createData.success) {
        throw new Error(createData.error || "Failed to create PayPal order");
      }

      setCheckoutSessionId(createData.checkoutSessionId);

      // 2. Authoritative capture-order call
      const captureRes = await fetch("/api/paypal/capture-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paypalOrderId: createData.paypalOrderId || createData.orderId,
          checkoutSessionId: createData.checkoutSessionId,
          idempotencyKey: `cap_${idempotencyKey}`,
        }),
      });
      const captureData = await captureRes.json();
      if (!captureRes.ok || !captureData.success) {
        throw new Error(captureData.error || "Failed to capture payment");
      }

      setReceipt(captureData.receipt);
      setProposal((prev) => (prev ? { ...prev, status: "COMPLETED" } : null));
    } catch (err) {
      setCheckoutError(err instanceof Error ? err.message : "Sandbox checkout execution failed");
    } finally {
      setIsCapturing(false);
    }
  };

  const handleResetSearch = () => {
    setProposal(null);
    setReceipt(null);
    setEvents([]);
    setReasoning(null);
    setAlternatives([]);
    setDisqualifiedCandidates([]);
    setError(null);
    setNoEligibleOutcome(null);
    setVerificationStatus(null);
    setVerificationError(null);
    setCheckoutError(null);
    setCheckoutSessionId(null);
    setSelectedProductForDetails(null);
    setQuery("");
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      {/* Top Navigation Bar */}
      <header className="border-b border-slate-800/80 bg-slate-900/60 backdrop-blur-md sticky top-0 z-50 px-4 lg:px-8 py-3.5">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-500 to-emerald-400 p-0.5 shadow-md shadow-indigo-500/20">
              <div className="w-full h-full bg-slate-950 rounded-[10px] flex items-center justify-center">
                <Bot className="w-5 h-5 text-indigo-400" />
              </div>
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="font-bold tracking-tight text-lg text-white">AgentCart AI</span>
                <span className="text-[11px] font-medium tracking-wide uppercase px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                  AI Commerce Agent
                </span>
              </div>
              <p className="text-xs text-slate-400 hidden sm:block">
                Verifiable Landed Cost • Deterministic Guardrails • Simulated Multi-Vendor Demo
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2.5">
            {/* Catalog Explorer Trigger */}
            <button
              type="button"
              onClick={openCatalogModal}
              className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700/80 border border-slate-700 text-xs font-medium text-slate-200 transition-all cursor-pointer shadow-sm"
            >
              <Store className="w-3.5 h-3.5 text-indigo-400" />
              <span>Catalog Explorer</span>
            </button>

            <div
              className={`flex items-center space-x-1.5 px-2.5 py-1 rounded-lg border text-xs font-medium ${
                isMockMode
                  ? "bg-amber-500/10 border-amber-500/20 text-amber-300"
                  : "bg-indigo-500/10 border-indigo-500/20 text-indigo-300"
              }`}
            >
              <span className={`w-2 h-2 rounded-full ${isMockMode ? "bg-amber-400" : "bg-indigo-400 animate-pulse"}`} />
              <span className="capitalize">
                LLM: {llmProviderName} {isMockMode ? "(Demo Adapter)" : "(Live)"}
              </span>
            </div>

            <div className="flex items-center space-x-2 px-2.5 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-medium">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span>PayPal Sandbox</span>
            </div>

            <div className="hidden md:flex items-center space-x-1.5 px-2.5 py-1 rounded-lg bg-slate-800/60 border border-slate-700/50 text-slate-400 text-xs">
              <span className="text-slate-500">Session:</span>
              <span className="font-mono text-slate-300">{guestSessionId}</span>
            </div>
          </div>
        </div>
      </header>

      {/* Product Value Proposition & Deterministic Judge Demo Banner */}
      <section
        aria-label="Agent Value Proposition and Demo Showcase"
        className="max-w-7xl w-full mx-auto px-4 lg:px-6 pt-5 pb-1"
      >
        <div className="rounded-2xl bg-gradient-to-r from-indigo-950/70 via-slate-900/90 to-emerald-950/50 border border-indigo-500/30 p-5 shadow-lg backdrop-blur-sm">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="space-y-1.5 max-w-2xl">
              <div className="flex items-center space-x-2">
                <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                  Autonomous Commerce with Landed-Cost Guardrails
                </span>
                <span className="text-[10px] font-mono text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                  Demo Mode: Mock Catalog & Tax Estimates
                </span>
              </div>
              <h1 className="text-base sm:text-lg font-bold text-white tracking-tight">
                The agent that checks the <span className="text-emerald-400">complete landed cost</span> before checkout.
              </h1>
              <p className="text-xs text-slate-300 leading-relaxed">
                Conventional AI shopping bots only look at sticker prices. AgentCart AI computes base price + shipping logistics + sales tax strictly in integer cents, enforces your hard budget constraints server-side, and requires your explicit review before creating PayPal Sandbox charges.
              </p>
            </div>

            {/* Quick-Launch Judge Demo Scenario */}
            <div className="shrink-0 bg-slate-950/80 border border-indigo-500/40 rounded-xl p-3.5 space-y-2 text-xs md:max-w-xs shadow-md">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-wider text-amber-300 flex items-center">
                  <Sparkles className="w-3 h-3 mr-1 text-amber-400" />
                  Judge Demo Scenario
                </span>
                <span className="text-[9px] font-mono text-slate-400 bg-slate-900 px-1.5 py-0.5 rounded">
                  $150 Hard Cap
                </span>
              </div>
              <p className="text-[11px] text-slate-300">
                Tests landed-cost guardrail: candidate costs $145 + $12 shipping ($157+ landed) — <strong>rejected</strong>; finds compliant alternative ($86.59 all-in).
              </p>
              <button
                type="button"
                onClick={() => {
                  const demoQuery = "Find wireless headphones under $150";
                  const demoConstraints: ShoppingConstraints = {
                    ...DEFAULT_CONSTRAINTS,
                    maxBudget: 150,
                    maxDeliveryDays: 3,
                    minRating: 4.5,
                  };
                  setQuery(demoQuery);
                  setConstraints(demoConstraints);
                  handleStartRun(demoQuery, demoConstraints);
                }}
                disabled={isRunning}
                className="w-full py-2 px-3 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 text-white text-xs font-semibold flex items-center justify-center space-x-1.5 transition-all shadow-sm cursor-pointer disabled:cursor-not-allowed"
              >
                <Bot className="w-3.5 h-3.5" />
                <span>Run Judge Demo Scenario</span>
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 lg:p-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Conversation & Shopping Constraints (4 cols) */}
        <section className="lg:col-span-4 flex flex-col space-y-5">
          {/* Query Input Box */}
          <div className="rounded-2xl bg-slate-900/80 border border-slate-800/80 p-5 shadow-sm">
            <label htmlFor="shopping-query" className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
              What do you want to buy?
            </label>
            <div className="relative">
              <textarea
                id="shopping-query"
                rows={3}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleStartRun();
                  }
                }}
                placeholder="e.g. Find noise-canceling headphones under $150 delivered within 3 days..."
                className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 resize-none transition-all"
              />
            </div>

            <div className="mt-3 flex items-center justify-between">
              <span className="text-[11px] text-slate-500">Press Enter or click Research</span>
              <button
                type="button"
                onClick={() => handleStartRun()}
                disabled={isRunning || !query.trim()}
                className="flex items-center space-x-2 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 disabled:text-slate-500 text-white text-xs font-semibold transition-all shadow-md shadow-indigo-600/20 disabled:shadow-none cursor-pointer disabled:cursor-not-allowed"
              >
                {isRunning ? (
                  <>
                    <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    <span>Researching...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>Deploy Agent</span>
                  </>
                )}
              </button>
            </div>

            {/* Quick-Start Prompts */}
            <div className="mt-4 pt-4 border-t border-slate-800/60">
              <span className="text-[11px] font-medium text-slate-400 block mb-2">Quick-start templates:</span>
              <div className="flex flex-col space-y-2">
                {QUICK_PROMPTS.map((p, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => {
                      setQuery(p.text);
                      const newConstraints: ShoppingConstraints = {
                        ...constraints,
                        maxBudget: p.budget,
                        maxDeliveryDays: p.days,
                        minRating: p.rating,
                      };
                      setConstraints(newConstraints);
                      handleStartRun(p.text, newConstraints);
                    }}
                    className="text-left p-2.5 rounded-xl bg-slate-950/60 hover:bg-slate-800/60 border border-slate-800/80 text-xs text-slate-300 hover:text-white transition-all flex items-start justify-between group cursor-pointer"
                  >
                    <div className="min-w-0 pr-2 space-y-0.5">
                      <div className="flex items-center space-x-1.5 flex-wrap">
                        <span className="font-medium text-slate-200">{p.text}</span>
                        {p.badge && (
                          <span
                            className={`text-[9px] px-1.5 py-0.5 rounded font-mono ${
                              p.badge.includes("Judge")
                                ? "bg-amber-500/15 text-amber-300 border border-amber-500/30"
                                : "bg-indigo-500/15 text-indigo-300 border border-indigo-500/20"
                            }`}
                          >
                            {p.badge}
                          </span>
                        )}
                      </div>
                      <span className="text-[10px] text-slate-500 block">
                        Budget: ${p.budget} • Delivery ≤ {p.days}d • Rating ≥ {p.rating}★
                      </span>
                    </div>
                    <ArrowRight className="w-3.5 h-3.5 text-slate-500 group-hover:text-indigo-400 shrink-0 transition-colors mt-0.5" />
                  </button>
                ))}
              </div>
            </div>

            {/* Persisted Run History Across Page Refreshes */}
            {pastRuns.length > 0 && (
              <div className="mt-4 pt-4 border-t border-slate-800/60">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center space-x-1.5 text-[11px] font-medium text-slate-400">
                    <History className="w-3.5 h-3.5 text-indigo-400" />
                    <span>Recent Research History ({pastRuns.length}):</span>
                  </div>
                  <span className="text-[10px] text-slate-500 font-mono">Persisted</span>
                </div>
                <div className="flex flex-col space-y-1.5 max-h-36 overflow-y-auto pr-1">
                  {pastRuns.slice(0, 5).map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => handleSelectPastRun(r.id)}
                      className="text-left px-3 py-1.5 rounded-xl bg-slate-950/40 hover:bg-slate-800/60 border border-slate-800/60 text-xs text-slate-300 hover:text-white transition-all flex items-center justify-between group cursor-pointer"
                    >
                      <div className="truncate pr-2">
                        <span className="font-medium text-slate-200">{r.query}</span>
                        <span className="text-[10px] text-slate-500 ml-2">
                          {new Date(r.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </span>
                      </div>
                      <span
                        className={`text-[9px] px-1.5 py-0.5 rounded font-mono shrink-0 ${
                          r.status === "COMPLETED"
                            ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/20"
                            : r.noEligibleProducts
                            ? "bg-rose-500/15 text-rose-400 border border-rose-500/20"
                            : "bg-indigo-500/15 text-indigo-400 border border-indigo-500/20"
                        }`}
                      >
                        {r.noEligibleProducts ? "NO MATCH" : r.status}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Hard Guardrail Constraints Panel */}
          <div className="rounded-2xl bg-slate-900/80 border border-slate-800/80 p-5 shadow-sm space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center space-x-2">
                <Sliders className="w-4 h-4 text-indigo-400" />
                <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-300">
                  Deterministic Hard Constraints
                </h2>
              </div>
              <span className="text-[10px] text-slate-500 font-mono">Server Enforced</span>
            </div>

            {/* Max Budget */}
            <div>
              <div className="flex justify-between text-xs mb-1">
                <label htmlFor="budget-slider" className="text-slate-400">Max Budget (All-in Landed Cost)</label>
                <span className="font-mono font-bold text-emerald-400">${constraints.maxBudget.toFixed(2)}</span>
              </div>
              <input
                id="budget-slider"
                type="range"
                min="50"
                max="1000"
                step="25"
                value={constraints.maxBudget}
                onChange={(e) =>
                  setConstraints((prev) => ({ ...prev, maxBudget: parseFloat(e.target.value) }))
                }
                className="w-full accent-indigo-500 cursor-pointer"
              />
              <span className="text-[10px] text-slate-500">Includes item price + shipping + estimated tax</span>
            </div>

            {/* Max Delivery Days */}
            <div>
              <div className="flex justify-between text-xs mb-1">
                <label htmlFor="delivery-slider" className="text-slate-400">Max Delivery Days</label>
                <span className="font-mono font-bold text-indigo-400">
                  {constraints.maxDeliveryDays} business days
                </span>
              </div>
              <input
                id="delivery-slider"
                type="range"
                min="1"
                max="10"
                step="1"
                value={constraints.maxDeliveryDays}
                onChange={(e) =>
                  setConstraints((prev) => ({ ...prev, maxDeliveryDays: parseInt(e.target.value, 10) }))
                }
                className="w-full accent-indigo-500 cursor-pointer"
              />
            </div>

            {/* Min Rating */}
            <div>
              <div className="flex justify-between text-xs mb-1">
                <label htmlFor="rating-slider" className="text-slate-400">Minimum Rating</label>
                <span className="font-mono font-bold text-amber-400">
                  {constraints.minRating.toFixed(1)}★
                </span>
              </div>
              <input
                id="rating-slider"
                type="range"
                min="3.0"
                max="5.0"
                step="0.1"
                value={constraints.minRating}
                onChange={(e) =>
                  setConstraints((prev) => ({ ...prev, minRating: parseFloat(e.target.value) }))
                }
                className="w-full accent-indigo-500 cursor-pointer"
              />
            </div>

            {/* Preferred Brand */}
            <div>
              <label htmlFor="brand-input" className="block text-xs text-slate-400 mb-1">Brand Preference</label>
              <input
                id="brand-input"
                type="text"
                value={constraints.preferredBrand || ""}
                onChange={(e) =>
                  setConstraints((prev) => ({ ...prev, preferredBrand: e.target.value }))
                }
                placeholder="e.g. Sony, Logitech, Anker, Bose..."
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-indigo-500"
              />
            </div>

            {/* Optimization Preference */}
            <div>
              <label className="block text-xs text-slate-400 mb-2">Optimization Preference</label>
              <div className="grid grid-cols-3 gap-1.5">
                {[
                  { id: "BEST_VALUE", label: "Best Value" },
                  { id: "LOWEST_PRICE", label: "Lowest Price" },
                  { id: "PREFERRED_BRAND", label: "Brand First" },
                ].map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() =>
                      setConstraints((prev) => ({
                        ...prev,
                        optimizationPreference: opt.id as OptimizationPreference,
                      }))
                    }
                    className={`py-1.5 px-2 rounded-xl text-[11px] font-medium border text-center transition-all cursor-pointer ${
                      constraints.optimizationPreference === opt.id
                        ? "bg-indigo-600/20 border-indigo-500 text-indigo-300 font-bold"
                        : "bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Center Column: Recommendation, No Eligible Outcomes & Review-Before-Purchase (5 cols) */}
        <section className="lg:col-span-5 flex flex-col space-y-5">
          {error && (
            <div className="rounded-2xl bg-rose-500/10 border border-rose-500/20 p-4 text-xs text-rose-300 flex items-start space-x-3">
              <ShieldAlert className="w-4 h-4 text-rose-400 mt-0.5 shrink-0" />
              <div>
                <p className="font-semibold text-rose-200">Execution Error</p>
                <p className="mt-0.5">{error}</p>
              </div>
            </div>
          )}

          {/* DEDICATED NO ELIGIBLE PRODUCTS OUTCOME CARD */}
          {noEligibleOutcome && !isRunning && (
            <div
              className={`rounded-2xl ${
                noEligibleOutcome.noExactMatch
                  ? "bg-amber-950/20 border-amber-500/40"
                  : "bg-rose-950/20 border-rose-500/40"
              } border p-5 shadow-lg space-y-4`}
            >
              <div className="flex items-start space-x-3">
                <div
                  className={`w-9 h-9 rounded-xl ${
                    noEligibleOutcome.noExactMatch
                      ? "bg-amber-500/20 border-amber-500/40 text-amber-400"
                      : "bg-rose-500/20 border-rose-500/40 text-rose-400"
                  } border flex items-center justify-center shrink-0`}
                >
                  {noEligibleOutcome.noExactMatch ? (
                    <Search className="w-5 h-5 text-amber-400" />
                  ) : (
                    <ShieldAlert className="w-5 h-5 text-rose-400" />
                  )}
                </div>
                <div>
                  <h3
                    className={`text-sm font-bold ${
                      noEligibleOutcome.noExactMatch ? "text-amber-200" : "text-rose-200"
                    }`}
                  >
                    {noEligibleOutcome.noExactMatch
                      ? "No Exact Match Found"
                      : "No Eligible Products Found"}
                  </h3>
                  <p
                    className={`text-xs ${
                      noEligibleOutcome.noExactMatch
                        ? "text-amber-300/80"
                        : "text-rose-300/80"
                    } mt-0.5 leading-relaxed`}
                  >
                    {noEligibleOutcome.noExactMatch
                      ? noEligibleOutcome.explanation ||
                        "No products matching your exact request were found in the verified catalog. We never substitute unrelated products or fabricate fake results."
                      : "Deterministic guardrails checked all catalog candidates. Hard constraints are never silently relaxed."}
                  </p>
                </div>
              </div>

              {/* No Exact Match: Broader Search Guidance & Action */}
              {noEligibleOutcome.noExactMatch && (
                <div className="p-3 bg-slate-950/80 rounded-xl border border-amber-500/30 space-y-2.5">
                  <span className="text-[10px] uppercase font-bold text-amber-400 block">
                    Discovery Recommendation:
                  </span>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    AgentCart AI enforces strict product relevance. Rather than showing unrelated items from other categories, we recommend broadening your search or browsing verified categories.
                  </p>
                  {noEligibleOutcome.suggestedCategory &&
                    noEligibleOutcome.suggestedCategory !== "all" && (
                      <div className="pt-1 flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            const cat = noEligibleOutcome.suggestedCategory!;
                            setQuery(cat);
                            handleStartRun(cat);
                          }}
                          className="px-3 py-1.5 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-200 rounded-lg text-xs font-semibold transition-colors cursor-pointer flex items-center gap-1.5"
                        >
                          <Search className="w-3.5 h-3.5" />
                          Browse all &quot;{noEligibleOutcome.suggestedCategory}&quot; items
                        </button>
                      </div>
                    )}
                </div>
              )}

              {/* Violated Constraint Badges */}
              {!noEligibleOutcome.noExactMatch && (
                <div className="p-3 bg-slate-950/80 rounded-xl border border-rose-950/60 space-y-2">
                  <span className="text-[10px] uppercase font-bold text-slate-400 block">
                    Violated Guardrail Breakdown:
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {Object.entries(noEligibleOutcome.violationBreakdown)
                      .filter(([, count]) => count > 0)
                      .map(([code, count]) => (
                        <span
                          key={code}
                          className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-mono bg-rose-500/15 border border-rose-500/30 text-rose-300"
                        >
                          {code}: {count} candidate{count === 1 ? "" : "s"}
                        </span>
                      ))}
                  </div>
                </div>
              )}

              {/* Suggested Adjustments */}
              {noEligibleOutcome.suggestedAdjustments.length > 0 && (
                <div className="space-y-2">
                  <span className="text-[10px] uppercase font-semibold text-indigo-400 block">
                    Suggested Actions to Unlock Matching Products:
                  </span>
                  <div className="space-y-1.5">
                    {noEligibleOutcome.suggestedAdjustments.map((sugg, idx) => (
                      <div
                        key={idx}
                        className="bg-indigo-950/30 border border-indigo-500/30 rounded-xl p-2.5 text-xs text-indigo-200 flex items-center justify-between"
                      >
                        <span>{sugg}</span>
                        {sugg.includes("Increase budget to at least $") && (
                          <button
                            type="button"
                            onClick={() => {
                              const match = sugg.match(/\$(\d+(\.\d+)?)/);
                              if (match) {
                                const newBudget = Math.ceil(parseFloat(match[1]));
                                const updatedConstraints: ShoppingConstraints = { ...constraints, maxBudget: newBudget };
                                setConstraints(updatedConstraints);
                                handleStartRun(undefined, updatedConstraints);
                              }
                            }}
                            className="ml-2 px-2.5 py-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-[10px] font-bold shrink-0 transition-colors cursor-pointer"
                          >
                            Apply & Retry
                          </button>
                        )}
                        {sugg.includes("Extend delivery timeline to ") && (
                          <button
                            type="button"
                            onClick={() => {
                              const match = sugg.match(/to (\d+) business days/);
                              if (match) {
                                const newDays = parseInt(match[1], 10);
                                const updatedConstraints: ShoppingConstraints = { ...constraints, maxDeliveryDays: newDays };
                                setConstraints(updatedConstraints);
                                handleStartRun(undefined, updatedConstraints);
                              }
                            }}
                            className="ml-2 px-2.5 py-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-[10px] font-bold shrink-0 transition-colors cursor-pointer"
                          >
                            Apply & Retry
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Closest Alternative Preview (Disqualified) */}
              {noEligibleOutcome.closestAlternative && (
                <div className="p-3 bg-slate-950/90 rounded-xl border border-slate-800 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-slate-300">
                      Closest Candidate (Disqualified):
                    </span>
                    <span className="text-[10px] font-semibold text-rose-400 bg-rose-500/10 px-2 py-0.5 rounded border border-rose-500/20">
                      Disqualified by Guardrail
                    </span>
                  </div>
                  <p className="text-xs text-slate-200 font-semibold">
                    {noEligibleOutcome.closestAlternative.product.title}
                  </p>
                  <div className="flex items-center space-x-3 text-[11px] text-slate-400">
                    <span>
                      Landed Total:{" "}
                      <strong className="text-slate-200">
                        ${(
                          (noEligibleOutcome.closestAlternative.pricing?.totalCost ||
                            noEligibleOutcome.closestAlternative.breakdown?.totalCost ||
                            0)
                        ).toFixed(2)}
                      </strong>
                    </span>
                    <span>•</span>
                    <span>
                      Delivery: {noEligibleOutcome.closestAlternative.product.deliveryDays}d
                    </span>
                    <span>•</span>
                    <span>
                      Rating: {noEligibleOutcome.closestAlternative.product.rating}★
                    </span>
                  </div>
                  {noEligibleOutcome.closestAlternative.reasons && (
                    <ul className="text-[10px] text-rose-400/90 list-disc list-inside">
                      {noEligibleOutcome.closestAlternative.reasons.map((r, i) => (
                        <li key={i}>{r}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Empty State */}
          {!isRunning && !proposal && !error && !noEligibleOutcome && (
            <div className="rounded-2xl bg-slate-900/40 border border-slate-800/60 p-8 text-center flex flex-col items-center justify-center min-h-[380px]">
              <div className="w-14 h-14 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center mb-4">
                <Search className="w-6 h-6 text-indigo-400" />
              </div>
              <h3 className="text-base font-semibold text-slate-200">Shopping Assistant Ready</h3>
              <p className="text-xs text-slate-400 max-w-sm mt-1.5 leading-relaxed">
                Describe the item you need or select a quick template. AgentCart will search the multi-vendor catalog, compute exact landed cost, and verify hard constraints.
              </p>
              <div className="mt-6 flex flex-wrap items-center justify-center gap-3 text-xs text-slate-500">
                <span className="flex items-center">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 mr-1.5" /> All-in Landed Cost
                </span>
                <span className="flex items-center">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 mr-1.5" /> Zero Silent Constraint Relaxation
                </span>
                <span className="flex items-center">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 mr-1.5" /> Integer Minor Units
                </span>
              </div>
            </div>
          )}

          {/* Loading State */}
          {isRunning && (
            <div className="rounded-2xl bg-slate-900/60 border border-slate-800 p-8 flex flex-col items-center justify-center min-h-[380px] space-y-4">
              <div className="relative">
                <div className="w-14 h-14 rounded-2xl bg-indigo-500/10 border border-indigo-500/30 flex items-center justify-center animate-pulse">
                  <Bot className="w-7 h-7 text-indigo-400" />
                </div>
                <div className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-indigo-500 animate-ping" />
              </div>
              <div className="text-center space-y-1">
                <h3 className="text-sm font-semibold text-slate-200">Autonomous Agent Executing</h3>
                <p className="text-xs text-slate-400">
                  Filtering inventory, computing taxes, and enforcing strict policy guardrails...
                </p>
              </div>
            </div>
          )}

          {/* Active Proposal Card */}
          {proposal && !isRunning && (
            <div className="space-y-5">
              <div className="rounded-2xl bg-slate-900/90 border border-indigo-500/30 p-5 shadow-lg shadow-indigo-950/40 relative overflow-hidden">
                <div className="absolute top-0 right-0 bg-indigo-600 text-white text-[10px] font-bold uppercase tracking-wider px-3 py-1 rounded-bl-xl">
                  Verified Recommendation
                </div>

                <div className="flex items-start space-x-4">
                  {/* Product Image - Clickable to open details modal */}
                  <button
                    type="button"
                    onClick={() =>
                      setSelectedProductForDetails(mapProposalToDetail(proposal))
                    }
                    className="w-24 h-24 rounded-xl bg-slate-950 border border-slate-800 hover:border-indigo-500/60 overflow-hidden shrink-0 flex items-center justify-center relative group cursor-pointer transition-all focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    title="Click to view full specifications & merchant listing"
                    id="recommendation-thumbnail-button"
                  >
                    <ProductThumbnail
                      src={proposal.product.imageUrl}
                      alt={proposal.product.title}
                      category={proposal.product.category}
                      productId={proposal.product.id}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                    <div className="absolute inset-0 bg-slate-950/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                      <Eye className="w-5 h-5 text-white drop-shadow" />
                    </div>
                  </button>

                  <div className="flex-1 min-w-0 pr-6">
                    <div className="flex items-center space-x-2 text-[11px] text-indigo-400 font-medium flex-wrap gap-y-1">
                      <span>{proposal.product.brand}</span>
                      <span>•</span>
                      <span className="text-slate-400 truncate">
                        Sold by {proposal.product.seller}
                      </span>
                      <span>•</span>
                      <span className="inline-flex items-center space-x-1 text-[10px] font-bold text-amber-300 bg-amber-500/15 border border-amber-500/30 px-2 py-0.5 rounded-full">
                        <Building2 className="w-3 h-3 text-amber-400" />
                        <span>Derived from: <strong>{getStoreInfo(proposal.product).storeName}</strong></span>
                      </span>
                    </div>

                    {proposal.product.model && (
                      <div className="text-[10px] font-mono text-slate-400 mt-0.5">
                        Model:{" "}
                        <span className="text-indigo-300 font-semibold">
                          {proposal.product.model}
                        </span>
                      </div>
                    )}

                    <h3
                      onClick={() =>
                        setSelectedProductForDetails(mapProposalToDetail(proposal))
                      }
                      className="text-sm font-bold text-white mt-1 leading-snug line-clamp-2 hover:text-indigo-300 transition-colors cursor-pointer"
                      title="Click to inspect full product specifications"
                      id="recommendation-title-button"
                    >
                      {proposal.product.title}
                    </h3>

                    <div className="flex items-center space-x-3 mt-2 text-xs flex-wrap gap-y-1">
                      <span className="flex items-center text-amber-400 font-semibold">
                        <Star className="w-3.5 h-3.5 fill-amber-400 mr-1" />
                        {proposal.product.rating}
                        <span className="text-slate-500 font-normal ml-1">
                          ({proposal.product.reviewCount.toLocaleString()})
                        </span>
                      </span>
                      <span className="flex items-center text-slate-300">
                        <Truck className="w-3.5 h-3.5 text-indigo-400 mr-1" />
                        {proposal.product.deliveryDays} business day(s)
                      </span>
                      <div className="flex items-center space-x-2 ml-auto">
                        <a
                          href={getResolvedExternalUrl(proposal.product)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center space-x-1 text-[11px] font-bold text-amber-300 bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 px-2.5 py-1 rounded-lg transition-all cursor-pointer shadow-sm"
                          title={`Open product directly on ${getStoreInfo(proposal.product).brandName} in a new tab`}
                          id="recommendation-direct-external-link"
                        >
                          <span>Open on {getStoreInfo(proposal.product).brandName}</span>
                          <ExternalLink className="w-3 h-3 text-amber-400" />
                        </a>

                        <button
                          type="button"
                          onClick={() =>
                            setSelectedProductForDetails(
                              mapProposalToDetail(proposal)
                            )
                          }
                          className="text-[11px] font-semibold text-indigo-400 hover:text-indigo-300 flex items-center space-x-1 cursor-pointer bg-slate-800/80 hover:bg-slate-700/80 px-2.5 py-1 rounded-lg border border-slate-700/60 transition-all"
                          id="recommendation-view-details-link"
                        >
                          <Eye className="w-3 h-3" />
                          <span>Specs</span>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Landed Cost Breakdown */}
                <div className="mt-4 pt-4 border-t border-slate-800 grid grid-cols-4 gap-2 text-center bg-slate-950/70 p-3 rounded-xl">
                  <div>
                    <span className="text-[10px] text-slate-500 uppercase font-medium block">Item</span>
                    <span className="font-mono text-xs font-semibold text-slate-300">
                      ${proposal.priceBreakdown.itemPrice.toFixed(2)}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-500 uppercase font-medium block">Shipping</span>
                    <span className="font-mono text-xs font-semibold text-slate-300">
                      {proposal.priceBreakdown.shippingCost === 0
                        ? "FREE"
                        : `$${proposal.priceBreakdown.shippingCost.toFixed(2)}`}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-500 uppercase font-medium block">Est. Tax</span>
                    <span className="font-mono text-xs font-semibold text-slate-300">
                      ${proposal.priceBreakdown.estimatedTax.toFixed(2)}
                    </span>
                  </div>
                  <div className="bg-emerald-500/10 rounded-lg py-0.5 border border-emerald-500/20">
                    <span className="text-[10px] text-emerald-400 uppercase font-bold block">Total</span>
                    <span className="font-mono text-xs font-bold text-emerald-300">
                      ${proposal.priceBreakdown.totalCost.toFixed(2)}
                    </span>
                  </div>
                </div>

                {/* Constraint Compliance Badges */}
                <div className="mt-3 flex flex-wrap gap-1.5">
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                    <CheckCircle2 className="w-3 h-3 mr-1" />
                    Within Budget (${proposal.priceBreakdown.totalCost.toFixed(2)} ≤ $
                    {proposal.constraintsSnapshot.maxBudget.toFixed(2)})
                  </span>
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                    <CheckCircle2 className="w-3 h-3 mr-1" />
                    Delivery {proposal.product.deliveryDays}d ≤ {proposal.constraintsSnapshot.maxDeliveryDays}d
                  </span>
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                    <CheckCircle2 className="w-3 h-3 mr-1" />
                    Rating {proposal.product.rating}★ ≥ {proposal.constraintsSnapshot.minRating}★
                  </span>
                </div>

                {/* Reasoning Box */}
                {reasoning && (
                  <div className="mt-4 p-3 rounded-xl bg-slate-950/60 border border-slate-800 text-xs space-y-2">
                    <div className="flex items-center space-x-1.5 text-indigo-300 font-semibold">
                      <Zap className="w-3.5 h-3.5" />
                      <span>{reasoning.headline}</span>
                    </div>
                    <p className="text-slate-300 leading-relaxed text-[11px]">{reasoning.explanation}</p>
                    <div className="pt-2 border-t border-slate-800/80">
                      <span className="text-[10px] uppercase font-semibold text-slate-500 block mb-1">
                        Agent Rationale:
                      </span>
                      <ul className="space-y-1 text-[11px] text-slate-400">
                        {reasoning.pros.map((pro, i) => (
                          <li key={i} className="flex items-start">
                            <span className="text-emerald-400 mr-1.5">•</span>
                            <span>{pro}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                )}
              </div>

              {/* Review-Before-Purchase Area / Verified Receipt */}
              {receipt ? (
                <div className="rounded-2xl bg-slate-900/90 border border-emerald-500/40 p-5 space-y-4 shadow-xl shadow-emerald-950/20">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center space-x-3">
                      <div className="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center">
                        <CheckCircle2 className="w-6 h-6 text-emerald-400" />
                      </div>
                      <div>
                        <div className="flex items-center space-x-2">
                          <h4 className="text-sm font-bold text-white">Payment Successful</h4>
                          <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                            CAPTURED
                          </span>
                          <span className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded border ${
                            receipt.isSimulated || receipt.paypalOrderId.startsWith("SANDBOX-ORD-")
                              ? "bg-amber-500/20 text-amber-300 border-amber-500/30"
                              : "bg-indigo-500/20 text-indigo-300 border-indigo-500/30"
                          }`}>
                            {receipt.isSimulated || receipt.paypalOrderId.startsWith("SANDBOX-ORD-")
                              ? "Simulated Demo Sandbox"
                              : "Live PayPal Sandbox"}
                          </span>
                        </div>
                        <p className="text-xs text-slate-400 mt-0.5">
                          {receipt.isSimulated || receipt.paypalOrderId.startsWith("SANDBOX-ORD-")
                            ? "Simulated buyer approval captured with server-side guardrail audit."
                            : "Live PayPal Sandbox Orders API v2 capture verified."}
                        </p>
                      </div>
                    </div>
                    <Receipt className="w-5 h-5 text-emerald-400/70" />
                  </div>

                  {/* Receipt Details Box */}
                  <div className="bg-slate-950/80 rounded-xl border border-slate-800 p-4 space-y-3 text-xs">
                    <div className="flex items-center justify-between pb-2 border-b border-slate-800/80">
                      <div>
                        <span className="text-[10px] uppercase text-slate-500 font-semibold block">Item</span>
                        <span className="font-semibold text-slate-200 line-clamp-1">{receipt.productTitle}</span>
                      </div>
                      <div className="text-right">
                        <span className="text-[10px] uppercase text-slate-500 font-semibold block">Mock Seller</span>
                        <span className="text-indigo-400 font-medium">{receipt.sellerName}</span>
                      </div>
                    </div>

                    {/* Financial Breakdown */}
                    <div className="grid grid-cols-4 gap-2 text-center bg-slate-900/60 p-2.5 rounded-lg text-[11px]">
                      <div>
                        <span className="text-[9px] text-slate-500 uppercase block">Item</span>
                        <span className="font-mono text-slate-300 font-semibold">
                          ${receipt.breakdown.itemPrice.toFixed(2)}
                        </span>
                      </div>
                      <div>
                        <span className="text-[9px] text-slate-500 uppercase block">Shipping</span>
                        <span className="font-mono text-slate-300 font-semibold">
                          {receipt.breakdown.shippingCost === 0 ? "FREE" : `$${receipt.breakdown.shippingCost.toFixed(2)}`}
                        </span>
                      </div>
                      <div>
                        <span className="text-[9px] text-slate-500 uppercase block">Est. Tax</span>
                        <span className="font-mono text-slate-300 font-semibold">
                          ${receipt.breakdown.estimatedTax.toFixed(2)}
                        </span>
                      </div>
                      <div className="bg-emerald-500/15 rounded py-0.5 border border-emerald-500/25">
                        <span className="text-[9px] text-emerald-400 font-bold uppercase block">Total Paid</span>
                        <span className="font-mono text-emerald-300 font-bold">
                          ${receipt.amount.toFixed(2)} {receipt.currency}
                        </span>
                      </div>
                    </div>

                    {/* Transaction Identifiers */}
                    <div className="space-y-1.5 pt-1 text-[11px] font-mono">
                      <div className="flex justify-between text-slate-400">
                        <span className="text-slate-500 font-sans">Receipt ID:</span>
                        <span className="text-slate-300 select-all">{receipt.receiptId}</span>
                      </div>
                      <div className="flex justify-between text-slate-400">
                        <span className="text-slate-500 font-sans">PayPal Order ID:</span>
                        <span className="text-indigo-300 select-all">{receipt.paypalOrderId}</span>
                      </div>
                      <div className="flex justify-between text-slate-400">
                        <span className="text-slate-500 font-sans">Capture ID:</span>
                        <span className="text-emerald-300 select-all">{receipt.captureId}</span>
                      </div>
                      <div className="flex justify-between text-slate-400">
                        <span className="text-slate-500 font-sans">Timestamp:</span>
                        <span className="text-slate-300">{new Date(receipt.capturedAt).toLocaleString()}</span>
                      </div>
                    </div>
                  </div>

                  {/* Audit / Non-Sensitive Confirmation */}
                  <div className="text-[11px] text-slate-500 bg-slate-950/40 p-2.5 rounded-lg border border-slate-900 flex items-center justify-between">
                    <span className="flex items-center">
                      <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 mr-1.5 shrink-0" />
                      No sensitive card credentials stored • Orders API v2
                    </span>
                    <span className="text-[10px] text-slate-400">Single-Vendor Demo</span>
                  </div>

                  <button
                    type="button"
                    onClick={handleResetSearch}
                    className="w-full py-2.5 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold flex items-center justify-center space-x-2 transition-all cursor-pointer shadow-md shadow-indigo-600/20"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Start New Shopping Search</span>
                  </button>
                </div>
              ) : (
                <div className="rounded-2xl bg-slate-900/90 border border-slate-800 p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <ShieldCheck className="w-4 h-4 text-emerald-400" />
                      <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-200">
                        Pre-Purchase Review & Verification
                      </h4>
                    </div>
                    <span className="text-[10px] font-mono text-slate-400 flex items-center">
                      <Clock className="w-3 h-3 mr-1" /> Expires in 15m
                    </span>
                  </div>

                  {/* Detailed Selected Product Summary for Buyer Verification */}
                  <div className="p-3.5 rounded-xl bg-slate-950/80 border border-slate-800 space-y-3">
                    <div className="flex items-start space-x-3">
                      <div className="w-16 h-16 rounded-lg bg-slate-900 border border-slate-800 overflow-hidden shrink-0 flex items-center justify-center">
                        <ProductThumbnail
                          src={proposal.product.imageUrl}
                          alt={proposal.product.title}
                          category={proposal.product.category}
                          productId={proposal.product.id}
                          className="w-full h-full object-cover"
                        />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center space-x-1.5 text-[10px] text-indigo-400 font-semibold uppercase flex-wrap gap-y-1">
                          <span>{proposal.product.brand}</span>
                          <span className="text-slate-600">•</span>
                          <span className="text-slate-400 font-normal truncate">
                            Sold by {proposal.product.seller}
                          </span>
                          <span className="text-slate-600">•</span>
                          <span className="text-amber-300 font-bold lowercase first-letter:uppercase">
                            {getStoreInfo(proposal.product).storeName}
                          </span>
                        </div>
                        <h4 className="text-xs font-bold text-slate-100 mt-0.5 line-clamp-1">
                          {proposal.product.title}
                        </h4>
                        <div className="flex items-center space-x-2 text-[10px] text-slate-400 mt-1 flex-wrap gap-1">
                          {proposal.product.model && (
                            <span className="bg-indigo-950/50 text-indigo-300 px-1.5 py-0.2 rounded border border-indigo-500/20 font-mono">
                              Model: {proposal.product.model}
                            </span>
                          )}
                          <span className="text-indigo-400">
                            {proposal.product.deliveryDays}d delivery
                          </span>
                          <span className="text-slate-600">•</span>
                          <span className="text-amber-400 font-medium">
                            {proposal.product.rating}★ ({proposal.product.reviewCount.toLocaleString()})
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Landed Cost Breakdown */}
                    <div className="grid grid-cols-4 gap-2 text-center text-[11px] bg-slate-900/60 p-2.5 rounded-lg border border-slate-800/60">
                      <div>
                        <span className="text-[9px] text-slate-500 uppercase block font-medium">
                          Item
                        </span>
                        <span className="font-mono text-slate-300 font-semibold">
                          ${proposal.priceBreakdown.itemPrice.toFixed(2)}
                        </span>
                      </div>
                      <div>
                        <span className="text-[9px] text-slate-500 uppercase block font-medium">
                          Shipping
                        </span>
                        <span className="font-mono text-slate-300 font-semibold">
                          {proposal.priceBreakdown.shippingCost === 0
                            ? "FREE"
                            : `$${proposal.priceBreakdown.shippingCost.toFixed(2)}`}
                        </span>
                      </div>
                      <div>
                        <span className="text-[9px] text-slate-500 uppercase block font-medium">
                          Est. Tax
                        </span>
                        <span className="font-mono text-slate-300 font-semibold">
                          ${proposal.priceBreakdown.estimatedTax.toFixed(2)}
                        </span>
                      </div>
                      <div className="bg-emerald-500/10 rounded py-0.5 border border-emerald-500/20">
                        <span className="text-[9px] text-emerald-400 uppercase font-bold block">
                          Landed Total
                        </span>
                        <span className="font-mono text-emerald-300 font-bold">
                          ${proposal.priceBreakdown.totalCost.toFixed(2)}
                        </span>
                      </div>
                    </div>

                    {/* Listing Link & Inspection Bar */}
                    <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-slate-800/80 text-xs">
                      {(() => {
                        const reviewStore = getStoreInfo(proposal.product);
                        const reviewUrl = getResolvedExternalUrl(proposal.product);
                        return (
                          <div className="flex items-center space-x-2 flex-wrap gap-1">
                            <span className="inline-flex items-center space-x-1 text-[10px] font-bold text-amber-300 bg-amber-500/15 border border-amber-500/30 px-2 py-0.5 rounded-full">
                              <Building2 className="w-3 h-3 text-amber-400" />
                              <span>{reviewStore.storeName}</span>
                            </span>
                            <a
                              href={reviewUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[11px] font-bold text-indigo-400 hover:text-indigo-300 flex items-center space-x-1 transition-colors ml-1"
                              id="review-external-link"
                              title={`Verify and open original listing on ${reviewStore.brandName}`}
                            >
                              <span>Open on {reviewStore.brandName}</span>
                              <ExternalLink className="w-3.5 h-3.5" />
                            </a>
                          </div>
                        );
                      })()}

                      <button
                        type="button"
                        onClick={() =>
                          setSelectedProductForDetails(mapProposalToDetail(proposal))
                        }
                        className="text-[11px] text-slate-300 hover:text-white font-medium flex items-center space-x-1 cursor-pointer bg-slate-800/80 hover:bg-slate-700/80 px-2.5 py-1 rounded-lg border border-slate-700/60 transition-all ml-auto"
                        id="review-inspect-details-button"
                      >
                        <Eye className="w-3.5 h-3.5 text-indigo-400" />
                        <span>Inspect Full Specs</span>
                      </button>
                    </div>
                  </div>

                  <p className="text-xs text-slate-400 leading-relaxed">
                    Explicit buyer approval is strictly required. Approving locks this server-authoritative proposal (${proposal.priceBreakdown.totalCost.toFixed(2)} USD) for PayPal Sandbox checkout. You will not be charged automatically.
                  </p>

                  {/* Buyer Decision Controls */}
                  <div className="pt-1 flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
                    <button
                      type="button"
                      onClick={handleVerifyProposal}
                      disabled={
                        verificationStatus === "verifying" ||
                        verificationStatus === "verified"
                      }
                      className="flex-1 py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-600/50 text-white text-xs font-bold transition-all shadow-md shadow-emerald-600/20 flex items-center justify-center space-x-2 cursor-pointer disabled:cursor-default"
                      id="approve-proposal-button"
                    >
                      {verificationStatus === "verifying" ? (
                        <>
                          <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                          <span>Verifying Proposal...</span>
                        </>
                      ) : verificationStatus === "verified" ? (
                        <>
                          <CheckCircle2 className="w-4 h-4 text-white" />
                          <span>Proposal Approved & Locked</span>
                        </>
                      ) : (
                        <>
                          <ShieldCheck className="w-4 h-4" />
                          <span>Approve & Lock Proposal</span>
                        </>
                      )}
                    </button>

                    {verificationStatus !== "verified" && (
                      <button
                        type="button"
                        onClick={handleResetSearch}
                        className="px-3.5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition-all cursor-pointer text-center"
                      >
                        Cancel / Change Query
                      </button>
                    )}

                    {verificationStatus === "verified" && (
                      <button
                        type="button"
                        onClick={() => setVerificationStatus(null)}
                        className="px-3.5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition-all cursor-pointer text-center"
                      >
                        Unlock & Go Back
                      </button>
                    )}

                    <div className="px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-[11px] text-slate-400 text-center font-mono">
                      ID: {proposal.id.substring(0, 10)}
                    </div>
                  </div>

                  {/* Verification Failure Notice */}
                  {verificationStatus === "failed" && verificationError && (
                    <div className="mt-3 p-3 rounded-xl bg-rose-950/40 border border-rose-500/30 text-rose-300 text-xs">
                      <p className="font-semibold text-rose-200">Proposal Verification Rejected</p>
                      <p className="mt-0.5 text-[11px] leading-relaxed">{verificationError}</p>
                    </div>
                  )}

                  {/* PayPal Sandbox Checkout Area */}
                  {verificationStatus === "verified" && (
                    <div className="mt-4 p-4 rounded-xl bg-slate-950/80 border border-indigo-500/30 space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-2">
                          <CreditCard className="w-4 h-4 text-indigo-400" />
                          <span className="text-xs font-bold text-slate-200 uppercase tracking-wider">
                            PayPal Sandbox Checkout
                          </span>
                        </div>
                        <span className="text-[10px] font-mono text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                          Total: ${proposal.priceBreakdown.totalCost.toFixed(2)} USD
                        </span>
                      </div>

                      {/* Scope & Notice Banner */}
                      <div className="p-2.5 rounded-lg bg-indigo-950/30 border border-indigo-500/20 text-[11px] text-slate-300 space-y-1">
                        <p className="font-medium text-indigo-300">
                          Single-Product Sandbox Checkout (USD)
                        </p>
                        <p className="text-slate-400 text-[10px] leading-relaxed">
                          Mock seller: <strong className="text-slate-200">{proposal.product.seller}</strong>. Catalog, shipping, and tax are simulated demo data. Clicking PayPal initiates a Sandbox payment flow. Explicit buyer approval is strictly required.
                        </p>
                      </div>

                      {/* Expiration or Completion Check */}
                      {isProposalExpired ? (
                        <div className="p-3 rounded-xl bg-rose-950/30 border border-rose-500/30 text-rose-300 text-xs flex items-center justify-between">
                          <div className="flex items-center space-x-2">
                            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                            <span>This proposal has expired (15m window). Please refresh the search.</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleStartRun()}
                            className="px-2.5 py-1 rounded-lg bg-rose-900/60 hover:bg-rose-800 border border-rose-500/40 text-[11px] font-semibold text-rose-100 transition-all cursor-pointer shrink-0 ml-2"
                          >
                            Re-run Research
                          </button>
                        </div>
                      ) : proposal.status === "COMPLETED" ? (
                        <div className="p-3 rounded-lg bg-amber-950/30 border border-amber-500/30 text-amber-300 text-xs flex items-center space-x-2">
                          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                          <span>This proposal has already been completed.</span>
                        </div>
                      ) : (
                        <div className="space-y-3 pt-1">
                          {/* Official PayPal Buttons Container */}
                          <div className="rounded-xl overflow-hidden min-h-[45px] bg-slate-900/50 p-2 border border-slate-800">
                            <PayPalScriptProvider
                              options={{
                                clientId: process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID || "test",
                                currency: "USD",
                                intent: "capture",
                                components: "buttons",
                              }}
                            >
                              <PayPalButtons
                                style={{
                                  layout: "vertical",
                                  color: "gold",
                                  shape: "rect",
                                  height: 40,
                                  tagline: false,
                                }}
                                disabled={isCapturing || isCreatingOrder}
                                createOrder={async () => {
                                  setIsCreatingOrder(true);
                                  setCheckoutError(null);
                                  try {
                                    const idempotencyKey = `idem_${proposal.id}_${Date.now()}`;
                                    const res = await fetch("/api/paypal/create-order", {
                                      method: "POST",
                                      headers: { "Content-Type": "application/json" },
                                      body: JSON.stringify({
                                        proposalId: proposal.id,
                                        idempotencyKey,
                                      }),
                                    });
                                    const data = await res.json();
                                    if (!res.ok || !data.success) {
                                      throw new Error(data.error || "Failed to create PayPal order");
                                    }
                                    setCheckoutSessionId(data.checkoutSessionId);
                                    return data.orderId || data.paypalOrderId;
                                  } catch (err) {
                                    const msg = err instanceof Error ? err.message : "Failed creating order";
                                    setCheckoutError(msg);
                                    throw err;
                                  } finally {
                                    setIsCreatingOrder(false);
                                  }
                                }}
                                onApprove={async (data) => {
                                  setIsCapturing(true);
                                  setCheckoutError(null);
                                  try {
                                    const res = await fetch("/api/paypal/capture-order", {
                                      method: "POST",
                                      headers: { "Content-Type": "application/json" },
                                      body: JSON.stringify({
                                        paypalOrderId: data.orderID,
                                        checkoutSessionId: checkoutSessionId || undefined,
                                        idempotencyKey: `cap_${data.orderID}`,
                                      }),
                                    });
                                    const captureData = await res.json();
                                    if (!res.ok || !captureData.success) {
                                      throw new Error(captureData.error || "Capture failed");
                                    }
                                    setReceipt(captureData.receipt);
                                    setProposal((prev) => (prev ? { ...prev, status: "COMPLETED" } : null));
                                  } catch (err) {
                                    setCheckoutError(err instanceof Error ? err.message : "Capture failed");
                                  } finally {
                                    setIsCapturing(false);
                                  }
                                }}
                                onError={(err) => {
                                  console.warn("[PayPal Buttons Error]:", err);
                                  setCheckoutError("PayPal checkout returned an error or pop-up was closed. You can also use the direct sandbox simulation below.");
                                }}
                                onCancel={() => {
                                  setCheckoutError("PayPal checkout was cancelled by the buyer. No payment captured.");
                                }}
                              />
                            </PayPalScriptProvider>
                          </div>

                          {/* Sandbox Simulation Button */}
                          <div className="pt-2 border-t border-slate-800">
                            <div className="flex items-center justify-between mb-1.5">
                              <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">
                                Demo Test Sandbox Simulation
                              </span>
                              <span className="text-[10px] font-mono text-amber-400">Local / Hackathon</span>
                            </div>
                            <button
                              type="button"
                              disabled={isCapturing || isCreatingOrder}
                              onClick={handleDirectSandboxCheckout}
                              className="w-full py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-700/80 border border-slate-700 text-slate-200 text-xs font-semibold flex items-center justify-center space-x-2 transition-all cursor-pointer shadow-sm hover:text-white disabled:opacity-50"
                            >
                              {isCapturing ? (
                                <>
                                  <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                  <span>Capturing Sandbox Payment...</span>
                                </>
                              ) : (
                                <>
                                  <CreditCard className="w-4 h-4 text-emerald-400" />
                                  <span>Simulate Buyer Sandbox Approval & Capture</span>
                                </>
                              )}
                            </button>
                            <p className="text-[10px] text-slate-500 mt-1 text-center">
                              Executes server-side `/api/paypal/create-order` and `/api/paypal/capture-order` with full guardrail validation.
                            </p>
                          </div>
                        </div>
                      )}

                      {/* Checkout Error Message */}
                      {checkoutError && (
                        <div className="p-3 rounded-lg bg-rose-950/40 border border-rose-500/30 text-rose-300 text-xs">
                          <div className="flex items-center space-x-1.5 font-semibold text-rose-200">
                            <ShieldAlert className="w-3.5 h-3.5" />
                            <span>Checkout Alert</span>
                          </div>
                          <p className="mt-1 text-[11px] leading-relaxed">{checkoutError}</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Disqualified Candidates Audit Box */}
              {disqualifiedCandidates.length > 0 && (
                <div className="rounded-2xl bg-rose-950/20 border border-rose-500/30 p-4 space-y-2.5 shadow-sm">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2 text-xs font-semibold uppercase text-rose-300">
                      <ShieldAlert className="w-3.5 h-3.5 text-rose-400" />
                      <span>Guardrail Audit: Disqualified Candidates ({disqualifiedCandidates.length})</span>
                    </div>
                    <span className="text-[10px] font-mono text-rose-400 bg-rose-500/10 px-2 py-0.5 rounded border border-rose-500/20">
                      Hard Limits Enforced
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    The following products matched search keywords but were <strong className="text-rose-300">disqualified by the Guardrail Engine</strong> because their complete landed cost (including shipping & estimated sales tax) or delivery time violated your hard limits.
                  </p>
                  <div className="space-y-2 pt-1">
                    {disqualifiedCandidates.map((disq, idx) => (
                      <div
                        key={idx}
                        onClick={() =>
                          setSelectedProductForDetails(mapDisqualifiedToDetail(disq))
                        }
                        className="bg-slate-950/80 border border-rose-500/20 hover:border-rose-500/50 rounded-xl p-3 text-xs space-y-1.5 transition-all cursor-pointer group"
                        title="Click to view detailed specs & guardrail failure analysis"
                      >
                        <div className="flex items-start justify-between space-x-3">
                          <div className="w-10 h-10 rounded-lg bg-slate-900 border border-slate-800 overflow-hidden shrink-0 flex items-center justify-center">
                            <ProductThumbnail
                              src={disq.product.imageUrl}
                              alt={disq.product.title}
                              category={disq.product.category}
                              productId={disq.product.id}
                              className="w-full h-full object-cover"
                            />
                          </div>
                          <div className="min-w-0 flex-1">
                            <span className="font-semibold text-slate-200 block truncate group-hover:text-rose-300 transition-colors">
                              {disq.product.title}
                            </span>
                            <div className="flex items-center space-x-2 text-[10px] text-slate-400 mt-0.5 flex-wrap">
                              <span>{disq.product.brand}</span>
                              <span>•</span>
                              <span className="text-amber-300 font-semibold">{getStoreInfo(disq.product).storeName}</span>
                              <span>•</span>
                              <span>
                                Sticker: $
                                {(
                                  disq.pricing.itemPrice ||
                                  (disq.product.priceCents
                                    ? disq.product.priceCents / 100
                                    : 0)
                                ).toFixed(2)}
                              </span>
                              <span>•</span>
                              <span className="text-amber-300">
                                Shipping: $
                                {(
                                  disq.pricing.shippingCost ||
                                  (disq.product.shippingFeeCents
                                    ? disq.product.shippingFeeCents / 100
                                    : 0)
                                ).toFixed(2)}
                              </span>
                              <span>•</span>
                              <span>{disq.product.deliveryDays}d delivery</span>
                            </div>
                          </div>
                          <div className="text-right shrink-0 flex flex-col items-end space-y-1">
                            <div>
                              <span className="font-mono font-bold text-rose-400">
                                ${disq.pricing.totalCost.toFixed(2)}
                              </span>
                              <span className="block text-[9px] text-rose-500 font-semibold uppercase">
                                Landed Total
                              </span>
                            </div>
                            <a
                              href={getResolvedExternalUrl(disq.product)}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="text-[10px] font-semibold text-indigo-400 hover:text-indigo-300 flex items-center space-x-0.5"
                              title={`Open listing on ${getStoreInfo(disq.product).brandName}`}
                            >
                              <span>{getStoreInfo(disq.product).brandName}</span>
                              <ExternalLink className="w-2.5 h-2.5" />
                            </a>
                          </div>
                        </div>
                        <div className="text-[11px] text-rose-300 bg-rose-950/40 px-2.5 py-1.5 rounded-lg border border-rose-500/20 flex items-start space-x-1.5">
                          <AlertTriangle className="w-3.5 h-3.5 text-rose-400 shrink-0 mt-0.5" />
                          <span>{disq.reasons.join(". ")}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Alternative Matches */}
              {alternatives.length > 0 && (
                <div className="rounded-2xl bg-slate-900/60 border border-slate-800/80 p-4 space-y-2.5">
                  <div className="flex items-center space-x-2 text-xs font-semibold uppercase text-slate-400">
                    <Layers className="w-3.5 h-3.5" />
                    <span>Compliant Alternative Options Evaluated ({alternatives.length})</span>
                  </div>
                  <div className="space-y-2">
                    {alternatives.map((alt, idx) => (
                      <div
                        key={idx}
                        onClick={() =>
                          setSelectedProductForDetails(mapAlternativeToDetail(alt))
                        }
                        className="bg-slate-950/60 border border-slate-800/60 hover:border-indigo-500/50 rounded-xl p-3 flex items-center justify-between text-xs transition-all cursor-pointer group"
                        title="Click to view full specifications & merchant listing"
                      >
                        <div className="flex items-center space-x-3 min-w-0 pr-3">
                          <div className="w-10 h-10 rounded-lg bg-slate-900 border border-slate-800 overflow-hidden shrink-0 flex items-center justify-center">
                            <ProductThumbnail
                              src={alt.product.imageUrl}
                              alt={alt.product.title}
                              category={alt.product.category}
                              productId={alt.product.id}
                              className="w-full h-full object-cover"
                            />
                          </div>
                          <div className="min-w-0">
                            <p className="font-semibold text-slate-200 truncate group-hover:text-indigo-300 transition-colors">
                              {alt.product.title}
                            </p>
                            <div className="flex items-center space-x-2 text-[10px] text-slate-500 mt-0.5 flex-wrap">
                              <span>{alt.product.brand}</span>
                              <span>•</span>
                              <span className="text-amber-300 font-semibold">{getStoreInfo(alt.product).storeName}</span>
                              <span>•</span>
                              <span>{alt.product.deliveryDays}d delivery</span>
                              <span>•</span>
                              <span className="text-amber-400">{alt.product.rating}★</span>
                            </div>
                          </div>
                        </div>
                        <div className="text-right shrink-0 flex flex-col items-end space-y-1">
                          <div>
                            <span className="font-mono font-bold text-slate-200">
                              ${alt.breakdown.totalCost.toFixed(2)}
                            </span>
                            <span className="block text-[10px] text-slate-500">all-in total</span>
                          </div>
                          <a
                            href={getResolvedExternalUrl(alt.product)}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="text-[10px] font-semibold text-indigo-400 hover:text-indigo-300 flex items-center space-x-0.5"
                            title={`Open listing on ${getStoreInfo(alt.product).brandName}`}
                          >
                            <span>{getStoreInfo(alt.product).brandName}</span>
                            <ExternalLink className="w-2.5 h-2.5" />
                          </a>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </section>

        {/* Right Column: Agent Activity Stream (3 cols) */}
        <section className="lg:col-span-3 flex flex-col space-y-4">
          <div className="rounded-2xl bg-slate-900/80 border border-slate-800/80 p-4 h-full flex flex-col shadow-sm">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center space-x-2">
                <span className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse" />
                <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-300">
                  Agent Activity Stream
                </h2>
              </div>
              <span className="text-[10px] text-slate-500 font-mono">
                {events.length} event{events.length === 1 ? "" : "s"}
              </span>
            </div>

            <div className="flex-1 overflow-y-auto space-y-3 py-3 pr-1 max-h-[640px]">
              {events.length === 0 ? (
                <div className="text-center py-12 text-slate-500 text-xs">
                  <Bot className="w-6 h-6 mx-auto mb-2 text-slate-600" />
                  <p>Awaiting search trigger.</p>
                  <p className="text-[10px] text-slate-600 mt-1">Live agent stages and logs will stream here.</p>
                </div>
              ) : (
                events.map((evt) => {
                  const isComplete = evt.eventType === "COMPLETE";
                  const isError = evt.eventType === "ERROR";
                  const isToolCall = evt.stage === "TOOL_CALL";
                  const isToolResult = evt.stage === "TOOL_RESULT";
                  const isCompare = evt.stage === "COMPARE_PRODUCTS";
                  const isData = evt.eventType === "DATA" && !isToolResult && !isCompare;

                  return (
                    <div
                      key={evt.id}
                      className={`text-xs p-3 rounded-xl border transition-all ${
                        isComplete
                          ? "bg-emerald-950/30 border-emerald-500/30 text-emerald-200"
                          : isError
                          ? "bg-rose-950/30 border-rose-500/30 text-rose-200"
                          : isToolCall
                          ? "bg-purple-950/30 border-purple-500/40 text-purple-200"
                          : isToolResult
                          ? "bg-cyan-950/25 border-cyan-500/30 text-cyan-200"
                          : isCompare
                          ? "bg-amber-950/25 border-amber-500/30 text-amber-200"
                          : isData
                          ? "bg-indigo-950/20 border-indigo-500/20 text-slate-200"
                          : "bg-slate-950/60 border-slate-800/60 text-slate-300"
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span
                          className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded flex items-center space-x-1 ${
                            isComplete
                              ? "bg-emerald-500/20 text-emerald-400"
                              : isError
                              ? "bg-rose-500/20 text-rose-400"
                              : isToolCall
                              ? "bg-purple-500/25 text-purple-300 border border-purple-500/30"
                              : isToolResult
                              ? "bg-cyan-500/25 text-cyan-300"
                              : isCompare
                              ? "bg-amber-500/20 text-amber-300"
                              : isData
                              ? "bg-indigo-500/20 text-indigo-400"
                              : "bg-slate-800 text-slate-400"
                          }`}
                        >
                          {isToolCall && <Terminal className="w-2.5 h-2.5 mr-1" />}
                          <span>{evt.stage}</span>
                        </span>
                        <div className="flex items-center space-x-1.5">
                          {typeof evt.payload?.durationMs === "number" && (
                            <span className="text-[9px] font-mono text-cyan-400 bg-cyan-950/60 px-1 rounded">
                              {evt.payload.durationMs}ms
                            </span>
                          )}
                          <span className="text-[9px] font-mono text-slate-500">
                            {new Date(evt.createdAt).toLocaleTimeString()}
                          </span>
                        </div>
                      </div>
                      <p className="text-[11px] leading-relaxed text-slate-300">{evt.message}</p>
                    </div>
                  );
                })
              )}
            </div>

            <div className="pt-3 border-t border-slate-800/80 text-[10px] text-slate-500 flex items-center justify-between">
              <span>
                Status:{" "}
                {isStreaming
                  ? "Streaming SSE pipeline"
                  : isRunning
                  ? "Running"
                  : proposal
                  ? "Completed"
                  : "Idle"}
              </span>
              <span className={`font-mono ${isStreaming ? "text-emerald-400 font-semibold" : ""}`}>
                {isStreaming ? "SSE Live" : "SSE Ready"}
              </span>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-900 bg-slate-950 px-6 py-4 text-center text-xs text-slate-600">
        <p>
          AgentCart AI • Built for the PayPal AI Hackathon • Demonstrating Verifiable Landed Costs &
          Deterministic Guardrails
        </p>
      </footer>

      {/* CATALOG EXPLORER MODAL */}
      {showCatalogModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-4xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden">
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center space-x-2.5">
                <Store className="w-5 h-5 text-indigo-400" />
                <div>
                  <h3 className="text-sm font-bold text-white">Simulated Multi-Vendor Demo Catalog</h3>
                  <p className="text-[11px] text-slate-400">
                    Realistic mock catalog across 5 categories with simulated merchant and logistics data.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowCatalogModal(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Category Filter Tabs */}
            <div className="px-6 py-3 border-b border-slate-800/80 flex items-center space-x-2 overflow-x-auto bg-slate-950/40">
              {["all", "headphones", "keyboards", "electronics", "accessories", "home-office"].map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={async () => {
                    setCatalogCategoryFilter(cat);
                    setCatalogLoading(true);
                    try {
                      const res = await fetch(
                        `/api/catalog?category=${cat === "all" ? "" : cat}&inStockOnly=false`
                      );
                      const data = await res.json();
                      if (data.products) setCatalogItems(data.products);
                    } finally {
                      setCatalogLoading(false);
                    }
                  }}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold capitalize transition-all cursor-pointer whitespace-nowrap ${
                    catalogCategoryFilter === cat
                      ? "bg-indigo-600 text-white shadow-sm"
                      : "bg-slate-850 text-slate-400 hover:text-white hover:bg-slate-800"
                  }`}
                >
                  {cat === "all" ? "All Categories" : cat}
                </button>
              ))}
            </div>

            {/* Products Grid */}
            <div className="flex-1 overflow-y-auto p-6">
              {catalogLoading ? (
                <div className="py-20 text-center text-slate-400 text-xs flex flex-col items-center justify-center space-y-2">
                  <span className="w-5 h-5 border-2 border-indigo-400/30 border-t-indigo-400 rounded-full animate-spin" />
                  <span>Loading mock catalog items...</span>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {catalogItems.map((item) => (
                    <div
                      key={item.id}
                      className="bg-slate-950/70 border border-slate-800 hover:border-slate-700 rounded-xl p-4 flex flex-col justify-between space-y-3 transition-all"
                    >
                      <div className="flex items-start space-x-3">
                        <div
                          onClick={() =>
                            setSelectedProductForDetails(mapCatalogItemToDetail(item))
                          }
                          className="w-16 h-16 rounded-lg bg-slate-900 border border-slate-800 hover:border-indigo-500/60 overflow-hidden shrink-0 cursor-pointer transition-colors"
                          title="Click to inspect full product specifications"
                        >
                          <ProductThumbnail
                            src={item.imageUrl}
                            alt={item.title}
                            category={item.category}
                            productId={item.id}
                            className="w-full h-full object-cover hover:scale-105 transition-transform"
                          />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center space-x-1.5 text-[10px]">
                            <span className="text-indigo-400 font-bold uppercase">
                              {item.brand}
                            </span>
                            <span className="text-slate-600">•</span>
                            <span className="text-slate-400 truncate">
                              Sold by {item.sellerName}
                            </span>
                          </div>
                          <h4
                            onClick={() =>
                              setSelectedProductForDetails(
                                mapCatalogItemToDetail(item)
                              )
                            }
                            className="text-xs font-semibold text-slate-200 mt-0.5 line-clamp-1 hover:text-indigo-300 transition-colors cursor-pointer"
                            title="Click to view details"
                          >
                            {item.title}
                          </h4>
                          <div className="flex items-center space-x-2 mt-1 text-[11px]">
                            <span className="text-amber-400 flex items-center font-bold">
                              <Star className="w-3 h-3 fill-amber-400 mr-0.5" />
                              {item.rating}
                            </span>
                            <span className="text-slate-500">
                              ({item.reviewCount.toLocaleString()} reviews)
                            </span>
                            <span className="text-slate-600">•</span>
                            <span className="text-slate-400">
                              {item.deliveryDays}d delivery
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Landed Pricing Breakdown */}
                      <div className="bg-slate-900/60 rounded-lg p-2.5 text-[11px] grid grid-cols-4 gap-1 text-center">
                        <div>
                          <span className="text-[9px] text-slate-500 block">Base</span>
                          <span className="font-mono text-slate-300 font-semibold">
                            ${(item.priceCents / 100).toFixed(2)}
                          </span>
                        </div>
                        <div>
                          <span className="text-[9px] text-slate-500 block">Shipping</span>
                          <span className="font-mono text-slate-300 font-semibold">
                            {item.shippingFeeCents === 0
                              ? "FREE"
                              : `$${(item.shippingFeeCents / 100).toFixed(2)}`}
                          </span>
                        </div>
                        <div>
                          <span className="text-[9px] text-slate-500 block">Est. Tax</span>
                          <span className="font-mono text-slate-300 font-semibold">
                            ${(
                              item.landedPricing?.estimatedTax ??
                              (Math.round(item.priceCents * 0.0825) / 100)
                            ).toFixed(2)}
                          </span>
                        </div>
                        <div className="bg-emerald-500/10 rounded py-0.5 border border-emerald-500/20">
                          <span className="text-[9px] text-emerald-400 font-bold block">Total</span>
                          <span className="font-mono text-emerald-300 font-bold">
                            ${(
                              item.landedPricing?.totalCost ??
                              ((item.priceCents +
                                item.shippingFeeCents +
                                Math.round(item.priceCents * 0.0825)) /
                                100)
                            ).toFixed(2)}
                          </span>
                        </div>
                      </div>

                      {/* Action Bar */}
                      <div className="flex items-center justify-between pt-1">
                        <span
                          className={`text-[10px] px-2 py-0.5 rounded font-medium ${
                            item.inStock && item.stockQuantity > 0
                              ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                              : "bg-rose-500/10 text-rose-400 border border-rose-500/20"
                          }`}
                        >
                          {item.inStock && item.stockQuantity > 0
                            ? `In Stock (${item.stockQuantity})`
                            : "Out of Stock"}
                        </span>

                        <div className="flex items-center space-x-2">
                          <button
                            type="button"
                            onClick={() =>
                              setSelectedProductForDetails(
                                mapCatalogItemToDetail(item)
                              )
                            }
                            className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-medium flex items-center space-x-1 transition-all cursor-pointer"
                          >
                            <Eye className="w-3.5 h-3.5 text-indigo-400" />
                            <span>Details</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              setQuery(`Find ${item.title}`);
                              setConstraints((prev) => ({
                                ...prev,
                                maxBudget: Math.ceil(
                                  (item.priceCents +
                                    item.shippingFeeCents +
                                    Math.round(item.priceCents * 0.0825)) /
                                    100 +
                                    20
                                ),
                                maxDeliveryDays: Math.max(item.deliveryDays, 3),
                                preferredBrand: item.brand,
                              }));
                              setShowCatalogModal(false);
                              handleStartRun(`Find ${item.title}`);
                            }}
                            className="px-3 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold flex items-center space-x-1 transition-all cursor-pointer"
                          >
                            <span>Deploy Agent</span>
                            <ArrowUpRight className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-3 border-t border-slate-800 bg-slate-950/80 text-center text-[11px] text-slate-500">
              Deterministic demo catalog • All arithmetic computed in integer cents • No live merchant integration
            </div>
          </div>
        </div>
      )}

      {/* Product Details Experience Modal */}
      {selectedProductForDetails && (
        <ProductDetailsModal
          product={selectedProductForDetails}
          onClose={() => setSelectedProductForDetails(null)}
          onSelectProduct={(prod) => {
            setQuery(`Find ${prod.title}`);
            setConstraints((prev) => ({
              ...prev,
              maxBudget: Math.ceil(prod.totalCost + 20),
              maxDeliveryDays: Math.max(prod.deliveryDays, 3),
              preferredBrand: prod.brand,
            }));
            setSelectedProductForDetails(null);
            handleStartRun(`Find ${prod.title}`);
          }}
        />
      )}
    </div>
  );
}
