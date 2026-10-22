import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import {
  CLONE_STATUS_ID,
  CLONE_WAREHOUSE_ID,
  cloneOrderWithSelectedProducts,
  matchSelectedCloneProducts,
} from "@/lib/baselinker/clone-order";
import { resetDb, setQueryRaw } from "@/lib/db";
import { installFetchStub, jsonResponse, setEnv } from "./helpers.mjs";

const TOKEN = "test-baselinker-token-not-real";
const API_URL = "https://baselinker.test.invalid/connector.php";

function originalOrder() {
  return {
    order_id: 11850001,
    shop_order_id: 315791,
    external_order_id: "CK315791",
    phone: "9999999999",
    email: "buyer@example.com",
    delivery_fullname: "Test Buyer",
    delivery_address: "1 Test St",
    delivery_city: "Delhi",
    delivery_state: "Delhi",
    delivery_postcode: "110001",
    products: [
      {
        product_id: 101,
        variant_id: 201,
        sku: "TP-MK-209C-Kybrd_Case-Blkk",
        name: "Keyboard Case",
        quantity: 2,
        price_brutto: 499,
      },
    ],
  };
}

function parseCall(call) {
  const body = new URLSearchParams(call.init.body);
  return {
    method: body.get("method"),
    params: JSON.parse(body.get("parameters") || "{}"),
  };
}

let net;
let restoreEnv;

beforeEach(() => {
  resetDb();
  restoreEnv = setEnv({
    BASELINKER_TOKEN: TOKEN,
    BASELINKER_API_URL: API_URL,
  });
  net = installFetchStub();
  setQueryRaw(async () => []);
});

afterEach(() => {
  net.restore();
  restoreEnv();
});

test("selected Shopify session products match original SKUs even with synthetic ids", () => {
  const matched = matchSelectedCloneProducts(originalOrder().products, [
    {
      product_id: "shopify_TP-MK-209C-Kybrd_Case-Blkk__0",
      sku: "TP-MK-209C-Kybrd_Case-Blkk",
      quantity: 1,
    },
  ]);
  assert.equal(matched.length, 1);
  assert.equal(matched[0].original.product_id, 101);
  assert.equal(matched[0].quantity, 1);
});

test("Website clone uses warehouse 9001702, status 8111, and warranty fields", async () => {
  net.respondWith((_url, init) => {
    const body = new URLSearchParams(init.body);
    const method = body.get("method");
    if (method === "getOrders") {
      return jsonResponse({ status: "SUCCESS", orders: [originalOrder()] });
    }
    if (method === "addOrder") {
      return jsonResponse({ status: "SUCCESS", order_id: 12501170 });
    }
    if (method === "setOrderFields") {
      return jsonResponse({ status: "SUCCESS" });
    }
    return jsonResponse({ status: "ERROR", error_message: `unexpected ${method}` }, 400);
  });

  const result = await cloneOrderWithSelectedProducts({
    originalOrderId: "11850001",
    selectedProducts: [
      { sku: "TP-MK-209C-Kybrd_Case-Blkk", quantity: 1 },
    ],
    ticketNumber: "RP20261001688",
    issueDescription: "Keys not working",
    claimType: "replacement",
    uploadedUrls: ["https://files.example.com/a.jpg"],
  });

  assert.equal(result.success, true);
  assert.equal(result.cloned_order_id, 12501170);

  const add = net.calls.map(parseCall).find((call) => call.method === "addOrder");
  assert.ok(add);
  assert.equal(add.params.order_status_id, CLONE_STATUS_ID);
  assert.equal(add.params.products[0].warehouse_id, CLONE_WAREHOUSE_ID);
  assert.equal(add.params.products[0].storage, CLONE_WAREHOUSE_ID);
  assert.equal(add.params.products[0].quantity, 1);
  assert.equal(add.params.delivery_method, "Prepaid Order");

  const fields = net.calls
    .map(parseCall)
    .find((call) => call.method === "setOrderFields");
  assert.ok(fields);
  assert.equal(fields.params.custom_extra_fields["5344"], "10-Day Replacement");
  assert.equal(fields.params.custom_extra_fields["5345"], "RP20261001688");
  assert.equal(fields.params.custom_extra_fields["5356"], "Keys not working");
  assert.equal(
    fields.params.custom_extra_fields["6397"],
    "https://files.example.com/a.jpg",
  );
});

test("clone fails softly when the original BaseLinker order is missing", async () => {
  net.respondWith(() => jsonResponse({ status: "SUCCESS", orders: [] }));
  const result = await cloneOrderWithSelectedProducts({
    originalOrderId: "1",
    selectedProducts: [{ sku: "X", quantity: 1 }],
    ticketNumber: "WR1",
    issueDescription: "x",
    claimType: "warranty",
  });
  assert.equal(result.success, false);
  assert.match(result.error, /not found/i);
});
