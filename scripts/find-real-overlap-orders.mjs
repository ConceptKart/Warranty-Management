import "dotenv/config";
import mysql from "mysql2/promise";

const main = await mysql.createConnection({
  uri: process.env.DATABASE_URL ?? "mysql://root:8630@localhost:3306/warranty_management",
});
const ext = await mysql.createConnection({
  uri:
    process.env.EXTERNAL_SHIPWAY_DATABASE_URL ??
    "mysql://root:8630@localhost:3306/externaldb",
});

const [shopify] = await main.query(`
  SELECT shopify_order_id, awb_number, MAX(order_date) AS order_date
  FROM shopify_orders
  WHERE awb_number IS NOT NULL AND TRIM(awb_number) != ''
  GROUP BY shopify_order_id, awb_number
  ORDER BY order_date DESC
  LIMIT 500
`);

const found = [];
for (const row of shopify) {
  const [extRows] = await ext.query(
    "SELECT shipment_status, updated_at FROM orders WHERE awb_number = ? LIMIT 1",
    [row.awb_number],
  );
  if (extRows.length > 0) {
    found.push({
      verify_as: String(row.shopify_order_id).replace(/^#/, ""),
      shopify_order_id: row.shopify_order_id,
      awb: row.awb_number,
      shipment_status: extRows[0].shipment_status,
      updated_at: extRows[0].updated_at,
    });
    if (found.length >= 5) break;
  }
}

console.log("\n=== Real orders where AWB exists in BOTH databases ===\n");
console.log(found);

const [sfOnly] = await main.query(`
  SELECT COUNT(DISTINCT awb_number) c FROM shopify_orders
  WHERE awb_number LIKE 'SF%'
`);
const [sfMatch] = await ext.query(`
  SELECT COUNT(*) c FROM orders o
  INNER JOIN (
    SELECT DISTINCT awb_number FROM shopify_orders WHERE awb_number LIKE 'SF%'
  ) s ON s.awb_number = o.awb_number
`);
// cross-db join won't work - do in app
let sfMatched = 0;
const [sfAwbs] = await main.query(
  `SELECT DISTINCT awb_number FROM shopify_orders WHERE awb_number LIKE 'SF%' LIMIT 5000`,
);
for (const { awb_number } of sfAwbs) {
  const [r] = await ext.query(
    "SELECT 1 FROM orders WHERE awb_number = ? LIMIT 1",
    [awb_number],
  );
  if (r.length) sfMatched++;
}

console.log("\n=== SF-prefixed AWB mismatch (common issue) ===");
console.log({
  shopify_SF_awbs: sfOnly[0].c,
  SF_awbs_found_in_external: sfMatched,
  note:
    sfMatched === 0
      ? "SF* AWBs in shopify_orders never appear in external orders — classification defaults to warranty"
      : "some SF AWBs match",
});

await main.end();
await ext.end();
