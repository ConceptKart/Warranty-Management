import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { GET } from "@/app/api/api_tickets/route";
import { setSession } from "@/lib/auth/get-session";
import { calls, resetDb, setQueryRaw, setQueryRawUnsafe } from "@/lib/db";
import { captureConsole, setEnv } from "./helpers.mjs";

const KEY = "test-crud-key-0123456789abcdef";
const TICKET = "WR-TEST-0001";

const ticket = {
  ticket_id: 1,
  ticket_number: TICKET,
  order_id: 10,
  claim_number: null,
  status_id: 2,
  ticket_date: new Date("2026-01-05T10:00:00Z"),
  order_number: "#TEST-1001",
  source_platform: "shopify",
  customer_id: 20,
  first_name: "Test",
  last_name: "Customer",
  customer_email: "customer@example.test",
  customer_phone: "9000000001",
};

function get(query, headers = {}) {
  return GET(new Request(`http://localhost.test/api/api_tickets${query}`, { headers }));
}

let output;
let restoreEnv;

beforeEach(() => {
  resetDb();
  setSession({});
  restoreEnv = setEnv({ CRUD_API_KEY: KEY });
  output = captureConsole();
});

afterEach(() => {
  output.restore();
  restoreEnv();
});

test("A: valid API key returns ticket details including the customer phone", async () => {
  setQueryRawUnsafe(async (sql) => {
    if (String(sql).includes("COUNT(*)")) return [{ c: 1n }];
    return [ticket];
  });

  const res = await get(`?search=${TICKET}`, { "x-crud-api-key": KEY });
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.equal(body.status, true);
  assert.equal(body.total_records, 1);
  assert.equal(body.data[0].ticket_number, TICKET);
  assert.equal(body.data[0].customer_phone, "9000000001");
  const rowsQuery = calls.find(
    (c) => c.kind === "queryRawUnsafe" && String(c.sql).includes("ORDER BY"),
  );
  assert.ok(rowsQuery.values.includes(`%${TICKET}%`));
  assert.ok(!rowsQuery.sql.includes(TICKET), "search term must be a bound parameter");
});

test("A: exclude_status=pending lists only non-pending tickets", async () => {
  setQueryRawUnsafe(async (sql, ...values) => {
    if (sql.includes("COUNT(*)")) return [{ c: 1n }];
    return [ticket];
  });

  const res = await get("?page=1&limit=100&exclude_status=pending", {
    "x-crud-api-key": KEY,
  });
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.status, true);
  const listQuery = calls.find(
    (c) => c.kind === "queryRawUnsafe" && c.sql.includes("ORDER BY"),
  );
  assert.ok(listQuery.sql.includes("NOT IN"));
  assert.ok(listQuery.sql.includes("ticket_statuses"));
  assert.ok(listQuery.values.includes("pending"));
});

test("A: admin session is accepted without an API key", async () => {
  setSession({ adminUser: { userId: 1, username: "tester", role: "admin", name: "Tester" } });
  setQueryRawUnsafe(async () => [ticket]);

  const res = await get("?id=1");

  assert.equal(res.status, 200);
  assert.equal((await res.json()).data.ticket_number, TICKET);
});

test("B: wrong API key is rejected without echoing either key", async () => {
  const res = await get("?page=1", { "x-crud-api-key": "wrong-key-value-123" });
  const text = await res.text();

  assert.equal(res.status, 401);
  assert.equal(JSON.parse(text).status, false);
  assert.ok(!text.includes(KEY));
  assert.ok(!text.includes("wrong-key-value-123"));
  assert.ok(!output.text().includes(KEY));
  assert.equal(calls.length, 0, "no database access before authentication");
});

test("B: missing credentials are rejected", async () => {
  const res = await get("?page=1");

  assert.equal(res.status, 401);
  assert.equal(calls.length, 0);
});

test("C: without CRUD_API_KEY configured, no header value is accepted", async () => {
  delete process.env.CRUD_API_KEY;

  for (const value of ["", "undefined", KEY]) {
    const res = await get("?page=1", { "x-crud-api-key": value });
    assert.equal(res.status, 401);
  }
  assert.equal(calls.length, 0);
});

test("D: database failure returns a JSON 500 without exposing the API key", async () => {
  setQueryRaw(async () => [{ c: 0n }]);
  setQueryRawUnsafe(async () => {
    throw new Error("Can't reach database server at `db.test.invalid:3306`");
  });

  const res = await get("?page=1", { "x-crud-api-key": KEY });
  const text = await res.text();

  assert.equal(res.status, 500);
  assert.equal(JSON.parse(text).status, false);
  assert.ok(!text.includes(KEY));
});

test("E: unknown ticket id returns 404", async () => {
  setQueryRawUnsafe(async () => []);

  const res = await get("?id=999999", { "x-crud-api-key": KEY });

  assert.equal(res.status, 404);
  assert.deepEqual(await res.json(), { status: false, message: "Record not found." });
});
