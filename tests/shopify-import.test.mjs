import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { updateCkOrderShipmentStatus } from "@/lib/admin/return-order-status";
import {
  importShopifyOrderByShopId,
  importShopifyOrderDirect,
} from "@/lib/admin/shopify-orders";
import { calls, resetDb, setQueryRaw } from "@/lib/db";
import {
  extCalls,
  resetExternal,
  setExternalQuery,
} from "@/lib/db-external-shipway";
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
  resetExternal();
  restoreEnv = setEnv({
    BASELINKER_TOKEN: TOKEN,
    BASELINKER_API_URL: API_URL,
    SHOPIFY_STORE: "concept-kart.myshopify.com",
    SHOPIFY_ACCESS_TOKEN: "shpat_test_token_not_real",
    SHOPIFY_API_VERSION: "2025-10",
    SHIPWAY_EMAIL: "ops@example.com",
    SHIPWAY_API_KEY: "test-shipway-key",
    SHIPWAY_API_URL: "https://app.shipway.com/api",
  });
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
  assert.equal(result.message, "Order Not Found in BaseLinker");
  assert.equal(result.shopify_order_id, "#CK312248");
  assert.ok(net.calls.length >= 1);
});

test("import inserts line items and skips duplicate base_order_id + product_id", async () => {
  const existing = new Set();
  setQueryRaw(async (sql, values) => {
    if (sql.includes("AND product_id")) {
      const productId = Number(values[values.length - 1]);
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

function shopifyOrderPayload(overrides = {}) {
  return {
    id: 1234567890123,
    name: "#CK282379",
    order_number: 282379,
    created_at: "2026-03-09T12:00:00+05:30",
    email: "buyer@example.com",
    phone: "9999999999",
    fulfillments: [{ tracking_number: "SW123" }],
    shipping_address: {
      first_name: "Test",
      last_name: "Buyer",
      address1: "1 Test St",
      city: "Delhi",
      province: "DL",
      zip: "110001",
      phone: "9999999999",
    },
    line_items: [{ sku: "SKU-101", quantity: 2, barcode: "89000001" }],
    ...overrides,
  };
}

test("direct Shopify import looks up by #CK name and inserts line items", async () => {
  setQueryRaw(async (sql) => {
    if (sql.includes("INSERT") || sql.includes("AND sku")) return [];
    return [
      {
        id: 11,
        shopify_order_id: "#CK282379",
        sku: "SKU-101",
        order_date: new Date("2026-03-09T12:00:00Z"),
        awb_number: "SW123",
        customer_name: "Test Buyer",
        phone_number: "9999999999",
        email: "buyer@example.com",
        city: "Delhi",
        state: "DL",
        pincode: "110001",
        qty: 2,
        ean: 89000001,
        base_order_id: "0",
      },
    ];
  });

  net.respondWith((url) => {
    assert.match(url, /concept-kart\.myshopify\.com/);
    assert.match(url, /name=/);
    return jsonResponse({ status: 200, orders: [shopifyOrderPayload()] });
  });

  const result = await importShopifyOrderDirect("#CK282379");
  assert.equal(result.success, true);
  assert.equal(result.inserted, 1);
  assert.equal(result.skipped, 0);
  assert.equal(result.shopify_order_id, "#CK282379");
  const inserts = calls.filter((c) => c.kind === "executeRaw");
  assert.equal(inserts.length, 1);
  assert.equal(inserts[0].values[0], "0");
  assert.equal(inserts[0].values[2], "#CK282379");
  assert.equal(inserts[0].values[6], "SW123");
});

test("direct Shopify import reports not found when the store has no match", async () => {
  net.respondWith(() => jsonResponse({ orders: [] }));
  const result = await importShopifyOrderDirect("999999");
  assert.equal(result.success, false);
  assert.equal(result.message, "Order Not Found in Shopify Store.");
});

test("shipment status updates return-orders after Shipway tracking", async () => {
  setExternalQuery(async (sql) => {
    if (sql.includes("FROM orders") && sql.includes("awb_number") && !sql.includes("UPDATE")) {
      return [{ order_id: "CK282379", awb_number: "AWB999" }];
    }
    return { affectedRows: 1 };
  });
  net.respondWith((url) => {
    assert.match(url, /tracking\?awb_numbers=AWB999/);
    return jsonResponse([
      { tracking_details: { shipment_status: "DELIVERED" } },
    ]);
  });

  const result = await updateCkOrderShipmentStatus("#ck282379");
  assert.equal(result.success, true);
  assert.equal(result.order_id, "CK282379");
  assert.equal(result.awb, "AWB999");
  assert.equal(result.status, "DELIVERED");
  assert.equal(extCalls[0].params[0], "CK282379");
  assert.match(extCalls[1].sql, /UPDATE orders/);
  assert.equal(extCalls[1].params[0], "DELIVERED");
});

test("shipment status reports order not found in the return-orders DB", async () => {
  setExternalQuery(async () => []);
  const result = await updateCkOrderShipmentStatus("CK000001");
  assert.equal(result.success, false);
  assert.equal(result.message, "Order not found.");
  assert.equal(net.calls.length, 0);
});
