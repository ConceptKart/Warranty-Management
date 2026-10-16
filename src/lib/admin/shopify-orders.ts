import { prisma } from "@/lib/db";
import {
  baselinkerCall,
  formatIstFromUnix,
  type BaselinkerOrder,
} from "@/lib/cron/baselinker-client";
import { syncShopifyOrders } from "@/lib/cron/shopify-sync";
import { fetchShopifyAdminOrder } from "@/lib/shopify/admin-client";

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

function parseShopOrderId(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const digits = trimmed.replace(/^#?CK/i, "").replace(/\D/g, "");
  if (!digits) return null;
  const id = Number(digits);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * Port of correct_shopify_import_order.php:
 * BaseLinker getOrders(filter_shop_order_id) → insert shopify_orders
 * (skip rows that already have the same base_order_id + product_id).
 */
export async function importShopifyOrderByShopId(rawShopOrderId: string): Promise<{
  success: boolean;
  message: string;
  inserted: number;
  skipped: number;
  shopify_order_id: string | null;
  rows: ShopifyOrderRow[];
}> {
  const shopOrderId = parseShopOrderId(rawShopOrderId);
  if (!shopOrderId) {
    return {
      success: false,
      message: "Please enter Shopify Order ID.",
      inserted: 0,
      skipped: 0,
      shopify_order_id: null,
      rows: [],
    };
  }

  async function fetchByShopOrderId(unconfirmed: boolean) {
    return baselinkerCall("getOrders", {
      ...(unconfirmed ? { get_unconfirmed_orders: true } : {}),
      filter_shop_order_id: shopOrderId,
    });
  }

  let data = await fetchByShopOrderId(false);
  let orders = (data.orders as BaselinkerOrder[] | undefined) ?? [];
  if (orders.length === 0) {
    data = await fetchByShopOrderId(true);
    orders = (data.orders as BaselinkerOrder[] | undefined) ?? [];
  }
  if (orders.length === 0) {
    return {
      success: false,
      message: "Order Not Found in BaseLinker",
      inserted: 0,
      skipped: 0,
      shopify_order_id: `#CK${shopOrderId}`,
      rows: [],
    };
  }

  let inserted = 0;
  let skipped = 0;
  let shopifyOrderId = `#CK${shopOrderId}`;

  for (const order of orders) {
    const baseOrderId = String(order.order_id ?? "");
    shopifyOrderId = `#CK${order.shop_order_id ?? ""}`;
    const orderDate = formatIstFromUnix(
      Number(order.date_add ?? Date.now() / 1000),
    );
    const awb = String(order.delivery_package_nr ?? "");
    const customerName = String(order.delivery_fullname ?? "");
    const phone = String(order.phone ?? "");
    const email = String(order.email ?? "");
    const address = String(order.delivery_address ?? "");
    const city = String(order.delivery_city ?? "");
    const state = String(order.delivery_state ?? "");
    const pincode = String(order.delivery_postcode ?? "");
    const products = order.products ?? [];

    for (const product of products) {
      const productId = Number(product.product_id ?? 0);
      const existing = await prisma.$queryRaw<Array<{ id: bigint | number }>>`
        SELECT id FROM shopify_orders
        WHERE (base_order_id = ${baseOrderId} OR shopify_order_id = ${shopifyOrderId})
          AND product_id = ${productId}
        LIMIT 1
      `;
      if (existing.length > 0) {
        skipped++;
        continue;
      }

      const eanRaw = product.ean;
      const ean =
        eanRaw !== undefined && eanRaw !== null && String(eanRaw) !== ""
          ? Number(eanRaw)
          : null;

      await prisma.$executeRaw`
        INSERT INTO shopify_orders (
          base_order_id, order_date, shopify_order_id, product_id, variant_id,
          sku, awb_number, customer_name, phone_number, email, customer_address,
          city, state, pincode, qty, ean, created_at, updated_at
        ) VALUES (
          ${baseOrderId}, ${orderDate}, ${shopifyOrderId},
          ${productId}, ${Number(product.variant_id ?? 0)},
          ${String(product.sku ?? "")}, ${awb}, ${customerName},
          ${phone}, ${email}, ${address}, ${city}, ${state}, ${pincode},
          ${Number(product.quantity ?? 1)},
          ${Number.isFinite(ean as number) ? (ean as number) : null},
          NOW(), NOW()
        )
      `;
      inserted++;
    }
  }

  const search = await searchShopifyOrders(shopifyOrderId);
  return {
    success: true,
    message: `BaseLinker Import Completed. Inserted: ${inserted}. Skipped: ${skipped}.`,
    inserted,
    skipped,
    shopify_order_id: shopifyOrderId,
    rows: search.rows,
  };
}

function formatShopifyCreatedAt(createdAt?: string) {
  if (!createdAt) {
    return formatIstFromUnix(Math.floor(Date.now() / 1000));
  }
  const parsed = new Date(createdAt);
  if (Number.isNaN(parsed.getTime())) {
    return formatIstFromUnix(Math.floor(Date.now() / 1000));
  }
  return parsed
    .toLocaleString("sv-SE", { timeZone: "Asia/Kolkata", hour12: false })
    .replace("T", " ");
}

function toEan(raw: unknown): number | null {
  if (raw === undefined || raw === null || String(raw) === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * Visible card on the live PHP page: Shopify Admin API → shopify_orders.
 * product_id / variant_id / base_order_id are stored as 0 (same as PHP).
 */
export async function importShopifyOrderDirect(rawInput: string): Promise<{
  success: boolean;
  message: string;
  inserted: number;
  skipped: number;
  shopify_order_id: string | null;
  rows: ShopifyOrderRow[];
}> {
  const input = rawInput.trim();
  if (!input) {
    return {
      success: false,
      message: "Please enter Shopify Order ID or Order Number.",
      inserted: 0,
      skipped: 0,
      shopify_order_id: null,
      rows: [],
    };
  }

  const orderData = await fetchShopifyAdminOrder(input);
  if (!orderData) {
    const fromBaselinker = await importShopifyOrderByShopId(input);
    if (fromBaselinker.success) {
      return {
        ...fromBaselinker,
        message: `Imported from BaseLinker (not in Shopify Admin search). ${fromBaselinker.message}`,
      };
    }
    return {
      success: false,
      message: "Order Not Found in Shopify Store.",
      inserted: 0,
      skipped: 0,
      shopify_order_id: fromBaselinker.shopify_order_id,
      rows: [],
    };
  }

  const rawOrderNum = String(orderData.name ?? orderData.order_number ?? "").replace(
    /\D/g,
    "",
  );
  const shopifyOrderId = `#CK${rawOrderNum || String(orderData.id ?? "")}`;
  const orderDate = formatShopifyCreatedAt(orderData.created_at);

  let awb = "";
  for (const fulfillment of orderData.fulfillments ?? []) {
    if (fulfillment.tracking_number) {
      awb = String(fulfillment.tracking_number);
      break;
    }
    if (fulfillment.tracking_numbers?.[0]) {
      awb = String(fulfillment.tracking_numbers[0]);
      break;
    }
  }

  const shipping = orderData.shipping_address ?? orderData.billing_address ?? {};
  const customer = orderData.customer ?? {};
  let customerName = `${shipping.first_name ?? customer.first_name ?? ""} ${
    shipping.last_name ?? customer.last_name ?? ""
  }`.trim();
  if (!customerName) customerName = String(shipping.name ?? "");

  const phone = String(
    shipping.phone ?? orderData.phone ?? customer.phone ?? "",
  );
  const email = String(
    orderData.email ?? customer.email ?? orderData.contact_email ?? "",
  );
  const address = `${shipping.address1 ?? ""} ${shipping.address2 ?? ""}`.trim();
  const city = String(shipping.city ?? "");
  const state = String(shipping.province ?? shipping.province_code ?? "");
  const pincode = String(shipping.zip ?? "");

  let inserted = 0;
  let skipped = 0;
  const lineItems = orderData.line_items ?? [];

  for (const product of lineItems) {
    const sku = String(product.sku ?? "");
    const existing = sku
      ? await prisma.$queryRaw<Array<{ id: bigint | number }>>`
          SELECT id FROM shopify_orders
          WHERE shopify_order_id = ${shopifyOrderId}
            AND sku = ${sku}
          LIMIT 1
        `
      : await prisma.$queryRaw<Array<{ id: bigint | number }>>`
          SELECT id FROM shopify_orders
          WHERE shopify_order_id = ${shopifyOrderId}
          LIMIT 1
        `;
    if (existing.length > 0) {
      skipped++;
      continue;
    }

    await prisma.$executeRaw`
      INSERT INTO shopify_orders (
        base_order_id, order_date, shopify_order_id, product_id, variant_id,
        sku, awb_number, customer_name, phone_number, email, customer_address,
        city, state, pincode, qty, ean, created_at, updated_at
      ) VALUES (
        ${"0"}, ${orderDate}, ${shopifyOrderId},
        ${0}, ${0},
        ${sku}, ${awb}, ${customerName},
        ${phone}, ${email}, ${address}, ${city}, ${state}, ${pincode},
        ${Number(product.quantity ?? 1)}, ${toEan(product.barcode)},
        NOW(), NOW()
      )
    `;
    inserted++;
  }

  const search = await searchShopifyOrders(shopifyOrderId);
  return {
    success: true,
    message: `Direct Shopify Import Completed. Order: ${shopifyOrderId}. Inserted: ${inserted}. Skipped: ${skipped}.`,
    inserted,
    skipped,
    shopify_order_id: shopifyOrderId,
    rows: search.rows,
  };
}
