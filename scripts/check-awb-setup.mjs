import "dotenv/config";
import mysql from "mysql2/promise";

const mainUrl =
  process.env.DATABASE_URL ?? "mysql://root:8630@localhost:3306/warranty_management";
const extUrl =
  process.env.EXTERNAL_SHIPWAY_DATABASE_URL ??
  "mysql://root:8630@localhost:3306/externaldb";

const main = await mysql.createPool({ uri: mainUrl });
const ext = await mysql.createPool({ uri: extUrl });

console.log("\n=== 1. External DB connection ===");
const [extTables] = await ext.query("SHOW TABLES");
console.log("Tables:", extTables.map((r) => Object.values(r)[0]));

const [extSample] = await ext.query(
  "SELECT awb_number, shipment_status, updated_at FROM orders LIMIT 3",
);
console.log("Sample external orders:", extSample);

console.log("\n=== 2. Shopify orders with AWB (main DB) ===");
const [shopify] = await main.query(
  `SELECT shopify_order_id, awb_number FROM shopify_orders
   WHERE awb_number IS NOT NULL AND awb_number != '' LIMIT 5`,
);
console.log(shopify);

console.log("\n=== 3. Classification dry-run ===");
for (const row of shopify.slice(0, 3)) {
  const orderId = row.shopify_order_id;
  const awb = row.awb_number;
  const [extRows] = await ext.query(
    "SELECT shipment_status, updated_at FROM orders WHERE awb_number = ? LIMIT 1",
    [awb],
  );
  const extRecord = extRows[0];
  let type = "warranty";
  if (!extRecord) {
    type = "warranty (awb not in external db)";
  } else if (String(extRecord.shipment_status).trim().toUpperCase() !== "DELIVERED") {
    type = "blocked";
  } else if (extRecord.updated_at) {
    const delivered = new Date(extRecord.updated_at);
    const cutoff = new Date(delivered);
    cutoff.setDate(cutoff.getDate() + 10);
    type = new Date() <= cutoff ? "replacement" : "warranty";
  }
  console.log({
    shopify_order_id: orderId,
    awb,
    external_status: extRecord?.shipment_status ?? null,
    classification: type,
  });
}

await main.end();
await ext.end();
