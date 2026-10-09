import { prisma } from "@/lib/db";
import {
  fetchOrdersForDay,
  formatIstFromUnix,
  getIstDayWindow,
  type BaselinkerOrder,
} from "@/lib/cron/baselinker-client";

const AMAZON_SOURCE = "amazon";
const AMAZON_SOURCE_IDS = (
  process.env.BASELINKER_AMAZON_SOURCE_IDS ?? "155,306,307"
)
  .split(",")
  .map((s) => Number(s.trim()))
  .filter((n) => n > 0);

type AmazonRow = {
  amazon_order_id: string;
  base_linker_order_id: string;
  sku: string | null;
  amazon_title: string | null;
  order_date: string;
  product_id: number;
  variant_id: number;
};

function expandOrderToRows(order: BaselinkerOrder): AmazonRow[] {
  const products = order.products ?? [];
  const baseOrderId = String(order.order_id ?? "");
  const amazonOrderId = String(
    order.extra_field_1 || order.external_order_id || "",
  );
  const orderDate = formatIstFromUnix(
    Number(order.date_add ?? Date.now() / 1000),
  );

  const rows: AmazonRow[] = [];
  for (const product of products) {
    rows.push({
      amazon_order_id: amazonOrderId,
      base_linker_order_id: baseOrderId,
      sku: String(product.sku ?? "") || null,
      amazon_title: String(product.name ?? "") || null,
      order_date: orderDate,
      product_id: Number(product.product_id ?? 0),
      variant_id: Number(product.variant_id ?? 0),
    });
  }

  if (rows.length === 0) {
    rows.push({
      amazon_order_id: amazonOrderId,
      base_linker_order_id: baseOrderId,
      sku: null,
      amazon_title: null,
      order_date: orderDate,
      product_id: 0,
      variant_id: 0,
    });
  }
  return rows;
}

async function upsertAmazonRow(row: AmazonRow) {
  await prisma.$executeRaw`
    INSERT INTO amazon_order_details (
      amazon_order_id, base_linker_order_id, sku, amazon_title,
      order_date, product_id, variant_id
    ) VALUES (
      ${row.amazon_order_id}, ${row.base_linker_order_id}, ${row.sku},
      ${row.amazon_title}, ${row.order_date}, ${row.product_id}, ${row.variant_id}
    )
    ON DUPLICATE KEY UPDATE
      base_linker_order_id = VALUES(base_linker_order_id),
      sku = VALUES(sku),
      amazon_title = VALUES(amazon_title),
      order_date = VALUES(order_date)
  `;
}

/** Port of cron/amazon_sync.php */
export async function syncAmazonOrders(input: {
  date?: string | null;
  dryRun?: boolean;
}) {
  const window = getIstDayWindow(input.date);
  const dryRun = Boolean(input.dryRun);

  let ordersMatched = 0;
  let rowsUpserted = 0;
  let rowsErrored = 0;
  const errors: string[] = [];
  const bySource: Record<string, number> = {};

  for (const sourceId of AMAZON_SOURCE_IDS) {
    const orders = await fetchOrdersForDay({
      filterOrderSource: AMAZON_SOURCE,
      filterOrderSourceId: sourceId,
      dayStart: window.dayStart,
      dayEnd: window.dayEnd,
    });
    bySource[String(sourceId)] = orders.length;
    ordersMatched += orders.length;

    for (const order of orders) {
      const rows = expandOrderToRows(order);
      for (const row of rows) {
        if (dryRun) {
          rowsUpserted++;
          continue;
        }
        try {
          await upsertAmazonRow(row);
          rowsUpserted++;
        } catch (error) {
          rowsErrored++;
          errors.push(
            `source=${sourceId} order=${row.base_linker_order_id}: ${
              error instanceof Error ? error.message : "upsert failed"
            }`,
          );
        }
      }
    }
  }

  return {
    mode: "amazon",
    dry_run: dryRun,
    source_ids: AMAZON_SOURCE_IDS,
    date_ist: `${window.istStart} → ${window.istEnd}`,
    orders_matched: ordersMatched,
    orders_by_source: bySource,
    rows_upserted: rowsUpserted,
    rows_errored: rowsErrored,
    errors: errors.slice(0, 20),
  };
}
