import { NextRequest, NextResponse } from "next/server";
import { catalogService } from "@/lib/catalog/service";
import { calculateAuthoritativePricing } from "@/lib/pricing/calculator";

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;

    // Check for side-by-side comparison mode
    const compareParam = searchParams.get("compare");
    if (compareParam) {
      const ids = compareParam.split(",").map((s) => s.trim()).filter(Boolean);
      const comparison = catalogService.compareProducts(ids);
      return NextResponse.json({
        success: true,
        comparison,
      });
    }

    const query = searchParams.get("query") || undefined;
    const category = searchParams.get("category") || undefined;
    const brand = searchParams.get("brand") || undefined;
    const maxBudgetStr = searchParams.get("maxBudget");
    const maxBudgetCents = maxBudgetStr
      ? Math.round(parseFloat(maxBudgetStr) * 100)
      : undefined;
    const maxDeliveryDaysStr = searchParams.get("maxDeliveryDays");
    const maxDeliveryDays = maxDeliveryDaysStr
      ? parseInt(maxDeliveryDaysStr, 10)
      : undefined;
    const minRatingStr = searchParams.get("minRating");
    const minRating = minRatingStr ? parseFloat(minRatingStr) : undefined;
    const inStockOnly = searchParams.get("inStockOnly") !== "false";

    const products = await catalogService.searchAsync({
      query,
      category,
      brand,
      maxBudgetCents,
      maxDeliveryDays,
      minRating,
      inStockOnly,
    });

    // Attach authoritative price breakdown to each catalog item
    const productsWithPricing = products.map((prod) => {
      const pricing = calculateAuthoritativePricing({
        priceCents: prod.priceCents,
        shippingFeeCents: prod.shippingFeeCents,
        estimatedTaxRate: prod.estimatedTaxRate,
        currency: prod.currency,
      });

      return {
        ...prod,
        landedPricing: pricing,
      };
    });

    return NextResponse.json({
      success: true,
      dataSource: "authoritative_demo_catalog",
      isSimulated: true,
      disclaimer:
        "All catalog, pricing, vendor, and delivery values are simulated for demo purposes.",
      totalCount: productsWithPricing.length,
      products: productsWithPricing,
    });
  } catch (error: unknown) {
    if (
      typeof error === "object" &&
      error !== null &&
      "digest" in error &&
      (error as { digest: string }).digest === "NEXT_PRERENDER_INTERRUPTED"
    ) {
      throw error;
    }
    console.error("[Catalog API Error]:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch catalog" },
      { status: 500 }
    );
  }
}
