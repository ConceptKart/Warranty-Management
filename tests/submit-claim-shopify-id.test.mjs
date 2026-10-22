import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { resolveSequentialOrderNumber } from "@/lib/portal/submit-claim";
import { resetDb, setQueryRaw } from "@/lib/db";

beforeEach(() => {
  resetDb();
});

afterEach(() => {
  resetDb();
});

test("shopify 20-day rule finds the no-hash twin of a hashed order", async () => {
  setQueryRaw(async (sql, values) => {
    if (sql.includes("FROM orders o") && sql.includes("warranty_tickets")) {
      assert.ok(values.includes("#CK315791") || values.includes("CK315791"));
      assert.ok(
        values.includes("#CK315791-R") || values.includes("CK315791-R"),
      );
      return [
        {
          ticket_number: "RP20261001533",
          created_at: new Date(),
          status_name: "Return in Transit",
          order_number: "CK315791-R",
        },
      ];
    }
    return [];
  });

  const result = await resolveSequentialOrderNumber(
    "#CK315791",
    "R",
    "shopify",
  );
  assert.equal(result.blocked, true);
  assert.equal(result.ticket_number, "RP20261001533");
  assert.ok(result.days_remaining >= 1);
});

test("shopify first claim uses canonical #CK-R when no twin exists", async () => {
  setQueryRaw(async () => []);

  const result = await resolveSequentialOrderNumber("CK315791", "R", "shopify");
  assert.equal(result.blocked, false);
  assert.equal(result.is_first, true);
  assert.equal(result.order_number, "#CK315791-R");
});
