/**
 * Port of public/api/product_warranty.php — bl_products.warranty by SKU.
 */

import { prisma } from "@/lib/db";

export function parseWarrantyMonths(warrantyText: string | null | undefined): number {
  if (!warrantyText?.trim()) return 0;
  const text = warrantyText.toLowerCase().trim();

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
    if (number >= 1 && number <= 5) return number * 12;
  }

  return 0;
}

export async function lookupBlProductsWarranty(sku: string): Promise<{
  warranty_text: string | null;
  warranty_months: number;
} | null> {
  const key = sku.trim();
  if (!key) return null;

  const rows = await prisma.$queryRaw<Array<{ warranty: string | null }>>`
    SELECT warranty
    FROM bl_products
    WHERE sku = ${key}
      AND warranty IS NOT NULL
      AND warranty != ''
    LIMIT 1
  `;

  const text = rows[0]?.warranty?.trim() || null;
  if (!text) return null;

  return {
    warranty_text: text,
    warranty_months: parseWarrantyMonths(text),
  };
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
 * PHP API parity: sku → bl_products.warranty → (optional) order_date → remaining.
 * Prefer an explicit orderDate when the caller knows this order's date.
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
    const bl = await lookupBlProductsWarranty(sku);
    if (!bl) {
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

    if (!orderDate || Number.isNaN(orderDate.getTime()) || bl.warranty_months <= 0) {
      return {
        success: true,
        has_warranty: true,
        warranty_text: `Warranty: ${bl.warranty_text}`,
        warranty_period: bl.warranty_text ?? undefined,
        warranty_months: bl.warranty_months,
      };
    }

    const today = new Date();
    const expiry = new Date(orderDate);
    expiry.setMonth(expiry.getMonth() + bl.warranty_months);
    const ms = expiry.getTime() - today.getTime();
    const days = Math.floor(Math.abs(ms) / (1000 * 60 * 60 * 24));
    const isExpired = today > expiry;

    return {
      success: true,
      has_warranty: true,
      warranty_text: isExpired
        ? `Warranty: ${bl.warranty_text} (${days} days expired)`
        : `Warranty: ${bl.warranty_text} (${days} days remaining)`,
      warranty_status: isExpired ? "expired" : "valid",
      warranty_period: bl.warranty_text ?? undefined,
      warranty_months: bl.warranty_months,
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
