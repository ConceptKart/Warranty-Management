import "dotenv/config";
import mysql from "mysql2/promise";

const ext = await mysql.createConnection({
  uri:
    process.env.EXTERNAL_SHIPWAY_DATABASE_URL ??
    "mysql://root:8630@localhost:3306/externaldb",
});

const testAwb = "SF3145200579CNC";
const testOrder = "CK228402";

const [byAwb] = await ext.query(
  "SELECT awb_number, order_id, shipment_status FROM orders WHERE awb_number = ?",
  [testAwb],
);
const [byOrder] = await ext.query(
  "SELECT awb_number, order_id, shipment_status FROM orders WHERE order_id LIKE ?",
  [`%${testOrder}%`],
);

console.log("Lookup by AWB", testAwb, ":", byAwb);
console.log("Lookup by order_id", testOrder, ":", byOrder);

const [corrTables] = await ext.query("SHOW TABLES LIKE '%correction%'");
console.log("Correction tables:", corrTables);

if (corrTables.length > 0) {
  const [corrCols] = await ext.query("SHOW COLUMNS FROM shipway_awb_corrections");
  console.log(
    "shipway_awb_corrections columns:",
    corrCols.map((c) => c.Field),
  );
  const [corrSample] = await ext.query(
    "SELECT * FROM shipway_awb_corrections LIMIT 3",
  );
  console.log("correction samples:", corrSample);
  const [corrMatch] = await ext.query(
    "SELECT * FROM shipway_awb_corrections WHERE old_awb = ? OR new_awb = ? OR awb_number = ? LIMIT 5",
    [testAwb, testAwb, testAwb],
  ).catch(() => [[]]);
  console.log("correction match for test AWB:", corrMatch);
}

await ext.end();
