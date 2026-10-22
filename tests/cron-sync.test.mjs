import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { GET as getShopify } from "@/app/api/cron/sync-shopify/route";
import { GET as getShipments } from "@/app/api/cron/sync-shipments/route";
import { syncShopifyOrders } from "@/lib/cron/shopify-sync";
import {
  authorizeCron,
  getIstDayWindow,
  parseCronDate,
  parseCronDryRun,
  parseCronLimit,
  parseShipmentCronMode,
} from "@/lib/cron/baselinker-client";
import { calls, resetDb } from "@/lib/db";
import { installFetchStub, jsonResponse, setEnv } from "./helpers.mjs";

const TOKEN = "test-baselinker-token-not-real";
const API_URL = "https://baselinker.test.invalid/connector.php";
const SECRET = "cron-secret-for-tests";

function request(path, headers = {}) {
  return new Request(`http://localhost.test${path}`, { headers });
}

let net;
let restoreEnv;

beforeEach(() => {
  resetDb();
  restoreEnv = setEnv({
    BASELINKER_TOKEN: TOKEN,
    BASELINKER_API_URL: API_URL,
    CRON_SECRET: SECRET,
    BASELINKER_SHOPIFY_SOURCE_ID: "9000436",
  });
  net = installFetchStub();
});

afterEach(() => {
  net.restore();
  restoreEnv();
});

test("cron date must be a real YYYY-MM-DD", () => {
  assert.equal(parseCronDate(null).ok, true);
  assert.equal(parseCronDate("2026-10-21").ok, true);
  assert.equal(parseCronDate("21-10-2026").ok, false);
  assert.equal(parseCronDate("2026-02-30").ok, false);
  assert.equal(parseCronDryRun("1"), true);
  assert.equal(parseCronDryRun("no"), false);
  assert.equal(parseCronLimit("0", 200, 1000), 1);
  assert.equal(parseCronLimit("9999", 200, 1000), 1000);
  assert.equal(parseCronLimit("abc", 200, 1000), 200);
});

test("IST day window matches PHP yesterday / --date", () => {
  const day = getIstDayWindow("2026-10-21");
  assert.equal(day.istStart, "2026-10-21 00:00:00");
  assert.equal(day.istEnd, "2026-10-21 23:59:59");
  assert.equal(day.dayEnd - day.dayStart, 86399);
  assert.throws(() => getIstDayWindow("October 21"), /YYYY-MM-DD/);
});

test("shipment cron mode is a whitelist", () => {
  assert.equal(parseShipmentCronMode(null).mode, "changed");
  assert.equal(parseShipmentCronMode("active").mode, "active");
  assert.equal(parseShipmentCronMode("wipe").ok, false);
});

test("cron secret rejects a wrong header and accepts x-cron-secret", () => {
  assert.equal(authorizeCron(request("/api/cron/sync-shopify")).ok, false);
  assert.equal(
    authorizeCron(
      request("/api/cron/sync-shopify", { "x-cron-secret": "nope" }),
    ).ok,
    false,
  );
  assert.equal(
    authorizeCron(
      request("/api/cron/sync-shopify", { "x-cron-secret": SECRET }),
    ).ok,
    true,
  );
});

test("shopify and shipment routes return 401 / 400 before they sync", async () => {
  const unauthorized = await getShopify(request("/api/cron/sync-shopify"));
  assert.equal(unauthorized.status, 401);

  const badDate = await getShopify(
    request("/api/cron/sync-shopify?date=2026-13-40", {
      "x-cron-secret": SECRET,
    }),
  );
  assert.equal(badDate.status, 400);
  assert.equal((await badDate.json()).success, false);
  assert.equal(net.calls.length, 0);

  const badMode = await getShipments(
    request("/api/cron/sync-shipments?mode=wipe", {
      "x-cron-secret": SECRET,
    }),
  );
  assert.equal(badMode.status, 400);
  assert.match((await badMode.json()).error, /mode/i);
});

test("shopify dry-run counts rows and does not write", async () => {
  net.respondWith(() =>
    jsonResponse({
      status: "SUCCESS",
      orders: [
        {
          order_id: 11850001,
          date_add: new Date("2026-10-21T00:30:00+05:30").getTime() / 1000,
          external_order_id: "315791",
          products: [{ product_id: 1, sku: "SKU-1", quantity: 1 }],
        },
      ],
    }),
  );

  const result = await syncShopifyOrders({
    date: "2026-10-21",
    dryRun: true,
  });
  assert.equal(result.dry_run, true);
  assert.equal(result.orders_matched, 1);
  assert.equal(result.rows_upserted, 1);
  assert.equal(
    calls.filter((call) => call.kind === "executeRaw").length,
    0,
  );
});

test("shopify sync skips orders with no BaseLinker id", async () => {
  net.respondWith(() =>
    jsonResponse({
      status: "SUCCESS",
      orders: [
        {
          order_id: "  ",
          date_add: new Date("2026-10-21T00:30:00+05:30").getTime() / 1000,
          products: [{ product_id: 1, sku: "SKU-1", quantity: 1 }],
        },
      ],
    }),
  );

  const result = await syncShopifyOrders({
    date: "2026-10-21",
    dryRun: false,
  });
  assert.equal(result.orders_matched, 0);
  assert.equal(result.rows_upserted, 0);
  assert.equal(
    calls.filter((call) => call.kind === "executeRaw").length,
    0,
  );
});
