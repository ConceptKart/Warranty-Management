import { prisma } from "@/lib/db";
import {
  fetchOrdersForDay,
  formatIstFromUnix,
  getIstDayWindow,
  type BaselinkerOrder,
} from "@/lib/cron/baselinker-client";

const SHOPIFY_SOURCE = "shop";
const SHOPIFY_SOURCE_ID = Number(
  process.env.BASELINKER_SHOPIFY_SOURCE_ID ?? "9000436",
);

type ShopifyRow = {
  base_order_id: string;
  order_date: string;
  shopify_order_id: string;
  product_id: number;
  variant_id: number;
  sku: string | null;
  awb_number: string;
  customer_name: string;
  phone_number: string;
  email: string;
  customer_address: string;
  city: string;
  state: string;
  pincode: string;
  qty: number;
  ean: number | null;
};

function expandOrderToRows(order: BaselinkerOrder): ShopifyRow[] {
  const products = order.products ?? [];
  const baseOrderId = String(order.order_id ?? "");
  const orderDate = formatIstFromUnix(Number(order.date_add ?? Date.now() / 1000));
  const shopifyId = order.external_order_id
    ? `#CK${order.external_order_id}`
    : "";
  const awb = String(order.delivery_package_nr ?? "");
  const customerName = String(
    (order.delivery_fullname || order.invoice_fullname || "").trim(),
  );
  const phone = String(order.phone ?? "");
  const email = String(order.email ?? "");
  const address = String(order.delivery_address ?? "");
  const city = String(order.delivery_city ?? "");
  const state = String(order.delivery_state ?? "");
  const pincode = String(order.delivery_postcode ?? "");

  const rows: ShopifyRow[] = [];
  for (const product of products) {
    const eanRaw = product.ean;
    const ean =
      eanRaw !== undefined && eanRaw !== null && String(eanRaw) !== ""
        ? Number(eanRaw)
        : null;
    rows.push({
      base_order_id: baseOrderId,
      order_date: orderDate,
      shopify_order_id: shopifyId,
      product_id: Number(product.product_id ?? 0),
      variant_id: Number(product.variant_id ?? 0),
      sku: String(product.sku ?? "") || null,
      awb_number: awb,
      customer_name: customerName,
      phone_number: phone,
      email,
      customer_address: address,
      city,
      state,
      pincode,
      qty: Number(product.quantity ?? 1),
      ean: Number.isFinite(ean as number) ? (ean as number) : null,
    });
  }

  if (rows.length === 0) {
    rows.push({
      base_order_id: baseOrderId,
      order_date: orderDate,
      shopify_order_id: shopifyId,
      product_id: 0,
      variant_id: 0,
      sku: null,
      awb_number: awb,
      customer_name: customerName,
      phone_number: phone,
      email,
      customer_address: address,
      city,
      state,
      pincode,
      qty: 1,
      ean: null,
    });
  }
  return rows;
}

async function upsertShopifyRow(row: ShopifyRow) {
  await prisma.$executeRaw`
    INSERT INTO shopify_orders (
      base_order_id, order_date, shopify_order_id, product_id, variant_id,
      sku, awb_number, customer_name, phone_number, email, customer_address,
      city, state, pincode, qty, ean, created_at, updated_at
    ) VALUES (
      ${row.base_order_id}, ${row.order_date}, ${row.shopify_order_id},
      ${row.product_id}, ${row.variant_id}, ${row.sku}, ${row.awb_number},
      ${row.customer_name}, ${row.phone_number}, ${row.email},
      ${row.customer_address}, ${row.city}, ${row.state}, ${row.pincode},
      ${row.qty}, ${row.ean}, NOW(), NOW()
    )
    ON DUPLICATE KEY UPDATE
      order_date = VALUES(order_date),
      shopify_order_id = VALUES(shopify_order_id),
      sku = VALUES(sku),
      awb_number = VALUES(awb_number),
      customer_name = VALUES(customer_name),
      phone_number = VALUES(phone_number),
      email = VALUES(email),
      customer_address = VALUES(customer_address),
      city = VALUES(city),
      state = VALUES(state),
      pincode = VALUES(pincode),
      qty = VALUES(qty),
      ean = VALUES(ean),
      updated_at = NOW()
  `;
}

/** Port of cron/baselinker_sync.php */
export async function syncShopifyOrders(input: {
  date?: string | null;
  dryRun?: boolean;
}) {
  const window = getIstDayWindow(input.date);
  const dryRun = Boolean(input.dryRun);

  const orders = await fetchOrdersForDay({
    filterOrderSource: SHOPIFY_SOURCE,
    filterOrderSourceId: SHOPIFY_SOURCE_ID,
    dayStart: window.dayStart,
    dayEnd: window.dayEnd,
  });

  let rowsUpserted = 0;
  let rowsErrored = 0;
  const errors: string[] = [];

  for (const order of orders) {
    const rows = expandOrderToRows(order);
    for (const row of rows) {
      if (dryRun) {
        rowsUpserted++;
        continue;
      }
      try {
        await upsertShopifyRow(row);
        rowsUpserted++;
      } catch (error) {
        rowsErrored++;
        errors.push(
          `order=${row.base_order_id} product=${row.product_id}: ${
            error instanceof Error ? error.message : "upsert failed"
          }`,
        );
      }
    }
  }

  return {
    mode: "shopify",
    dry_run: dryRun,
    source_id: SHOPIFY_SOURCE_ID,
    date_ist: `${window.istStart} → ${window.istEnd}`,
    orders_matched: orders.length,
    rows_upserted: rowsUpserted,
    rows_errored: rowsErrored,
    errors: errors.slice(0, 20),
  };
}
