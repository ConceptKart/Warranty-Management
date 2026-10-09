import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { syncAmazonOrders } from "@/lib/cron/amazon-sync";

export type AmazonOrderRow = {
  id: number;
  amazon_order_id: string | null;
  sku: string | null;
  amazon_title: string | null;
  order_date: Date | null;
  product_id: number | null;
  variant_id: number | null;
  base_linker_order_id: number | null;
  ean: string | null;
};

async function lookupCatalogBySku(sku: string): Promise<{
  title: string | null;
  ean: string | null;
}> {
  const key = sku.trim();
  if (!key) return { title: null, ean: null };

  const [fromProducts, fromBl] = await Promise.all([
    prisma.$queryRaw<
      Array<{ product_name: string | null; ean: string | null }>
    >`
      SELECT product_name, ean
      FROM products
      WHERE product_sku = ${key}
      LIMIT 1
    `,
    prisma
      .$queryRaw<
        Array<{ product_name: string | null; ean: string | number | null }>
      >`
        SELECT product_name, ean
        FROM bl_products
        WHERE sku = ${key}
        LIMIT 1
      `
      .catch(
        () =>
          [] as Array<{
            product_name: string | null;
            ean: string | number | null;
          }>,
      ),
  ]);

  const p = fromProducts[0];
  const b = fromBl[0];
  const title =
    (p?.product_name && p.product_name.trim()) ||
    (b?.product_name && String(b.product_name).trim()) ||
    null;
  const eanRaw = p?.ean ?? b?.ean ?? null;
  const ean =
    eanRaw != null && String(eanRaw).trim() !== ""
      ? String(eanRaw).trim()
      : null;

  return { title, ean };
}

function normalizeTitle(value: string | null | undefined) {
  const t = (value ?? "").trim();
  if (!t || t === "-") return null;
  return t;
}

/** Search amazon_order_details by Amazon order ID (PHP amazon-order-search.php). */
export async function searchAmazonOrders(query: string): Promise<{
  found: boolean;
  rows: AmazonOrderRow[];
}> {
  const q = query.trim();
  if (!q) return { found: false, rows: [] };

  const like = `%${q}%`;
  // Enrich missing title/EAN from products / bl_products by SKU
  // (manual inserts and some sync rows only store order_id + sku + date).
  const rows = await prisma.$queryRaw<AmazonOrderRow[]>`
    SELECT
      aod.id,
      aod.amazon_order_id,
      aod.sku,
      COALESCE(
        NULLIF(NULLIF(TRIM(aod.amazon_title), ''), '-'),
        NULLIF(TRIM(p.product_name), ''),
        NULLIF(TRIM(bp.product_name), '')
      ) AS amazon_title,
      aod.order_date,
      aod.product_id,
      aod.variant_id,
      aod.base_linker_order_id,
      COALESCE(
        NULLIF(TRIM(aod.ean), ''),
        NULLIF(TRIM(p.ean), ''),
        NULLIF(TRIM(CAST(bp.ean AS CHAR)), '')
      ) AS ean
    FROM amazon_order_details aod
    LEFT JOIN products p
      ON aod.sku IS NOT NULL
      AND aod.sku != ''
      AND CONVERT(p.product_sku USING utf8mb4) COLLATE utf8mb4_unicode_ci
        = CONVERT(aod.sku USING utf8mb4) COLLATE utf8mb4_unicode_ci
    LEFT JOIN bl_products bp
      ON aod.sku IS NOT NULL
      AND aod.sku != ''
      AND CONVERT(bp.sku USING utf8mb4) COLLATE utf8mb4_unicode_ci
        = CONVERT(aod.sku USING utf8mb4) COLLATE utf8mb4_unicode_ci
    WHERE aod.amazon_order_id LIKE ${like}
    ORDER BY aod.order_date DESC
    LIMIT 20
  `;

  return {
    found: rows.length > 0,
    rows: rows.map((r) => ({
      ...r,
      id: Number(r.id),
      amazon_title: normalizeTitle(r.amazon_title),
      ean:
        r.ean != null && String(r.ean).trim() !== ""
          ? String(r.ean).trim()
          : null,
      product_id: r.product_id != null ? Number(r.product_id) : null,
      variant_id: r.variant_id != null ? Number(r.variant_id) : null,
      base_linker_order_id:
        r.base_linker_order_id != null
          ? Number(r.base_linker_order_id)
          : null,
    })),
  };
}

/**
 * Pull Amazon orders from BaseLinker for an IST day, then re-search.
 * Prefer this over manual insert — sync fills product_id / variant_id / title.
 */
export async function syncAmazonDayAndSearch(input: {
  query: string;
  date: string;
}): Promise<{
  found: boolean;
  rows: AmazonOrderRow[];
  sync: Awaited<ReturnType<typeof syncAmazonOrders>>;
}> {
  const date = input.date.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error("Invalid date. Use YYYY-MM-DD.");
  }

  const sync = await syncAmazonOrders({ date, dryRun: false });
  const search = await searchAmazonOrders(input.query);
  return { ...search, sync };
}

/**
 * Manual insert for missed cron syncs.
 * PHP inserts amazon_order_id + sku + order_date; we also fill title/EAN from catalog when available.
 * Prefer syncAmazonDayAndSearch when possible (full product/variant IDs).
 */
export async function insertAmazonOrder(input: {
  amazon_order_id: string;
  sku: string;
  order_date: string;
}): Promise<
  | { success: true; message: string; id: number }
  | { success: false; message: string }
> {
  const orderId = input.amazon_order_id.trim();
  const sku = input.sku.trim();
  let orderDate = input.order_date.trim();

  if (!orderId || !sku || !orderDate) {
    return {
      success: false,
      message: "Order ID, SKU and Order Date are required.",
    };
  }

  // datetime-local may be "YYYY-MM-DDTHH:mm" — normalize for MySQL
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(orderDate)) {
    orderDate = `${orderDate.replace("T", " ")}:00`;
  } else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(orderDate)) {
    orderDate = orderDate.replace("T", " ").slice(0, 19);
  }

  const existing = await prisma.$queryRaw<Array<{ id: number }>>`
    SELECT id FROM amazon_order_details
    WHERE amazon_order_id = ${orderId}
    LIMIT 1
  `;
  if (existing[0]) {
    return {
      success: false,
      message: "This Order ID already exists in the database.",
    };
  }

  const catalog = await lookupCatalogBySku(sku);

  try {
    await prisma.$executeRaw`
      INSERT INTO amazon_order_details (
        amazon_order_id, sku, order_date, amazon_title, ean
      )
      VALUES (
        ${orderId},
        ${sku},
        ${orderDate},
        ${catalog.title},
        ${catalog.ean}
      )
    `;

    const created = await prisma.$queryRaw<Array<{ id: number }>>`
      SELECT id FROM amazon_order_details
      WHERE amazon_order_id = ${orderId}
      ORDER BY id DESC
      LIMIT 1
    `;

    return {
      success: true,
      message: "Order inserted successfully!",
      id: Number(created[0]?.id ?? 0),
    };
  } catch (error) {
    console.error("[insertAmazonOrder]", error);
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      return { success: false, message: "Insert failed. Please try again." };
    }
    return { success: false, message: "Insert failed. Please try again." };
  }
}
