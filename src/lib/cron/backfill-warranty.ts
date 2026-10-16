/**
 * Fill empty bl_products.warranty from live BaseLinker extra_field_1281.
 * Also upserts catalog + mapping for order SKUs that were never imported.
 */

import {
  fetchBaselinkerWarranty,
  fetchBaselinkerWarrantyForProductIds,
} from "@/lib/baselinker/warranty-field";
import { prisma } from "@/lib/db";
import {
  parseWarrantyMonths,
  persistBlProductWarrantyByProductId,
  resolveProductWarranty,
} from "@/lib/portal/product-warranty";

const BATCH_SIZE = 50;
const ORDER_SKU_LIMIT = 50;

export type BackfillWarrantyResult = {
  scanned: number;
  filled: number;
  skipped: number;
  dry_run: boolean;
};

function chunk<T>(items: T[], size: number) {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export async function backfillProductWarranties(options?: {
  limit?: number;
  dryRun?: boolean;
}): Promise<BackfillWarrantyResult> {
  const limit = Math.min(Math.max(Number(options?.limit ?? 200), 1), 1000);
  const dryRun = Boolean(options?.dryRun);

  const rows = await prisma.$queryRaw<
    Array<{ product_id: bigint | number | string; sku: string | null }>
  >`
    SELECT product_id, sku
    FROM bl_products
    WHERE (warranty IS NULL OR warranty = '')
      AND product_id IS NOT NULL
      AND product_id != 0
    LIMIT ${limit}
  `;

  const result: BackfillWarrantyResult = {
    scanned: rows.length,
    filled: 0,
    skipped: 0,
    dry_run: dryRun,
  };

  const ids = rows
    .map((row) => String(row.product_id))
    .filter((id) => id && id !== "0");

  for (const batch of chunk(ids, BATCH_SIZE)) {
    const found = await fetchBaselinkerWarrantyForProductIds(batch);
    for (const id of batch) {
      const text = found.get(id);
      if (!text || parseWarrantyMonths(text) <= 0) {
        result.skipped += 1;
        continue;
      }
      if (!dryRun) {
        await persistBlProductWarrantyByProductId(id, text);
      }
      result.filled += 1;
    }
  }

  const skuLimit = Math.min(limit, ORDER_SKU_LIMIT);
  const missingSkus = await prisma.$queryRaw<
    Array<{
      sku: string;
      product_id: bigint | number | string | null;
      variant_id: bigint | number | string | null;
    }>
  >`
    SELECT DISTINCT so.sku AS sku, so.product_id AS product_id, so.variant_id AS variant_id
    FROM shopify_orders so
    WHERE so.sku IS NOT NULL
      AND TRIM(so.sku) != ''
      AND NOT EXISTS (
        SELECT 1 FROM bl_products bp
        WHERE bp.sku IS NOT NULL
          AND bp.warranty IS NOT NULL
          AND bp.warranty != ''
          AND TRIM(bp.sku) = TRIM(so.sku)
      )
    LIMIT ${skuLimit}
  `;

  result.scanned += missingSkus.length;

  for (const row of missingSkus) {
    const sku = String(row.sku ?? "").trim();
    if (!sku) {
      result.skipped += 1;
      continue;
    }
    if (dryRun) {
      const live = await fetchBaselinkerWarranty({ sku });
      if (parseWarrantyMonths(live.text) > 0) result.filled += 1;
      else result.skipped += 1;
      continue;
    }
    const resolved = await resolveProductWarranty({
      sku,
      catalogProductId: row.product_id,
      catalogVariantId: row.variant_id,
    });
    if (resolved.months > 0 && resolved.source === "baselinker") {
      result.filled += 1;
    } else {
      result.skipped += 1;
    }
  }

  return result;
}
