import "dotenv/config";
import mysql from "mysql2/promise";

const ext = await mysql.createConnection({
  uri: process.env.EXTERNAL_SHIPWAY_DATABASE_URL ?? "mysql://root:8630@localhost:3306/externaldb",
});

for (const awb of ["90592647434", "90587681936"]) {
  const [fwd] = await ext.query(
    "SELECT awb_number, shipment_status, courier_name, updated_at FROM orders WHERE awb_number = ?",
    [awb],
  );
  const [rev] = await ext.query(
    "SELECT tracking_number, tracking_status, carrier, status FROM shipway_return_orders WHERE tracking_number = ?",
    [awb],
  );
  console.log(`\nAWB ${awb}:`);
  console.log("  forward orders:", fwd);
  console.log("  return orders:", rev);
}

await ext.end();
