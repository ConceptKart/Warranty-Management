import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { createForwardShipment, createReturnShipment } from "@/lib/admin/shipway-service";
import { resetDb, setQueryRaw } from "@/lib/db";
import { captureConsole, installFetchStub, jsonResponse, setEnv } from "./helpers.mjs";

const KEY = "test-shipway-key-not-real-000000";
const EMAIL = "ops@example.test";

const shipment = {
  order_id: "TEST-ORDER-1",
  ticket_number: "WR-TEST-0001",
  product_name: "Test Headphones",
  product_sku: "TEST-SKU-1",
  customer_name: "Test Customer",
  customer_email: "customer@example.test",
  customer_phone: "9000000001",
  customer_address: "1 Test Street",
  customer_city: "Testville",
  customer_state: "Test State",
  customer_zipcode: "000000",
};

const basicAuth = (email, key) => `Basic ${Buffer.from(`${email}:${key}`).toString("base64")}`;

let net;
let output;
let restoreEnv;

beforeEach(() => {
  resetDb();
  restoreEnv = setEnv({
    SHIPWAY_API_KEY: undefined,
    SHIPWAY_EMAIL: undefined,
    SHIPWAY_API_URL: undefined,
    SHIPWAY_TIMEOUT: undefined,
    SHIPWAY_BLUE_DART_CARRIER_ID: undefined,
  });
  net = installFetchStub();
  output = captureConsole();
});

afterEach(() => {
  output.restore();
  net.restore();
  restoreEnv();
});

test("C: with no stored or env API key nothing is sent to Shipway", async () => {
  setQueryRaw(async () => []);

  for (const create of [createReturnShipment, createForwardShipment]) {
    const result = await create(shipment);
    assert.equal(result.success, false);
    assert.match(result.error, /Shipway API credentials are not configured/);
  }
  assert.equal(net.calls.length, 0);
});

test("C: a failed credential lookup does not fall back to a built-in key", async () => {
  setQueryRaw(async () => {
    throw new Error("Can't reach database server");
  });

  const result = await createReturnShipment(shipment);

  assert.equal(result.success, false);
  assert.match(result.error, /not configured/);
  assert.equal(net.calls.length, 0);
});

test("A: env credentials are used when no shipway_config row is active", async () => {
  process.env.SHIPWAY_API_KEY = KEY;
  process.env.SHIPWAY_EMAIL = EMAIL;
  setQueryRaw(async () => []);
  net.respondWith(() =>
    jsonResponse({
      success: 1,
      awb_response: { AWB: "TESTAWB0001", courier_name: "Test Courier", carrier_id: "7" },
      create_return_response: { rma_no: "RMA-TEST-1" },
    }),
  );

  const result = await createReturnShipment(shipment);

  assert.equal(result.success, true);
  assert.equal(result.awb_number, "TESTAWB0001");
  assert.equal(net.calls[0].url, "https://app.shipway.com/api/Createreturns");
  assert.equal(net.calls[0].init.headers.Authorization, basicAuth(EMAIL, KEY));
});

test("A: an active shipway_config row takes precedence over env credentials", async () => {
  process.env.SHIPWAY_API_KEY = KEY;
  process.env.SHIPWAY_EMAIL = EMAIL;
  setQueryRaw(async () => [
    { api_key: "db-key-not-real-000", api_url: null, email: "db@example.test", timeout_seconds: 30 },
  ]);
  net.respondWith(() => jsonResponse({ success: 1, awb_response: { AWB: "TESTAWB0002" } }));

  await createReturnShipment(shipment);

  assert.equal(
    net.calls[0].init.headers.Authorization,
    basicAuth("db@example.test", "db-key-not-real-000"),
  );
});

test("B: rejected credentials return the provider message without leaking the key", async () => {
  process.env.SHIPWAY_API_KEY = KEY;
  process.env.SHIPWAY_EMAIL = EMAIL;
  setQueryRaw(async () => []);
  net.respondWith(() => jsonResponse({ success: 0, message: "Invalid API credentials" }, 401));

  const result = await createReturnShipment(shipment);
  const exposed = JSON.stringify(result) + output.text();

  assert.equal(result.success, false);
  assert.equal(result.http_code, 401);
  assert.equal(result.error, "Invalid API credentials");
  assert.ok(!exposed.includes(KEY));
  assert.ok(!exposed.includes(basicAuth(EMAIL, KEY).slice("Basic ".length)));
});

test("D: provider timeout returns a connection error instead of throwing", async () => {
  process.env.SHIPWAY_API_KEY = KEY;
  process.env.SHIPWAY_EMAIL = EMAIL;
  setQueryRaw(async () => []);
  net.respondWith(() => {
    throw new DOMException("This operation was aborted", "AbortError");
  });

  const result = await createForwardShipment(shipment);

  assert.equal(result.success, false);
  assert.match(result.error, /^Connection error: /);
});

function postedCarrierId(call) {
  return JSON.parse(call.init.body).carrier_id;
}

test("pickups request Blue Dart (carrier_id 1) by default", async () => {
  process.env.SHIPWAY_API_KEY = KEY;
  process.env.SHIPWAY_EMAIL = EMAIL;
  setQueryRaw(async () => []);
  net.respondWith(() =>
    jsonResponse({
      success: 1,
      awb_response: { AWB: "BD123", courier_name: "Blue Dart", carrier_id: "1" },
    }),
  );

  for (const create of [createReturnShipment, createForwardShipment]) {
    net.calls.length = 0;
    const result = await create(shipment);
    assert.equal(result.success, true);
    assert.equal(net.calls.length, 1);
    assert.equal(postedCarrierId(net.calls[0]), "1");
  }
});

test("another courier is requested only when Blue Dart pincode is unserviceable", async () => {
  process.env.SHIPWAY_API_KEY = KEY;
  process.env.SHIPWAY_EMAIL = EMAIL;
  setQueryRaw(async () => []);
  net.respondWith((_url, init) => {
    const carrierId = JSON.parse(init.body).carrier_id;
    if (carrierId === "1") {
      return jsonResponse({
        success: 0,
        message: "Pincode not serviceable for Blue Dart",
      });
    }
    return jsonResponse({
      success: 1,
      awb_response: { AWB: "DLV999", courier_name: "Delhivery", carrier_id: "7" },
    });
  });

  const result = await createReturnShipment(shipment);

  assert.equal(result.success, true);
  assert.equal(result.awb_number, "DLV999");
  assert.equal(net.calls.length, 2);
  assert.equal(postedCarrierId(net.calls[0]), "1");
  assert.equal(postedCarrierId(net.calls[1]), "");
});

test("return_reason_id is sent on each product, not at order root", async () => {
  process.env.SHIPWAY_API_KEY = KEY;
  process.env.SHIPWAY_EMAIL = EMAIL;
  setQueryRaw(async () => []);
  net.respondWith(() =>
    jsonResponse({
      success: 1,
      awb_response: { AWB: "BD124", courier_name: "Blue Dart", carrier_id: "1" },
    }),
  );

  await createReturnShipment(shipment);

  const body = JSON.parse(net.calls[0].init.body);
  const product = body.products[shipment.product_sku];
  assert.equal(body.return_reason_id, undefined);
  assert.equal(product.return_reason_id, 76487);
});

test("non-pincode Shipway errors do not fall back to another courier", async () => {
  process.env.SHIPWAY_API_KEY = KEY;
  process.env.SHIPWAY_EMAIL = EMAIL;
  setQueryRaw(async () => []);
  net.respondWith(() => jsonResponse({ success: 0, message: "Invalid API credentials" }, 401));

  const result = await createReturnShipment(shipment);

  assert.equal(result.success, false);
  assert.equal(result.error, "Invalid API credentials");
  assert.equal(net.calls.length, 1);
  assert.equal(postedCarrierId(net.calls[0]), "1");
});
