import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { lookupShopifyOrderClassification } from "@/lib/portal/shopify-classification";
import { shopifyFulfillmentDelivery } from "@/lib/shopify/admin-client";
import { resetDb, setQueryRaw } from "@/lib/db";
import { resetExternal, setExternalQuery } from "@/lib/db-external-shipway";
import { installFetchStub, jsonResponse, setEnv } from "./helpers.mjs";

let net;
let restoreEnv;

beforeEach(() => {
  resetDb();
  resetExternal();
  restoreEnv = setEnv({
    SHOPIFY_STORE: "concept-kart.myshopify.com",
    SHOPIFY_ACCESS_TOKEN: "shpat_test_token_not_real",
    SHOPIFY_API_VERSION: "2025-10",
  });
  net = installFetchStub();
  setQueryRaw(async () => [{ awb_number: "8010125560" }]);
});

afterEach(() => {
  net.restore();
  restoreEnv();
});

test("fulfilled without delivered is not treated as delivered", () => {
  const result = shopifyFulfillmentDelivery({
    fulfillment_status: "fulfilled",
    fulfillments: [{ tracking_number: "8010125560", shipment_status: "in_transit" }],
  });
  assert.equal(result.delivered, false);
});

test("Shopify shipment_status delivered is trusted", () => {
  const result = shopifyFulfillmentDelivery({
    fulfillments: [
      {
        tracking_number: "8010125560",
        shipment_status: "delivered",
        delivered_at: "2026-10-21T10:00:00+05:30",
      },
    ],
  });
  assert.equal(result.delivered, true);
  assert.ok(result.deliveredAt);
});

test("stale Shipway AWB ASSIGNED yields replacement when Shopify is delivered", async () => {
  setExternalQuery(async () => [
    { shipment_status: "AWB ASSIGNED", updated_at: "2026-10-19 14:00:00" },
  ]);
  net.respondWith(() =>
    jsonResponse({
      orders: [
        {
          name: "#CK320114",
          fulfillments: [
            {
              tracking_number: "8010125560",
              shipment_status: "delivered",
              delivered_at: "2026-10-21T10:00:00+05:30",
            },
          ],
        },
      ],
    }),
  );

  const result = await lookupShopifyOrderClassification("#CK320114");
  assert.equal(result.type, "replacement");
  assert.equal(result.awb, "8010125560");
  assert.equal(result.reason, "shopify_delivered");
});

test("stale Shipway AWB ASSIGNED still blocks when Shopify is not delivered", async () => {
  setExternalQuery(async () => [
    { shipment_status: "AWB ASSIGNED", updated_at: "2026-10-19 14:00:00" },
  ]);
  net.respondWith(() =>
    jsonResponse({
      orders: [
        {
          name: "#CK320114",
          fulfillments: [
            {
              tracking_number: "8010125560",
              shipment_status: "in_transit",
            },
          ],
        },
      ],
    }),
  );

  const result = await lookupShopifyOrderClassification("#CK320114");
  assert.equal(result.type, "blocked");
  assert.equal(result.status, "AWB ASSIGNED");
});
