import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import {
  formatReturnAwbIst,
  getReturnAwbRows,
  resolveReturnAwbPaging,
  returnAwbConditionClass,
} from "@/lib/admin/return-awb";
import { calls, resetDb, setQueryRaw } from "@/lib/db";

const row = {
  id: 88,
  awb_number: "22679040660582",
  order_id: "#CK315791-R",
  sku: "CK-SKU-1",
  ean: "8900001",
  quantity: 1,
  admin_received_qty: 1,
  return_type: "Customer Return",
  return_channel: "Shipway",
  source: "Website",
  condition: "Good",
  company: "SVPL",
  created_at: "2026-10-20 09:48:00",
};

beforeEach(() => {
  resetDb();
});

afterEach(() => {
  resetDb();
});

test("IST display treats naive DATETIME as UTC like PHP", () => {
  assert.equal(formatReturnAwbIst("2026-10-20 09:48:00"), "20 Oct 2026 15:18");
  assert.equal(formatReturnAwbIst(""), "—");
  assert.equal(formatReturnAwbIst(null), "—");
});

test("condition badge matches PHP good/damaged colors", () => {
  assert.equal(returnAwbConditionClass("Good"), "bg-success");
  assert.equal(returnAwbConditionClass("sellable"), "bg-success");
  assert.equal(returnAwbConditionClass("Damaged"), "bg-danger");
  assert.equal(returnAwbConditionClass("Used"), "bg-secondary");
});

test("per-page only allows 10 / 25 / 50 / 100 and defaults to 10", () => {
  assert.deepEqual(resolveReturnAwbPaging("0", "7"), { page: 1, perPage: 10 });
  assert.deepEqual(resolveReturnAwbPaging("3", "25"), { page: 3, perPage: 25 });
  assert.deepEqual(resolveReturnAwbPaging("-2", "100"), { page: 1, perPage: 100 });
});

test("search binds LIKE filters and orders newest id first", async () => {
  setQueryRaw(async (sql) => {
    if (sql.includes("COUNT(*)")) return [{ c: 1 }];
    return [row];
  });

  const result = await getReturnAwbRows(
    { awb_number: "226790", order_id: "315791", sku: "CK-SKU", ean: "890" },
    1,
    10,
  );

  assert.equal(result.error, null);
  assert.equal(result.total, 1);
  assert.equal(result.rows[0].awb_number, "22679040660582");

  const list = calls.find(
    (call) => call.kind === "queryRaw" && String(call.sql).includes("ORDER BY"),
  );
  assert.ok(list);
  assert.match(String(list.sql), /ORDER BY id DESC/i);
  assert.ok(list.values.includes("%226790%"));
  assert.ok(list.values.includes("%315791%"));
  assert.ok(list.values.includes("%CK-SKU%"));
  assert.ok(list.values.includes("%890%"));
});

test("exact dropdown filters bind return type / source / condition / company", async () => {
  setQueryRaw(async (sql) => {
    if (sql.includes("COUNT(*)")) return [{ c: 1 }];
    return [row];
  });

  await getReturnAwbRows(
    {
      return_type: "Customer Return",
      source: "Website",
      condition: "Good",
      company: "SVPL",
    },
    1,
    25,
  );

  const list = calls.find(
    (call) => call.kind === "queryRaw" && String(call.sql).includes("ORDER BY"),
  );
  assert.ok(list.values.includes("Customer Return"));
  assert.ok(list.values.includes("Website"));
  assert.ok(list.values.includes("Good"));
  assert.ok(list.values.includes("SVPL"));
  assert.ok(list.values.includes(25));
});

test("missing table becomes a page error instead of throwing", async () => {
  setQueryRaw(async () => {
    throw new Error("Table 'return_inventory_sync' doesn't exist");
  });

  const result = await getReturnAwbRows({}, 1, 10);
  assert.equal(result.error, "Unable to load Return AWB data.");
  assert.equal(result.rows.length, 0);
});
