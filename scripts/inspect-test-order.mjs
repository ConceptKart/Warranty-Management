import "dotenv/config";
import mysql from "mysql2/promise";

const main = await mysql.createConnection(
  process.env.DATABASE_URL ?? "mysql://root:8630@localhost:3306/warranty_management",
);

for (const id of ["#CK278402", "#CK278401", "CK228402", "#CK229102"]) {
  const bare = id.replace(/^#/, "");
  const hashed = `#${bare}`;
  const [rows] = await main.query(
    `SELECT shopify_order_id, awb_number, sku, order_date
     FROM shopify_orders
     WHERE shopify_order_id IN (?, ?, ?)
     LIMIT 3`,
    [id, bare, hashed],
  );
  console.log(`\n${id}:`, rows);
}

await main.end();
