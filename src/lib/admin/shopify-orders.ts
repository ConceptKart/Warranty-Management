import { prisma } from "@/lib/db";
import { syncShopifyOrders } from "@/lib/cron/shopify-sync";

export type ShopifyOrderRow = {
  id: number;
  shopify_order_id: string | null;
  sku: string | null;
  order_date: Date | null;
  awb_number: string | null;
  customer_name: string | null;
  phone_number: string | null;
  email: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  qty: number | null;
  ean: number | null;
  base_order_id: string | null;
};

function normalizeShopifyQuery(raw: string) {
  const q = raw.trim();
  if (!q) return "";
  // Accept CK218890, #CK218890, or bare digits
  if (/^#?CK\d+/i.test(q)) {
    const digits = q.replace(/^#?CK/i, "");
    return `#CK${digits}`;
  }
  return q;
}

/** Search local shopify_orders by Shopify / #CK order id. */
export async function searchShopifyOrders(query: string): Promise<{
  found: boolean;
  rows: ShopifyOrderRow[];
  normalized_query: string;
}> {
  const normalized = normalizeShopifyQuery(query);
  if (!normalized) {
    return { found: false, rows: [], normalized_query: "" };
  }

  const like = `%${normalized.replace(/^#/, "")}%`;
  const rows = await prisma.$queryRaw<ShopifyOrderRow[]>`
    SELECT
      id,
      shopify_order_id,
      sku,
      order_date,
      awb_number,
      customer_name,
      phone_number,
      email,
      city,
      state,
      pincode,
      qty,
      ean,
      base_order_id
    FROM shopify_orders
    WHERE shopify_order_id LIKE ${like}
       OR shopify_order_id LIKE ${`%${normalized}%`}
    ORDER BY order_date DESC
    LIMIT 30
  `;

  return {
    found: rows.length > 0,
    normalized_query: normalized.startsWith("#")
      ? normalized
      : normalized.match(/^\d+$/)
        ? `#CK${normalized}`
        : normalized,
    rows: rows.map((r) => ({
      ...r,
      id: Number(r.id),
      qty: r.qty != null ? Number(r.qty) : null,
      ean: r.ean != null ? Number(r.ean) : null,
    })),
  };
}

/**
 * Pull Shopify orders from BaseLinker for a given IST day, then re-search.
 * Ops use this when cron missed an order (blank manual insert is unsafe —
 * Shopify rows need customer/AWB fields from BaseLinker).
 */
export async function syncShopifyDayAndSearch(input: {
  query: string;
  date: string;
}): Promise<{
  found: boolean;
  rows: ShopifyOrderRow[];
  normalized_query: string;
  sync: Awaited<ReturnType<typeof syncShopifyOrders>>;
}> {
  const date = input.date.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error("Invalid date. Use YYYY-MM-DD.");
  }

  const sync = await syncShopifyOrders({ date, dryRun: false });
  const search = await searchShopifyOrders(input.query);

  return {
    ...search,
    sync,
  };
}
