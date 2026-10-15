/**
 * Warranty months for portal verify:
 * amazon_sku_mapping → bl_products.warranty → BaseLinker extra_field_1281.
 * Live BL hits are written back so bl_products.warranty stays filled.
 */

import { prisma } from "@/lib/db";
import { fetchBaselinkerWarrantyText } from "@/lib/baselinker/warranty-field";
import { compactSku, indicatesNoWarranty } from "@/lib/portal/sku-normalize";

export { compactSku, indicatesNoWarranty };

export function parseWarrantyMonths(warrantyText: string | null | undefined): number {
  if (!warrantyText?.trim()) return 0;
  const text = warrantyText.toLowerCase().trim();
  if (indicatesNoWarranty(text)) return 0;

  const patterns: Array<{ re: RegExp; multiplier: number }> = [
    { re: /(\d+)\s*year[s]?/i, multiplier: 12 },
    { re: /(\d+)\s*month[s]?/i, multiplier: 1 },
    { re: /(\d+)\s*yr[s]?/i, multiplier: 12 },
    { re: /(\d+)\s*mo[s]?/i, multiplier: 1 },
  ];

  for (const { re, multiplier } of patterns) {
    const m = text.match(re);
    if (m?.[1]) return Number(m[1]) * multiplier;
  }

  const numMatch = text.match(/(\d+)/);
  if (numMatch?.[1]) {
    const number = Number(numMatch[1]);
    if (number >= 1 && number <= 60) return number;
  }

  return 0;
}

export function monthsToWarrantyText(months: number) {
  if (months <= 0) return null;
  if (months % 12 === 0) {
    const years = months / 12;
    return years === 1 ? "1 year" : `${years} years`;
  }
  return months === 1 ? "1 month" : `${months} months`;
}

export type ResolvedWarranty = {
  months: number;
  text: string | null;
  source: "mapping" | "bl_products" | "mapping_sku" | "baselinker" | "none";
};

export async function persistBlProductWarranty(sku: string, warrantyText: string) {
  const key = sku.trim();
  const compact = compactSku(key);
  if (!key || !warrantyText.trim()) return;
  try {
    await prisma.$executeRaw`
      UPDATE bl_products
      SET warranty = ${warrantyText.trim()}
      WHERE (warranty IS NULL OR warranty = '')
        AND sku IS NOT NULL
        AND sku != ''
        AND (
          CONVERT(TRIM(sku) USING utf8mb4) COLLATE utf8mb4_unicode_ci
            = CONVERT(${key} USING utf8mb4) COLLATE utf8mb4_unicode_ci
          OR REPLACE(REPLACE(REPLACE(LOWER(TRIM(sku)), ' ', ''), '-', ''), '_', '')
            = ${compact}
        )
    `;
  } catch (error) {
    console.error("[persistBlProductWarranty]", error);
  }
}

export async function persistBlProductWarrantyByProductId(
  productId: string,
  warrantyText: string,
) {
  const id = productId.trim();
  const text = warrantyText.trim();
  if (!id || id === "0" || !text) return;
  try {
    await prisma.$executeRaw`
      UPDATE bl_products
      SET warranty = ${text}
      WHERE product_id = ${id}
        AND (warranty IS NULL OR warranty = '')
    `;
  } catch (error) {
    console.error("[persistBlProductWarrantyByProductId]", error);
  }
}

export async function lookupBlProductsWarranty(sku: string): Promise<{
  warranty_text: string | null;
  warranty_months: number;
  product_id?: string | null;
} | null> {
  const key = sku.trim();
  const compact = compactSku(key);
  if (!key) return null;

  const rows = await prisma.$queryRaw<
    Array<{ warranty: string | null; product_id: bigint | number | string | null }>
  >`
    SELECT warranty, product_id
    FROM bl_products
    WHERE sku IS NOT NULL
      AND sku != ''
      AND warranty IS NOT NULL
      AND warranty != ''
      AND (
        CONVERT(TRIM(sku) USING utf8mb4) COLLATE utf8mb4_unicode_ci
          = CONVERT(${key} USING utf8mb4) COLLATE utf8mb4_unicode_ci
        OR REPLACE(REPLACE(REPLACE(LOWER(TRIM(sku)), ' ', ''), '-', ''), '_', '')
          = ${compact}
      )
    LIMIT 1
  `;

  const text = rows[0]?.warranty?.trim() || null;
  if (!text) return null;

  return {
    warranty_text: text,
    warranty_months: parseWarrantyMonths(text),
    product_id: rows[0]?.product_id != null ? String(rows[0].product_id) : null,
  };
}

async function lookupBlProductId(sku: string): Promise<string | null> {
  const key = sku.trim();
  const compact = compactSku(key);
  if (!key) return null;
  const rows = await prisma.$queryRaw<
    Array<{ product_id: bigint | number | string | null }>
  >`
    SELECT product_id
    FROM bl_products
    WHERE sku IS NOT NULL
      AND sku != ''
      AND product_id IS NOT NULL
      AND product_id != 0
      AND (
        CONVERT(TRIM(sku) USING utf8mb4) COLLATE utf8mb4_unicode_ci
          = CONVERT(${key} USING utf8mb4) COLLATE utf8mb4_unicode_ci
        OR REPLACE(REPLACE(REPLACE(LOWER(TRIM(sku)), ' ', ''), '-', ''), '_', '')
          = ${compact}
      )
    LIMIT 1
  `;
  const id = rows[0]?.product_id;
  return id != null && Number(id) !== 0 ? String(id) : null;
}

async function lookupMappingWarrantyBySku(sku: string): Promise<number> {
  const key = sku.trim();
  const compact = compactSku(key);
  if (!key) return 0;
  const rows = await prisma.$queryRaw<Array<{ warranty_given: number | null }>>`
    SELECT warranty_given
    FROM amazon_sku_mapping
    WHERE sku IS NOT NULL
      AND TRIM(sku) != ''
      AND warranty_given IS NOT NULL
      AND warranty_given > 0
      AND (
        CONVERT(TRIM(sku) USING utf8mb4) COLLATE utf8mb4_unicode_ci
          = CONVERT(${key} USING utf8mb4) COLLATE utf8mb4_unicode_ci
        OR REPLACE(REPLACE(REPLACE(LOWER(TRIM(sku)), ' ', ''), '-', ''), '_', '')
          = ${compact}
      )
    ORDER BY warranty_given DESC
    LIMIT 1
  `;
  return Number(rows[0]?.warranty_given ?? 0);
}

/**
 * Resolve months for one order line. Does not invent a default period.
 */
export async function resolveProductWarranty(input: {
  sku: string;
  mappingMonths?: number;
}): Promise<ResolvedWarranty> {
  const sku = input.sku.trim();
  const mappingMonths = Number(input.mappingMonths ?? 0);
  if (mappingMonths > 0) {
    const text = monthsToWarrantyText(mappingMonths);
    if (text && sku) await persistBlProductWarranty(sku, text);
    return {
      months: mappingMonths,
      text,
      source: "mapping",
    };
  }
  if (!sku) {
    return { months: 0, text: null, source: "none" };
  }

  const bl = await lookupBlProductsWarranty(sku);
  if (bl?.warranty_text && indicatesNoWarranty(bl.warranty_text)) {
    return { months: 0, text: bl.warranty_text, source: "none" };
  }
  if (bl && bl.warranty_months > 0) {
    return {
      months: bl.warranty_months,
      text: bl.warranty_text,
      source: "bl_products",
    };
  }

  const skuMapped = await lookupMappingWarrantyBySku(sku);
  if (skuMapped > 0) {
    const text = monthsToWarrantyText(skuMapped);
    if (text) await persistBlProductWarranty(sku, text);
    return { months: skuMapped, text, source: "mapping_sku" };
  }

  const productId = bl?.product_id || (await lookupBlProductId(sku));
  const liveText = await fetchBaselinkerWarrantyText({ sku, productId });
  const liveMonths = parseWarrantyMonths(liveText);
  if (liveMonths > 0 && liveText) {
    await persistBlProductWarranty(sku, liveText);
    if (productId) await persistBlProductWarrantyByProductId(productId, liveText);
    return { months: liveMonths, text: liveText, source: "baselinker" };
  }

  return { months: 0, text: liveText, source: "none" };
}

export type ProductWarrantyApiResult =
  | {
      success: true;
      has_warranty: false;
      warranty_text: null;
    }
  | {
      success: true;
      has_warranty: true;
      warranty_text: string;
      warranty_status?: "valid" | "expired";
      warranty_period?: string;
      warranty_months?: number;
      order_date?: string;
      expiry_date?: string;
      days_remaining?: number;
    }
  | { success: false; error: string };

/**
 * PHP API parity, plus mapping-by-SKU and live BaseLinker extra_field_1281.
 */
export async function getProductWarrantyBySku(input: {
  sku: string;
  orderDate?: Date | null;
}): Promise<ProductWarrantyApiResult> {
  const sku = input.sku.trim();
  if (!sku) {
    return { success: false, error: "sku parameter is required" };
  }

  try {
    const resolved = await resolveProductWarranty({ sku });
    if (resolved.months <= 0 || !resolved.text) {
      return { success: true, has_warranty: false, warranty_text: null };
    }

    let orderDate = input.orderDate ? new Date(input.orderDate) : null;
    if (!orderDate || Number.isNaN(orderDate.getTime())) {
      const orderRows = await prisma.$queryRaw<Array<{ order_date: Date }>>`
        SELECT order_date
        FROM shopify_orders
        WHERE sku = ${sku}
        ORDER BY order_date DESC
        LIMIT 1
      `;
      orderDate = orderRows[0]?.order_date
        ? new Date(orderRows[0].order_date)
        : null;
    }

    if (!orderDate || Number.isNaN(orderDate.getTime())) {
      return {
        success: true,
        has_warranty: true,
        warranty_text: `Warranty: ${resolved.text}`,
        warranty_period: resolved.text,
        warranty_months: resolved.months,
      };
    }

    const today = new Date();
    const expiry = new Date(orderDate);
    expiry.setMonth(expiry.getMonth() + resolved.months);
    const ms = expiry.getTime() - today.getTime();
    const days = Math.floor(Math.abs(ms) / (1000 * 60 * 60 * 24));
    const isExpired = today > expiry;

    return {
      success: true,
      has_warranty: true,
      warranty_text: isExpired
        ? `Warranty: ${resolved.text} (${days} days expired)`
        : `Warranty: ${resolved.text} (${days} days remaining)`,
      warranty_status: isExpired ? "expired" : "valid",
      warranty_period: resolved.text,
      warranty_months: resolved.months,
      order_date: orderDate.toISOString().slice(0, 10),
      expiry_date: expiry.toISOString().slice(0, 10),
      days_remaining: isExpired ? -days : days,
    };
  } catch (error) {
    console.error("[getProductWarrantyBySku]", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Database error",
    };
  }
}
