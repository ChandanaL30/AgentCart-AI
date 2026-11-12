import { PrismaClient } from "@prisma/client";
import { DEMO_CATALOG_ITEMS } from "../src/lib/catalog/seed-data";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Starting AgentCart AI catalog seeding...");

  for (const item of DEMO_CATALOG_ITEMS) {
    await prisma.product.upsert({
      where: { externalId: item.externalId },
      update: {
        title: item.title,
        description: item.description,
        category: item.category,
        brand: item.brand,
        seller: item.seller,
        basePrice: item.basePrice,
        currency: item.currency,
        shippingCost: item.shippingCost,
        estimatedTaxRate: item.estimatedTaxRate,
        rating: item.rating,
        reviewCount: item.reviewCount,
        deliveryDays: item.deliveryDays,
        inStock: item.inStock,
        imageUrl: item.imageUrl,
        specs: item.specs,
      },
      create: {
        id: item.id,
        externalId: item.externalId,
        title: item.title,
        description: item.description,
        category: item.category,
        brand: item.brand,
        seller: item.seller,
        basePrice: item.basePrice,
        currency: item.currency,
        shippingCost: item.shippingCost,
        estimatedTaxRate: item.estimatedTaxRate,
        rating: item.rating,
        reviewCount: item.reviewCount,
        deliveryDays: item.deliveryDays,
        inStock: item.inStock,
        imageUrl: item.imageUrl,
        specs: item.specs,
      },
    });
  }

  console.log(`✅ Seeded ${DEMO_CATALOG_ITEMS.length} demo products successfully into PostgreSQL.`);
}

main()
  .catch((e) => {
    console.error("❌ Error during catalog seed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
