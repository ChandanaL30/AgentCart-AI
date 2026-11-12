import { describe, expect, it } from "vitest";
import { calculatePriceBreakdown } from "../pricing/calculator";

describe("Pricing Calculator", () => {
  it("accurately calculates item price, shipping, tax, and total cost", () => {
    // $100 base price, $10 shipping, 8% tax
    const breakdown = calculatePriceBreakdown(100.0, 10.0, 0.08);

    expect(breakdown.itemPrice).toBe(100.0);
    expect(breakdown.shippingCost).toBe(10.0);
    expect(breakdown.estimatedTax).toBe(8.0);
    expect(breakdown.totalCost).toBe(118.0);
    expect(breakdown.currency).toBe("USD");
  });

  it("handles fractional cents correctly with standard financial 2-decimal rounding", () => {
    // $79.99 base price, $0 shipping, 8.25% tax
    // Tax: 79.99 * 0.0825 = 6.599175 -> $6.60
    // Total: 79.99 + 0 + 6.60 = $86.59
    const breakdown = calculatePriceBreakdown(79.99, 0, 0.0825);

    expect(breakdown.itemPrice).toBe(79.99);
    expect(breakdown.shippingCost).toBe(0.0);
    expect(breakdown.estimatedTax).toBe(6.6);
    expect(breakdown.totalCost).toBe(86.59);
  });

  it("defaults to 0 shipping and 8% tax rate when omitted", () => {
    const breakdown = calculatePriceBreakdown(50.0);

    expect(breakdown.shippingCost).toBe(0.0);
    expect(breakdown.estimatedTax).toBe(4.0);
    expect(breakdown.totalCost).toBe(54.0);
  });
});
