import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { importShopifyOrderByShopId } from "@/lib/admin/shopify-orders";
import { calls, resetDb, setQueryRaw } from "@/lib/db";
import { installFetchStub, jsonResponse, setEnv } from "./helpers.mjs";

const TOKEN = "test-baselinker-token-not-real";
const API_URL = "https://baselinker.test.invalid/connector.php";

function blOrder(overrides = {}) {
  return {
    order_id: 555001,
    shop_order_id: 312248,
    date_add: 1710000000,
    delivery_package_nr: "AWB123",
    delivery_fullname: "Test Buyer",
    phone: "9999999999",
    email: "buyer@example.com",
    delivery_address: "1 Test St",
    delivery_city: "Delhi",
    delivery_state: "DL",
    delivery_postcode: "110001",
    products: [
      {
        product_id: 101,
        variant_id: 201,
        sku: "SKU-101",
        quantity: 2,
        ean: "890000000001",
      },
    ],
    ...overrides,
  };
}

let net;
let restoreEnv;

beforeEach(() => {
  resetDb();
  restoreEnv = setEnv({ BASELINKER_TOKEN: TOKEN, BASELINKER_API_URL: API_URL });
  net = installFetchStub();
});

afterEach(() => {
  net.restore();
  restoreEnv();
});

test("import rejects a blank Shopify order id", async () => {
  const result = await importShopifyOrderByShopId("   ");
  assert.equal(result.success, false);
  assert.equal(result.message, "Please enter Shopify Order ID.");
  assert.equal(net.calls.length, 0);
});

test("import reports Order Not Found when BaseLinker returns no orders", async () => {
  net.respondWith(() => jsonResponse({ status: "SUCCESS", orders: [] }));
  const result = await importShopifyOrderByShopId("312248");
  assert.equal(result.success, false);
  assert.equal(result.message, "Order Not Found");
  assert.equal(result.shopify_order_id, "#CK312248");
  assert.ok(net.calls.length >= 1);
});

test("import inserts line items and skips duplicate base_order_id + product_id", async () => {
  const existing = new Set();
  setQueryRaw(async (sql, values) => {
    if (sql.includes("AND product_id")) {
      const productId = Number(values[1]);
      return existing.has(productId) ? [{ id: 1 }] : [];
    }
    return [
      {
        id: 9,
        shopify_order_id: "#CK312248",
        sku: "SKU-101",
        order_date: new Date("2024-03-09T12:00:00Z"),
        awb_number: "AWB123",
        customer_name: "Test Buyer",
        phone_number: "9999999999",
        email: "buyer@example.com",
        city: "Delhi",
        state: "DL",
        pincode: "110001",
        qty: 2,
        ean: 890000000001,
        base_order_id: "555001",
      },
    ];
  });

  net.respondWith((_url, init) => {
    const params = JSON.parse(new URLSearchParams(init.body).get("parameters"));
    assert.equal(params.filter_shop_order_id, 312248);
    return jsonResponse({ status: "SUCCESS", orders: [blOrder()] });
  });

  const first = await importShopifyOrderByShopId("#CK312248");
  assert.equal(first.success, true);
  assert.equal(first.inserted, 1);
  assert.equal(first.skipped, 0);
  assert.equal(first.shopify_order_id, "#CK312248");
  const inserts = calls.filter((c) => c.kind === "executeRaw");
  assert.equal(inserts.length, 1);
  assert.match(inserts[0].sql, /INSERT INTO shopify_orders/);
  assert.equal(inserts[0].values[2], "#CK312248");

  existing.add(101);
  const second = await importShopifyOrderByShopId("312248");
  assert.equal(second.success, true);
  assert.equal(second.inserted, 0);
  assert.equal(second.skipped, 1);
});
