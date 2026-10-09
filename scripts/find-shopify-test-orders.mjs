import "dotenv/config";
import mysql from "mysql2/promise";

const mainUrl =
  process.env.DATABASE_URL ?? "mysql://root:8630@localhost:3306/warranty_management";
const extUrl =
  process.env.EXTERNAL_SHIPWAY_DATABASE_URL ??
  "mysql://root:8630@localhost:3306/externaldb";

const main = await mysql.createPool({ uri: mainUrl });
const ext = await mysql.createPool({ uri: extUrl });

const [orders] = await main.query(`
  SELECT shopify_order_id, awb_number, COUNT(*) AS line_count
  FROM shopify_orders
  WHERE awb_number IS NOT NULL AND awb_number != ''
  GROUP BY shopify_order_id, awb_number
  ORDER BY shopify_order_id DESC
  LIMIT 15
`);

console.log("\n=== Shopify orders with AWB ===");
for (const o of orders) {
  const bare = String(o.shopify_order_id).replace(/^#/, "");
  const [extRows] = await ext.query(
    "SELECT shipment_status, updated_at FROM orders WHERE awb_number = ? LIMIT 1",
    [o.awb_number],
  );
  console.log({
    verify_as: bare,
    shopify_order_id: o.shopify_order_id,
    awb: o.awb_number,
    in_external_db: extRows.length > 0,
    external_status: extRows[0]?.shipment_status ?? null,
  });
}

const [websiteTest] = await main.query(`
  SELECT DISTINCT shopify_order_id FROM shopify_orders
  WHERE shopify_order_id LIKE '%278402%' OR shopify_order_id LIKE '%278401%'
  LIMIT 5
`);
console.log("\n=== Known test order IDs in DB ===", websiteTest);

await main.end();
await ext.end();
