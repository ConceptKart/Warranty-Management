/**
 * Seed external DB rows for Shopify AWB classification testing.
 *
 * Usage:
 *   node scripts/seed-awb-test.mjs replacement
 *   node scripts/seed-awb-test.mjs blocked
 *   node scripts/seed-awb-test.mjs warranty
 *   node scripts/seed-awb-test.mjs cleanup
 *
 * Then verify in portal: Platform = Website, Order = CK228402
 */
import "dotenv/config";
import mysql from "mysql2/promise";

const TEST_ORDER = "CK228402";
const TEST_AWB = "SF3145200579CNC";

const mode = (process.argv[2] ?? "").toLowerCase();
const allowed = new Set(["replacement", "blocked", "warranty", "cleanup"]);

if (!allowed.has(mode)) {
  console.error(
    "Usage: node scripts/seed-awb-test.mjs <replacement|blocked|warranty|cleanup>",
  );
  process.exit(1);
}

const extUrl =
  process.env.EXTERNAL_SHIPWAY_DATABASE_URL ??
  "mysql://root:8630@localhost:3306/externaldb";

const ext = await mysql.createConnection({ uri: extUrl });

if (mode === "cleanup") {
  const [result] = await ext.query(
    "DELETE FROM orders WHERE awb_number = ?",
    [TEST_AWB],
  );
  console.log(`Removed test AWB ${TEST_AWB} (${result.affectedRows} row(s)).`);
  console.log(
    `Portal verify ${TEST_ORDER} will classify as warranty (no external match).`,
  );
  await ext.end();
  process.exit(0);
}

const scenarios = {
  replacement: {
    shipment_status: "DELIVERED",
    updated_at: new Date(),
    expected: "replacement — verify succeeds, claim_type = replacement (RP ticket)",
  },
  blocked: {
    shipment_status: "IN TRANSIT",
    updated_at: new Date(),
    expected: "blocked — verify fails with in-transit error",
  },
  warranty: {
    shipment_status: "DELIVERED",
    updated_at: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000),
    expected: "warranty — verify succeeds, claim_type = warranty (WR ticket)",
  },
};

const scenario = scenarios[mode];

await ext.query(
  `INSERT INTO orders (order_id, awb_number, shipment_status, updated_at, courier_name)
   VALUES (?, ?, ?, ?, 'Test Courier')
   ON DUPLICATE KEY UPDATE
     shipment_status = VALUES(shipment_status),
     updated_at = VALUES(updated_at),
     courier_name = VALUES(courier_name)`,
  [TEST_ORDER, TEST_AWB, scenario.shipment_status, scenario.updated_at],
);

console.log("\n=== AWB test data seeded ===");
console.log({
  mode,
  portal_order: TEST_ORDER,
  awb: TEST_AWB,
  shipment_status: scenario.shipment_status,
  updated_at: scenario.updated_at,
});
console.log("\nExpected:", scenario.expected);
console.log("\nTest steps:");
console.log("1. Open http://localhost:3000/");
console.log("2. Platform: Website");
console.log(`3. Order number: ${TEST_ORDER} (or #${TEST_ORDER})`);
console.log("4. Run: node scripts/check-awb-setup.mjs  (optional confirmation)");

await ext.end();
