import { CatalogProduct } from "@/lib/catalog/types";
import { CATALOG_SIMULATION_DISCLAIMER } from "@/lib/catalog/seed-data";
import { ShoppingConstraints } from "@/lib/types/agent";

/**
 * Standard test shopping constraints for fixtures.
 */
export const FIXTURE_STANDARD_CONSTRAINTS: ShoppingConstraints = {
  maxBudget: 150.0,
  maxDeliveryDays: 3,
  minRating: 4.5,
  preferredBrand: "Sony",
  optimizationPreference: "BEST_VALUE",
};

/**
 * FIXTURE 1: Fully Eligible Product
 * - Base price $120.00, $0 shipping, 8.25% tax ($9.90) = $129.90 <= $150.00
 * - In stock (qty 25)
 * - 2 business days <= 3 max days
 * - Rating 4.7 >= 4.5 min
 * - Brand Sony matches preferred brand
 */
export const FIXTURE_1_ELIGIBLE: CatalogProduct = {
  id: "fixture_1_eligible",
  externalId: "FIX-1-ELIGIBLE",
  title: "Sony WH-CH720N Noise Canceling Wireless Headphones",
  description: "Eligible candidate fulfilling all budget, delivery, and rating constraints.",
  category: "headphones",
  brand: "Sony",
  imageUrl: "https://m.media-amazon.com/images/I/61+btxzpfDL._AC_SL1500_.jpg",
  sellerId: "seller_sony_direct",
  sellerName: "Sony Direct Store",
  priceCents: 12000, // $120.00
  currency: "USD",
  shippingFeeCents: 0,
  estimatedTaxRate: 0.0825,
  inStock: true,
  stockQuantity: 25,
  rating: 4.7,
  reviewCount: 3400,
  isMockData: true,
  deliveryDays: 2,
  shipsFrom: "Louisville, KY",
  attributes: { noiseCanceling: true, battery: "35h" },
  disclaimer: CATALOG_SIMULATION_DISCLAIMER,
  basePrice: 120.0,
  shippingCost: 0,
  seller: "Sony Direct Store",
  specs: { noiseCanceling: true },
};

/**
 * FIXTURE 2: Base Price Under Budget, but Landed Total Exceeds Budget
 * User Budget = $100.00
 * Product Base Price = $95.00 ($95.00 < $100.00 sticker price!)
 * Shipping = $10.00
 * Tax (8.25%) = $7.84
 * Total Landed Cost = $95.00 + $10.00 + $7.84 = $112.84 (> $100.00!)
 * MUST BE STRICTLY REJECTED WITH CODE "EXCEEDS_BUDGET".
 */
export const FIXTURE_2_CONSTRAINTS: ShoppingConstraints = {
  maxBudget: 100.0,
  maxDeliveryDays: 5,
  minRating: 4.0,
  preferredBrand: undefined,
  optimizationPreference: "LOWEST_PRICE",
};

export const FIXTURE_2_LANDED_OVER_BUDGET: CatalogProduct = {
  id: "fixture_2_over_budget_landed",
  externalId: "FIX-2-LANDED-OVER",
  title: "AudioPro Wireless On-Ear Headset (Deceptive Sticker Price)",
  description: "Sticker price is $95.00 (under $100 budget), but shipping and tax push landed cost to $112.84.",
  category: "headphones",
  brand: "AudioPro",
  imageUrl: "https://m.media-amazon.com/images/I/61+btxzpfDL._AC_SL1500_.jpg",
  sellerId: "seller_freight_hub",
  sellerName: "Freight Hub Logistics",
  priceCents: 9500, // $95.00 base price
  currency: "USD",
  shippingFeeCents: 1000, // $10.00 shipping
  estimatedTaxRate: 0.0825, // Tax = $7.84 -> Total = $112.84
  inStock: true,
  stockQuantity: 18,
  rating: 4.5,
  reviewCount: 920,
  isMockData: true,
  deliveryDays: 2,
  shipsFrom: "Seattle, WA",
  attributes: { stickerPrice: "$95.00", shipping: "$10.00" },
  disclaimer: CATALOG_SIMULATION_DISCLAIMER,
  basePrice: 95.0,
  shippingCost: 10.0,
  seller: "Freight Hub Logistics",
  specs: { stickerPrice: "$95.00" },
};

/**
 * FIXTURE 3: Product Arriving Too Late
 * User Max Delivery = 3 business days
 * Product Delivery = 6 business days
 * MUST BE REJECTED WITH CODE "DELIVERY_TOO_SLOW".
 */
export const FIXTURE_3_SLOW_DELIVERY: CatalogProduct = {
  id: "fixture_3_slow_delivery",
  externalId: "FIX-3-SLOW-DELIVERY",
  title: "Sony Studio Monitor Headphones (Slow Freight)",
  description: "Great headphones and well under budget, but shipped via slow ground freight (6 days).",
  category: "headphones",
  brand: "Sony",
  imageUrl: "https://m.media-amazon.com/images/I/61+btxzpfDL._AC_SL1500_.jpg",
  sellerId: "seller_slow_logistics",
  sellerName: "Slow Logistics Depot",
  priceCents: 11000, // $110.00
  currency: "USD",
  shippingFeeCents: 0,
  estimatedTaxRate: 0.0825,
  inStock: true,
  stockQuantity: 50,
  rating: 4.8,
  reviewCount: 4200,
  isMockData: true,
  deliveryDays: 6, // FAILS: maxDeliveryDays is 3
  shipsFrom: "Anchorage, AK",
  attributes: { deliveryDays: 6 },
  disclaimer: CATALOG_SIMULATION_DISCLAIMER,
  basePrice: 110.0,
  shippingCost: 0,
  seller: "Slow Logistics Depot",
  specs: { deliveryDays: 6 },
};

/**
 * FIXTURE 4: Out-of-Stock Product
 * Product has inStock: false and stockQuantity: 0
 * MUST BE REJECTED WITH CODE "OUT_OF_STOCK".
 */
export const FIXTURE_4_OUT_OF_STOCK: CatalogProduct = {
  id: "fixture_4_out_of_stock",
  externalId: "FIX-4-OOS",
  title: "Sony Flagship Noise Cancelling Headset (Depleted Inventory)",
  description: "Meets budget and rating, but stock is completely depleted.",
  category: "headphones",
  brand: "Sony",
  imageUrl: "https://m.media-amazon.com/images/I/61+btxzpfDL._AC_SL1500_.jpg",
  sellerId: "seller_sony_direct",
  sellerName: "Sony Direct Store",
  priceCents: 13000,
  currency: "USD",
  shippingFeeCents: 0,
  estimatedTaxRate: 0.0825,
  inStock: false, // FAILS: Out of Stock
  stockQuantity: 0, // FAILS: 0 stock
  rating: 4.9,
  reviewCount: 8900,
  isMockData: true,
  deliveryDays: 2,
  shipsFrom: "Louisville, KY",
  attributes: { inStock: false },
  disclaimer: CATALOG_SIMULATION_DISCLAIMER,
  basePrice: 130.0,
  shippingCost: 0,
  seller: "Sony Direct Store",
  specs: { inStock: false },
};

/**
 * FIXTURE 5: Product Below Minimum Rating
 * User Min Rating = 4.5★
 * Product Rating = 3.8★
 * MUST BE REJECTED WITH CODE "RATING_TOO_LOW".
 */
export const FIXTURE_5_LOW_RATING: CatalogProduct = {
  id: "fixture_5_low_rating",
  externalId: "FIX-5-LOW-RATING",
  title: "Sony Entry-Level Wireless Earbuds (Subpar Rating)",
  description: "Cheap price and fast shipping, but poor customer feedback (3.8★).",
  category: "headphones",
  brand: "Sony",
  imageUrl: "https://m.media-amazon.com/images/I/61+btxzpfDL._AC_SL1500_.jpg",
  sellerId: "seller_discount_outlet",
  sellerName: "Discount Tech Outlet",
  priceCents: 4999,
  currency: "USD",
  shippingFeeCents: 0,
  estimatedTaxRate: 0.0825,
  inStock: true,
  stockQuantity: 100,
  rating: 3.8, // FAILS: minRating is 4.5
  reviewCount: 310,
  isMockData: true,
  deliveryDays: 2,
  shipsFrom: "Atlanta, GA",
  attributes: { rating: 3.8 },
  disclaimer: CATALOG_SIMULATION_DISCLAIMER,
  basePrice: 49.99,
  shippingCost: 0,
  seller: "Discount Tech Outlet",
  specs: { rating: 3.8 },
};

/**
 * FIXTURE 6: Preferred Brand Mismatch (under enforced brand policy)
 * User Required Brand = "Sony"
 * Product Brand = "Bose"
 * MUST BE REJECTED WITH CODE "BRAND_MISMATCH".
 */
export const FIXTURE_6_BRAND_MISMATCH: CatalogProduct = {
  id: "fixture_6_brand_mismatch",
  externalId: "FIX-6-BRAND-MISMATCH",
  title: "Bose SoundLink Wireless Headphones II",
  description: "Meets budget and rating, but brand is Bose when Sony was strictly enforced.",
  category: "headphones",
  brand: "Bose", // FAILS: preferred brand is Sony
  imageUrl: "https://m.media-amazon.com/images/I/61+btxzpfDL._AC_SL1500_.jpg",
  sellerId: "seller_audioprime",
  sellerName: "AudioPrime Depot",
  priceCents: 12900,
  currency: "USD",
  shippingFeeCents: 0,
  estimatedTaxRate: 0.0825,
  inStock: true,
  stockQuantity: 40,
  rating: 4.6,
  reviewCount: 5200,
  isMockData: true,
  deliveryDays: 2,
  shipsFrom: "Secaucus, NJ",
  attributes: { brand: "Bose" },
  disclaimer: CATALOG_SIMULATION_DISCLAIMER,
  basePrice: 129.0,
  shippingCost: 0,
  seller: "AudioPrime Depot",
  specs: { brand: "Bose" },
};

/**
 * FIXTURE 7: Candidate List Where NO Products Are Eligible
 * Candidates include:
 * - Product A: Exceeds budget
 * - Product B: Slow delivery
 * - Product C: Out of stock
 * MUST RETURN hasEligibleProducts: false, selectedRecommendation: null.
 * NEVER SILENTLY RELAXES CONSTRAINTS.
 */
export const FIXTURE_7_CANDIDATES: CatalogProduct[] = [
  FIXTURE_2_LANDED_OVER_BUDGET, // Exceeds budget
  FIXTURE_3_SLOW_DELIVERY, // Too slow
  FIXTURE_4_OUT_OF_STOCK, // Out of stock
];

/**
 * FIXTURE 8: Shipping Cost Differences Alter Ranking Order
 * Optimization Preference: LOWEST_PRICE
 *
 * Product A ("Sticker Cheap"):
 * - Base price: $80.00 (Lower base price than B!)
 * - Shipping fee: $25.00
 * - Tax (8.25% of $80): $6.60
 * - Total Landed Cost: $80.00 + $25.00 + $6.60 = $111.60
 *
 * Product B ("Landed Efficient"):
 * - Base price: $85.00 (Higher base price than A!)
 * - Shipping fee: $0.00 (Free shipping!)
 * - Tax (8.25% of $85): $7.01
 * - Total Landed Cost: $85.00 + $0.00 + $7.01 = $92.01
 *
 * Under LOWEST_PRICE optimization, Product B MUST RANK #1 because its
 * landed total ($92.01) is lower than Product A's landed total ($111.60),
 * proving that landed cost calculation dictates ranking rather than sticker price!
 */
export const FIXTURE_8_PRODUCT_A: CatalogProduct = {
  id: "fixture_8_prod_a",
  externalId: "FIX-8-PROD-A-STICKER-CHEAP",
  title: "Sticker-Cheap Wireless Headset (Expensive Shipping)",
  description: "Has a cheap $80 sticker price, but exorbitant $25 shipping fee.",
  category: "headphones",
  brand: "GenericSound",
  imageUrl: "https://m.media-amazon.com/images/I/61+btxzpfDL._AC_SL1500_.jpg",
  sellerId: "seller_expensive_ship",
  sellerName: "High Freight Direct",
  priceCents: 8000, // $80.00
  currency: "USD",
  shippingFeeCents: 2500, // $25.00 shipping!
  estimatedTaxRate: 0.0825,
  inStock: true,
  stockQuantity: 20,
  rating: 4.5,
  reviewCount: 1500,
  isMockData: true,
  deliveryDays: 3,
  shipsFrom: "Miami, FL",
  attributes: { basePrice: "$80.00", shipping: "$25.00" },
  disclaimer: CATALOG_SIMULATION_DISCLAIMER,
  basePrice: 80.0,
  shippingCost: 25.0,
  seller: "High Freight Direct",
  specs: { basePrice: "$80.00" },
};

export const FIXTURE_8_PRODUCT_B: CatalogProduct = {
  id: "fixture_8_prod_b",
  externalId: "FIX-8-PROD-B-LANDED-CHEAP",
  title: "Landed-Efficient Wireless Headset (Free Shipping)",
  description: "Has an $85 sticker price, but free shipping makes it cheaper overall.",
  category: "headphones",
  brand: "GenericSound",
  imageUrl: "https://m.media-amazon.com/images/I/61+btxzpfDL._AC_SL1500_.jpg",
  sellerId: "seller_prime_depot",
  sellerName: "Prime Logistics Direct",
  priceCents: 8500, // $85.00
  currency: "USD",
  shippingFeeCents: 0, // Free shipping!
  estimatedTaxRate: 0.0825,
  inStock: true,
  stockQuantity: 35,
  rating: 4.5,
  reviewCount: 1500,
  isMockData: true,
  deliveryDays: 3,
  shipsFrom: "Chicago, IL",
  attributes: { basePrice: "$85.00", shipping: "Free" },
  disclaimer: CATALOG_SIMULATION_DISCLAIMER,
  basePrice: 85.0,
  shippingCost: 0,
  seller: "Prime Logistics Direct",
  specs: { basePrice: "$85.00" },
};
