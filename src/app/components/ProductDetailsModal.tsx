"use client";

import React, { useEffect } from "react";
import {
  Building2,
  CheckCircle2,
  Clock,
  ExternalLink,
  Info,
  Package,
  Shield,
  ShieldCheck,
  Star,
  Truck,
  X,
} from "lucide-react";
import {
  getResolvedExternalUrl,
  getStoreInfo,
} from "@/lib/catalog/url-validator";
import { ProductThumbnail } from "./ProductThumbnail";

export interface DetailedProductItem {
  id: string;
  title: string;
  brand: string;
  model?: string;
  category: string;
  imageUrl?: string;
  productUrl?: string;
  seller: string;
  marketplace?: string;
  price: number; // base price in USD
  shippingCost: number;
  estimatedTax: number;
  totalCost: number; // authoritative landed cost
  rating: number;
  reviewCount: number;
  deliveryDays: number;
  shipsFrom?: string;
  inStock?: boolean;
  stockQuantity?: number;
  description?: string;
  warranty?: string;
  returnPolicy?: string;
  compatibility?: string;
  specs?: Record<string, string | number | boolean>;
  attributes?: Record<string, string | number | boolean>;
  isMockData?: boolean;
}

export interface ProductDetailsModalProps {
  product: DetailedProductItem | null;
  onClose: () => void;
  onSelectProduct?: (product: DetailedProductItem) => void;
}

export function ProductDetailsModal({
  product,
  onClose,
  onSelectProduct,
}: ProductDetailsModalProps) {
  // Close modal on Escape key press
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  if (!product) return null;

  const store = getStoreInfo(product);
  const externalUrl = getResolvedExternalUrl(product);
  const combinedSpecs = {
    ...(product.attributes || {}),
    ...(product.specs || {}),
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
      aria-labelledby="product-details-title"
    >
      <div
        className="bg-slate-900 border border-slate-800 rounded-2xl max-w-3xl w-full max-h-[90vh] flex flex-col shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/90">
          <div className="flex items-center space-x-2 flex-wrap gap-y-1">
            <span className="text-[11px] font-bold text-indigo-400 uppercase tracking-wider px-2 py-0.5 rounded bg-indigo-500/10 border border-indigo-500/20">
              {product.brand}
            </span>
            <span className="text-slate-600">•</span>
            <span className="text-xs text-slate-400 capitalize">
              {product.category}
            </span>
            <span className="text-[10px] font-bold text-amber-300 bg-amber-500/15 border border-amber-500/30 px-2 py-0.5 rounded-full flex items-center space-x-1">
              <span>Derived from: <strong>{store.storeName}</strong></span>
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
            aria-label="Close product details"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Scrollable Body */}
        <div className="overflow-y-auto p-6 space-y-6 flex-1 text-sm">
          {/* Top Section: Image & Main Info */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
            {/* Left: Product Image & Badges */}
            <div className="space-y-3">
              <div className="w-full aspect-square rounded-2xl bg-slate-950 border border-slate-800 overflow-hidden flex items-center justify-center relative shadow-inner">
                <ProductThumbnail
                  src={product.imageUrl}
                  alt={product.title}
                  category={product.category}
                  productId={product.id}
                  className="w-full h-full object-cover"
                />
              </div>

              {/* Status & Logistics Card */}
              <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800/80 space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-slate-400 flex items-center">
                    <Package className="w-3.5 h-3.5 mr-1.5 text-indigo-400" />
                    Inventory Status:
                  </span>
                  <span
                    className={`font-semibold px-2 py-0.5 rounded text-[11px] ${
                      product.inStock !== false && (product.stockQuantity ?? 1) > 0
                        ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/20"
                        : "bg-rose-500/15 text-rose-400 border border-rose-500/20"
                    }`}
                  >
                    {product.inStock !== false && (product.stockQuantity ?? 1) > 0
                      ? `In Stock (${product.stockQuantity ?? "Available"})`
                      : "Depleted / Out of Stock"}
                  </span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-slate-400 flex items-center">
                    <Building2 className="w-3.5 h-3.5 mr-1.5 text-indigo-400" />
                    Merchant / Seller:
                  </span>
                  <span className="text-slate-200 font-medium truncate max-w-[180px]">
                    {product.seller}
                  </span>
                </div>

                {product.marketplace && (
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400 flex items-center">
                      <Shield className="w-3.5 h-3.5 mr-1.5 text-indigo-400" />
                      Marketplace:
                    </span>
                    <span className="text-slate-300 font-medium truncate max-w-[180px]">
                      {product.marketplace}
                    </span>
                  </div>
                )}

                <div className="flex items-center justify-between">
                  <span className="text-slate-400 flex items-center">
                    <Truck className="w-3.5 h-3.5 mr-1.5 text-indigo-400" />
                    Delivery Speed:
                  </span>
                  <span className="text-indigo-300 font-medium">
                    {product.deliveryDays} business day(s)
                  </span>
                </div>

                {product.shipsFrom && (
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400 flex items-center">
                      <Clock className="w-3.5 h-3.5 mr-1.5 text-slate-500" />
                      Ships From:
                    </span>
                    <span className="text-slate-400 text-[11px] truncate max-w-[180px]">
                      {product.shipsFrom}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Right: Title, Model, Pricing, and Description */}
            <div className="space-y-4">
              <div>
                <h2
                  id="product-details-title"
                  className="text-lg md:text-xl font-bold text-white leading-snug"
                >
                  {product.title}
                </h2>
                {product.model && (
                  <div className="mt-1 text-xs font-mono text-indigo-400 flex items-center">
                    <span className="text-slate-500 mr-1.5">Exact Model:</span>
                    <span className="bg-indigo-950/40 px-2 py-0.5 rounded border border-indigo-500/20">
                      {product.model}
                    </span>
                  </div>
                )}
                <div className="flex items-center space-x-3 mt-2 text-xs">
                  <span className="flex items-center text-amber-400 font-semibold">
                    <Star className="w-4 h-4 fill-amber-400 mr-1" />
                    {product.rating}
                    <span className="text-slate-500 font-normal ml-1">
                      ({product.reviewCount.toLocaleString()} reviews)
                    </span>
                  </span>
                </div>
              </div>

              {/* Authoritative Landed Cost Breakdown */}
              <div className="rounded-xl bg-slate-950/80 border border-slate-800 p-4 space-y-2.5">
                <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider block">
                  Authoritative Landed Cost Breakdown
                </span>
                <div className="grid grid-cols-4 gap-2 text-center text-xs">
                  <div className="p-2 rounded bg-slate-900/60">
                    <span className="text-[10px] text-slate-500 uppercase block font-medium">
                      Item
                    </span>
                    <span className="font-mono font-semibold text-slate-200">
                      ${product.price.toFixed(2)}
                    </span>
                  </div>
                  <div className="p-2 rounded bg-slate-900/60">
                    <span className="text-[10px] text-slate-500 uppercase block font-medium">
                      Shipping
                    </span>
                    <span className="font-mono font-semibold text-slate-200">
                      {product.shippingCost === 0
                        ? "FREE"
                        : `$${product.shippingCost.toFixed(2)}`}
                    </span>
                  </div>
                  <div className="p-2 rounded bg-slate-900/60">
                    <span className="text-[10px] text-slate-500 uppercase block font-medium">
                      Est. Tax
                    </span>
                    <span className="font-mono font-semibold text-slate-200">
                      ${product.estimatedTax.toFixed(2)}
                    </span>
                  </div>
                  <div className="p-2 rounded bg-emerald-500/10 border border-emerald-500/25">
                    <span className="text-[10px] text-emerald-400 uppercase block font-bold">
                      Landed Total
                    </span>
                    <span className="font-mono font-bold text-emerald-300">
                      ${product.totalCost.toFixed(2)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Product Description */}
              {product.description && (
                <div className="space-y-1">
                  <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider block">
                    Product Overview
                  </span>
                  <p className="text-xs text-slate-400 leading-relaxed bg-slate-950/40 p-3 rounded-xl border border-slate-800/60">
                    {product.description}
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Specifications & Domain Attributes */}
          {Object.keys(combinedSpecs).length > 0 && (
            <div className="space-y-2 pt-2 border-t border-slate-800">
              <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider block">
                Technical Specifications & Attributes
              </span>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                {Object.entries(combinedSpecs).map(([key, val]) => (
                  <div
                    key={key}
                    className="p-2.5 rounded-lg bg-slate-950/60 border border-slate-800/80 flex items-start justify-between"
                  >
                    <span className="text-slate-400 capitalize mr-2">
                      {key.replace(/([A-Z])/g, " $1")}:
                    </span>
                    <span className="font-medium text-slate-200 text-right">
                      {String(val)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Policy & Compatibility Section (Only when supported by reliable data) */}
          {(product.warranty || product.returnPolicy || product.compatibility) && (
            <div className="space-y-2 pt-2 border-t border-slate-800">
              <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider block">
                Warranty, Return & Compatibility Assurance
              </span>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                {product.warranty && (
                  <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 space-y-1">
                    <span className="text-indigo-400 font-semibold flex items-center">
                      <ShieldCheck className="w-3.5 h-3.5 mr-1" />
                      Warranty
                    </span>
                    <p className="text-slate-400 text-[11px] leading-relaxed">
                      {product.warranty}
                    </p>
                  </div>
                )}
                {product.returnPolicy && (
                  <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 space-y-1">
                    <span className="text-emerald-400 font-semibold flex items-center">
                      <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
                      Return Policy
                    </span>
                    <p className="text-slate-400 text-[11px] leading-relaxed">
                      {product.returnPolicy}
                    </p>
                  </div>
                )}
                {product.compatibility && (
                  <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 space-y-1">
                    <span className="text-purple-400 font-semibold flex items-center">
                      <Info className="w-3.5 h-3.5 mr-1" />
                      Compatibility
                    </span>
                    <p className="text-slate-400 text-[11px] leading-relaxed">
                      {product.compatibility}
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer / External Link Action */}
        <div className="px-6 py-4 border-t border-slate-800 bg-slate-900/90 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="text-xs text-slate-400 flex items-center">
            <span className="text-emerald-400 flex items-center font-medium">
              <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" />
              Verified listing on {store.storeName}
            </span>
          </div>

          <div className="flex items-center space-x-3 w-full sm:w-auto">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 sm:flex-none px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition-colors cursor-pointer"
            >
              Close
            </button>

            <a
              href={externalUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 sm:flex-none px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition-all shadow-md shadow-indigo-600/20 flex items-center justify-center space-x-1.5 cursor-pointer"
              id="view-external-product-button"
              title={`Open original product page on ${store.brandName} in a new tab`}
            >
              <span>Open on {store.brandName}</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </a>

            {onSelectProduct && (
              <button
                type="button"
                onClick={() => {
                  onSelectProduct(product);
                  onClose();
                }}
                className="flex-1 sm:flex-none px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition-all shadow-md shadow-emerald-600/20 cursor-pointer"
              >
                Select Product
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
