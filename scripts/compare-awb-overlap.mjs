import "dotenv/config";
import mysql from "mysql2/promise";

const main = await mysql.createConnection(
  process.env.DATABASE_URL ?? "mysql://root:8630@localhost:3306/warranty_management",
);
const ext = await mysql.createConnection(
  process.env.EXTERNAL_SHIPWAY_DATABASE_URL ??
    "mysql://root:8630@localhost:3306/externaldb",
);

const [shopifyAwbs] = await main.query(`
  SELECT DISTINCT awb_number FROM shopify_orders
  WHERE awb_number IS NOT NULL AND TRIM(awb_number) != ''
`);
const awbList = shopifyAwbs.map((r) => r.awb_number);

let matchCount = 0;
if (awbList.length > 0) {
  const placeholders = awbList.map(() => "?").join(",");
  const [matches] = await ext.query(
    `SELECT COUNT(*) AS c FROM orders WHERE awb_number IN (${placeholders})`,
    awbList,
  );
  matchCount = matches[0].c;
}

const [extTotal] = await ext.query("SELECT COUNT(*) AS c FROM orders");
const [extSf] = await ext.query(
  "SELECT COUNT(*) AS c FROM orders WHERE awb_number LIKE 'SF%'",
);
const [extNumeric] = await ext.query(
  "SELECT COUNT(*) AS c FROM orders WHERE awb_number REGEXP '^[0-9]+$'",
);

const [extCols] = await ext.query("SHOW COLUMNS FROM orders");
const colNames = extCols.map((c) => c.Field);

console.log("\n=== External DB schema (orders table) ===");
console.log(colNames.join(", "));

console.log("\n=== AWB overlap ===");
console.log({
  shopify_awbs_in_main_db: awbList.length,
  matching_rows_in_external_orders: matchCount,
  overlap_percent:
    awbList.length > 0
      ? `${((matchCount / awbList.length) * 100).toFixed(1)}%`
      : "n/a",
});

console.log("\n=== External DB AWB patterns ===");
console.log({
  total_orders_rows: extTotal[0].c,
  awb_starting_with_SF: extSf[0].c,
  awb_numeric_only: extNumeric[0].c,
});

const [extSamples] = await ext.query(
  "SELECT awb_number, shipment_status FROM orders LIMIT 5",
);
const [shopifySamples] = await main.query(
  `SELECT shopify_order_id, awb_number FROM shopify_orders
   WHERE awb_number IS NOT NULL AND TRIM(awb_number) != '' LIMIT 5`,
);

console.log("\n=== Sample Shopify AWBs (main DB) ===");
console.log(shopifySamples);
console.log("\n=== Sample External AWBs ===");
console.log(extSamples);

await main.end();
await ext.end();
