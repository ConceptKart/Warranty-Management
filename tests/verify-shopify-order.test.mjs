import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { shopifyOrderIdVariants, verifyOrder } from "@/lib/portal/verify-order";
import { resetDb, setQueryRaw, setExecuteRaw } from "@/lib/db";
import { resetExternal, setExternalQuery } from "@/lib/db-external-shipway";
import { installFetchStub, jsonResponse, setEnv } from "./helpers.mjs";

let net;
let restoreEnv;

function shopifyAdminOrder() {
  return {
    id: 999000320114,
    name: "#CK320114",
    order_number: 320114,
    created_at: "2026-10-19T13:38:00+05:30",
    email: "radhe81789@gmail.com",
    fulfillments: [{ tracking_number: "8010125560" }],
    shipping_address: {
      first_name: "Radhe",
      last_name: "Baidya",
      address1: "Concept Kart 2nd Floor",
      city: "New Delhi",
      province: "Delhi",
      zip: "110028",
      phone: "+918177894885",
    },
    line_items: [
      { sku: "AC-Sparkly-DE-C-TypeC-4.4", quantity: 1, barcode: "8900001" },
      { sku: "QKZK-AK8-IEM-Grn-3.5", quantity: 1, barcode: "8900002" },
    ],
  };
}

beforeEach(() => {
  resetDb();
  resetExternal();
  restoreEnv = setEnv({
    SHOPIFY_STORE: "concept-kart.myshopify.com",
    SHOPIFY_ACCESS_TOKEN: "shpat_test_token_not_real",
    SHOPIFY_API_VERSION: "2025-10",
    BASELINKER_TOKEN: undefined,
    BASELINKER_API_URL: undefined,
  });
  net = installFetchStub();
  setExternalQuery(async () => []);
});

afterEach(() => {
  net.restore();
  restoreEnv();
});

test("shopify order id variants include hashed, CK, and digits", () => {
  const ids = shopifyOrderIdVariants("#CK320114");
  assert.ok(ids.includes("#CK320114"));
  assert.ok(ids.includes("CK320114"));
  assert.ok(ids.includes("320114"));
});

test("website verify imports from Shopify Admin when shopify_orders is empty", async () => {
  let inserted = false;
  const itemRows = [
    {
      shopify_order_id: "#CK320114",
      order_date: new Date("2026-10-19T08:08:00Z"),
      product_id: 0,
      variant_id: 0,
      sku: "AC-Sparkly-DE-C-TypeC-4.4",
      qty: 1,
      customer_name: "Radhe Baidya",
      phone_number: "+918177894885",
      email: "radhe81789@gmail.com",
      customer_address: "Concept Kart 2nd Floor",
      city: "New Delhi",
      state: "Delhi",
      pincode: "110028",
      order_ean: "8900001",
      v_warranty: null,
      p_warranty: 12,
    },
  ];

  setQueryRaw(async (sql) => {
    if (sql.includes("FROM shopify_orders") && sql.includes("SELECT so.shopify_order_id")) {
      return inserted ? itemRows : [];
    }
    if (sql.includes("SELECT id FROM shopify_orders")) return [];
    if (sql.includes("FROM shopify_orders") && sql.includes("LIKE")) {
      return inserted ? itemRows : [];
    }
    if (sql.includes("SELECT awb_number FROM shopify_orders")) {
      return inserted ? [{ awb_number: "8010125560" }] : [];
    }
    return [];
  });
  setExecuteRaw(async () => {
    inserted = true;
    return 1;
  });

  net.respondWith((url) => {
    if (String(url).includes("myshopify.com")) {
      return jsonResponse({ orders: [shopifyAdminOrder()] });
    }
    return jsonResponse({});
  });

  const result = await verifyOrder("#CK320114", "website");
  assert.equal(result.success, true);
  assert.equal(result.order.order_id, "#CK320114");
  assert.ok(result.products.length >= 1);
  assert.ok(net.calls.some((call) => String(call.url).includes("myshopify.com")));
});

test("website verify still says not found when Shopify Admin also misses", async () => {
  setQueryRaw(async () => []);
  net.respondWith(() => jsonResponse({ orders: [] }));

  const result = await verifyOrder("#CK320114", "website");
  assert.equal(result.success, false);
  assert.match(result.error, /Order not found/i);
});
