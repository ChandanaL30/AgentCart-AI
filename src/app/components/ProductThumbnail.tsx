"use client";

import React, { useState } from "react";
import {
  Armchair,
  Cpu,
  Droplets,
  Headphones,
  Keyboard,
  Monitor,
  Package,
  Sparkles,
} from "lucide-react";

export interface ProductThumbnailProps {
  src?: string;
  alt: string;
  category?: string;
  className?: string;
  productId?: string;
}

export function getProductFallbackSvg(category: string = "", alt: string = ""): string {
  const combined = `${category} ${alt}`.toLowerCase().trim();

  // 1. Skincare / Beauty / Sunscreen / Face Wash
  if (
    combined.includes("sunscreen") ||
    combined.includes("sunblock") ||
    combined.includes("spf") ||
    combined.includes("tinted") ||
    combined.includes("wash") ||
    combined.includes("cleanse") ||
    combined.includes("skin") ||
    combined.includes("beauty") ||
    combined.includes("cream") ||
    combined.includes("lotion") ||
    combined.includes("serum") ||
    combined.includes("moisturizer") ||
    combined.includes("biotique") ||
    combined.includes("lotus") ||
    combined.includes("cerave") ||
    combined.includes("cetaphil") ||
    combined.includes("minimalist") ||
    combined.includes("laroche") ||
    combined.includes("himalaya")
  ) {
    return "/images/products/skincare.svg";
  }

  // 2. Audio / Headphones / Earphones / Earbuds
  if (
    combined.includes("headphone") ||
    combined.includes("earphone") ||
    combined.includes("earbud") ||
    combined.includes("audio") ||
    combined.includes("headset") ||
    combined.includes("soundcore") ||
    combined.includes("wh-1000xm") ||
    combined.includes("tune510") ||
    combined.includes("boat") ||
    combined.includes("bassheads") ||
    combined.includes("qc45") ||
    combined.includes("hd560s")
  ) {
    return "/images/products/headphones.svg";
  }

  // 3. Keyboards
  if (
    combined.includes("keyboard") ||
    combined.includes("keychron") ||
    combined.includes("huntsman") ||
    combined.includes("mx keys") ||
    combined.includes("epomaker") ||
    combined.includes("mechanical")
  ) {
    return "/images/products/keyboards.svg";
  }

  // 4. SSD / Storage / Memory
  if (
    combined.includes("ssd") ||
    combined.includes("t7") ||
    combined.includes("crucial x9") ||
    combined.includes("portable drive") ||
    combined.includes("hard drive") ||
    combined.includes("storage") ||
    combined.includes("nvme")
  ) {
    return "/images/products/ssd.svg";
  }

  // 5. Monitors / Displays (guard against sunscreen & screenbar)
  if (
    (combined.includes("monitor") ||
      combined.includes("display") ||
      /\bscreens?\b/.test(combined)) &&
    !combined.includes("sunscreen") &&
    !combined.includes("screenbar")
  ) {
    return "/images/products/monitors.svg";
  }

  // 6. Mouse / Trackball / Pointer
  if (
    combined.includes("mouse") ||
    combined.includes("trackball") ||
    combined.includes("mx master")
  ) {
    return "/images/products/mouse.svg";
  }

  // 7. Hub / Dock / Power / Charger / Cable / Screenbar / Accessories
  if (
    combined.includes("hub") ||
    combined.includes("dock") ||
    combined.includes("caldigit") ||
    combined.includes("powerbank") ||
    combined.includes("power bank") ||
    combined.includes("charger") ||
    combined.includes("screenbar") ||
    combined.includes("accessory")
  ) {
    return "/images/products/hub.svg";
  }

  // 8. Chairs & Desks (Home Office)
  if (
    combined.includes("chair") ||
    combined.includes("stool") ||
    combined.includes("seating") ||
    combined.includes("steelcase") ||
    combined.includes("uplift") ||
    combined.includes("sihoo") ||
    combined.includes("ergonomic") ||
    (combined.includes("desk") && !combined.includes("desktop"))
  ) {
    return "/images/products/chair.svg";
  }

  // 9. Water Bottles / Hydration
  if (
    combined.includes("bottle") ||
    combined.includes("flask") ||
    combined.includes("thermoflask") ||
    combined.includes("hydroflask") ||
    combined.includes("milton") ||
    combined.includes("tumbler") ||
    combined.includes("drinkware") ||
    combined.includes("water")
  ) {
    return "/images/products/bottle.svg";
  }

  // 10. Cooking / Kitchen appliances
  if (
    combined.includes("cooker") ||
    combined.includes("instant pot") ||
    combined.includes("fryer") ||
    combined.includes("blender") ||
    combined.includes("kitchen")
  ) {
    return "/images/products/cooker.svg";
  }

  // 11. Cameras & Photography
  if (
    combined.includes("camera") ||
    combined.includes("fujifilm") ||
    combined.includes("dslr") ||
    combined.includes("mirrorless") ||
    combined.includes("lens")
  ) {
    return "/images/products/camera.svg";
  }

  // 12. Footwear / Shoes / Sneakers
  if (
    combined.includes("shoe") ||
    combined.includes("sneaker") ||
    combined.includes("footwear") ||
    combined.includes("pegasus") ||
    combined.includes("running")
  ) {
    return "/images/products/shoes.svg";
  }

  return "/images/products/default.svg";
}

export function ProductThumbnail({
  src,
  alt,
  category = "general",
  className = "w-full h-full object-cover",
  productId,
}: ProductThumbnailProps) {
  const catLower = (category || "").toLowerCase().trim();
  const altLower = (alt || "").toLowerCase().trim();
  const combined = `${catLower} ${altLower}`;

  const fallbackSvg = getProductFallbackSvg(category, alt);

  // Track failed sources idiomatically without useEffect synchronization
  const [failedSources, setFailedSources] = useState<Record<string, boolean>>({});

  const isPrimaryFailed = Boolean(src && failedSources[src]);
  const isFallbackFailed = Boolean(failedSources[fallbackSvg]);

  const currentSrc = !src || isPrimaryFailed ? fallbackSvg : src;
  const isFallback = !src || isPrimaryFailed;
  const hasFailedCompletely = isFallback && isFallbackFailed;

  const handleError = () => {
    if (!isFallback && src) {
      setFailedSources((prev) => ({ ...prev, [src]: true }));
    } else {
      setFailedSources((prev) => ({ ...prev, [fallbackSvg]: true }));
    }
  };

  const getCategoryIcon = () => {
    if (
      combined.includes("sunscreen") ||
      combined.includes("sunblock") ||
      combined.includes("spf") ||
      combined.includes("tinted") ||
      combined.includes("wash") ||
      combined.includes("cleanse") ||
      combined.includes("skin") ||
      combined.includes("beauty") ||
      combined.includes("cream") ||
      combined.includes("lotion") ||
      combined.includes("serum")
    ) {
      return <Sparkles className="w-6 h-6 text-rose-400" />;
    }
    if (
      combined.includes("headphone") ||
      combined.includes("earphone") ||
      combined.includes("earbud") ||
      combined.includes("audio")
    ) {
      return <Headphones className="w-6 h-6 text-indigo-400" />;
    }
    if (combined.includes("keyboard")) {
      return <Keyboard className="w-6 h-6 text-cyan-400" />;
    }
    if (
      (combined.includes("monitor") ||
        combined.includes("display") ||
        /\bscreens?\b/i.test(combined)) &&
      !combined.includes("sunscreen")
    ) {
      return <Monitor className="w-6 h-6 text-purple-400" />;
    }
    if (
      combined.includes("mouse") ||
      combined.includes("trackball") ||
      combined.includes("mx master")
    ) {
      return <Cpu className="w-6 h-6 text-blue-400" />;
    }
    if (
      combined.includes("hub") ||
      combined.includes("dock") ||
      combined.includes("power") ||
      combined.includes("charger") ||
      combined.includes("screenbar") ||
      combined.includes("accessory")
    ) {
      return <Cpu className="w-6 h-6 text-indigo-400" />;
    }
    if (
      combined.includes("chair") ||
      combined.includes("seating") ||
      combined.includes("stool") ||
      (combined.includes("desk") && !combined.includes("desktop"))
    ) {
      return <Armchair className="w-6 h-6 text-emerald-400" />;
    }
    if (
      combined.includes("bottle") ||
      combined.includes("flask") ||
      combined.includes("drink") ||
      combined.includes("water") ||
      combined.includes("tumbler") ||
      combined.includes("sipper")
    ) {
      return <Droplets className="w-6 h-6 text-teal-400" />;
    }
    return <Package className="w-6 h-6 text-slate-400" />;
  };

  const getCategoryLabel = () => {
    if (
      combined.includes("sunscreen") ||
      combined.includes("sunblock") ||
      combined.includes("spf") ||
      combined.includes("tinted") ||
      combined.includes("wash") ||
      combined.includes("cleanse") ||
      combined.includes("skin") ||
      combined.includes("cream") ||
      combined.includes("lotion")
    ) {
      return "Skincare";
    }
    if (
      combined.includes("headphone") ||
      combined.includes("earphone") ||
      combined.includes("earbud") ||
      combined.includes("audio")
    ) {
      return "Audio";
    }
    if (combined.includes("keyboard")) return "Keyboard";
    if (
      (combined.includes("monitor") ||
        combined.includes("display") ||
        /\bscreens?\b/i.test(combined)) &&
      !combined.includes("sunscreen")
    ) {
      return "Display";
    }
    if (combined.includes("mouse") || combined.includes("mx master")) return "Mouse";
    if (
      combined.includes("hub") ||
      combined.includes("dock") ||
      combined.includes("power") ||
      combined.includes("charger") ||
      combined.includes("screenbar") ||
      combined.includes("accessory")
    ) {
      return "Accessory";
    }
    if (
      combined.includes("chair") ||
      combined.includes("seating") ||
      combined.includes("stool")
    ) {
      return "Ergo Chair";
    }
    if (combined.includes("desk") && !combined.includes("desktop")) return "Desk";
    if (
      combined.includes("bottle") ||
      combined.includes("flask") ||
      combined.includes("water")
    ) {
      return "Drinkware";
    }
    return "Product";
  };

  if (hasFailedCompletely) {
    return (
      <div
        className="w-full h-full flex flex-col items-center justify-center p-2 bg-slate-900/90 text-center select-none"
        data-testid="neutral-image-placeholder"
        data-category={catLower}
        data-product-id={productId}
      >
        {getCategoryIcon()}
        <span className="text-[9px] font-semibold text-slate-400 uppercase tracking-wider mt-1.5 line-clamp-1">
          {getCategoryLabel()}
        </span>
        <span className="text-[8px] text-slate-500 block">Image unavailable</span>
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={currentSrc}
      alt={alt}
      className={className}
      loading="lazy"
      referrerPolicy="no-referrer"
      data-product-id={productId}
      data-is-fallback={isFallback ? "true" : undefined}
      onError={handleError}
    />
  );
}
