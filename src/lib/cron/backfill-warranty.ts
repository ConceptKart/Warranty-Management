/**
 * Fill empty bl_products.warranty from live BaseLinker extra_field_1281.
 */

import { fetchBaselinkerWarrantyForProductIds } from "@/lib/baselinker/warranty-field";
import { prisma } from "@/lib/db";
import {
  parseWarrantyMonths,
  persistBlProductWarrantyByProductId,
} from "@/lib/portal/product-warranty";

const BATCH_SIZE = 50;

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

  return result;
}
