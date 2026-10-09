require("dotenv").config({ quiet: true });

async function main() {
  const { verifyOrder } = require("../src/lib/portal/verify-order.ts");
}

// Use dynamic import of compiled path - call SQL directly instead
const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();

async function test() {
  const id = "403-1882043-3242706";
  const details = await p.$queryRawUnsafe(
    `
    SELECT aod.id, aod.sku, aod.amazon_title,
      asm_v.warranty_given AS v_warranty,
      asm_p.warranty_given AS p_warranty
    FROM amazon_order_details aod
    LEFT JOIN amazon_sku_mapping asm_v
      ON aod.variant_id IS NOT NULL
      AND aod.variant_id != 0
      AND CONVERT(asm_v.variant_id USING utf8mb4) COLLATE utf8mb4_unicode_ci
        = CONVERT(CAST(aod.variant_id AS CHAR) USING utf8mb4) COLLATE utf8mb4_unicode_ci
    LEFT JOIN amazon_sku_mapping asm_p
      ON aod.product_id IS NOT NULL
      AND aod.product_id != 0
      AND CONVERT(asm_p.product_id USING utf8mb4) COLLATE utf8mb4_unicode_ci
        = CONVERT(CAST(aod.product_id AS CHAR) USING utf8mb4) COLLATE utf8mb4_unicode_ci
      AND (
        asm_p.variant_id IS NULL
        OR CONVERT(asm_p.variant_id USING utf8mb4) COLLATE utf8mb4_unicode_ci IN ('0', '')
      )
    WHERE aod.amazon_order_id = ?
  `,
    id,
  );
  console.log("OK rows", details.length, details[0]?.sku || details[0]?.amazon_title);
}

test()
  .catch((e) => console.error("FAIL", e.message))
  .finally(() => p.$disconnect());
