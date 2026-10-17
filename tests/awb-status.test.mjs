import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { lookupAwbStatusesFromExternal } from "@/lib/admin/external-shipment-sync";
import { resetExternal, setExternalQuery } from "@/lib/db-external-shipway";
import { installFetchStub, jsonResponse, setEnv } from "./helpers.mjs";

beforeEach(() => {
  resetExternal();
});

afterEach(() => {
  resetExternal();
});

test("return AWB in Shipway orders with RETURN DELIVERED is reverse, not N/A", async () => {
  setExternalQuery(async (sql) => {
    if (sql.includes("FROM orders")) {
      return [
        {
          awb_number: "90692546814",
          shipment_status: "RETURN DELIVERED",
          courier_name: "Bluedart",
          updated_at: "2026-10-16 10:00:00",
        },
      ];
    }
    return [];
  });

  const results = await lookupAwbStatusesFromExternal(["90692546814"], {
    persist: false,
  });
  assert.equal(results["90692546814"].display_status, "RETURN DELIVERED");
  assert.equal(results["90692546814"].mapped_status, "return_delivered");
  assert.equal(results["90692546814"].type, "reverse");
  assert.equal(results["90692546814"].courier, "Bluedart");
});

test("prefer shipway_return_orders when both tables have the AWB", async () => {
  setExternalQuery(async (sql) => {
    if (sql.includes("FROM orders")) {
      return [
        {
          awb_number: "90692546814",
          shipment_status: "IN TRANSIT",
          courier_name: "Bluedart",
          updated_at: "2026-10-10 10:00:00",
        },
      ];
    }
    return [
      {
        tracking_number: "90692546814",
        tracking_status: "RETURN DELIVERED",
        carrier: "Bluedart",
        state_updated_at: "2026-10-16 10:00:00",
        status: "delivered",
      },
    ];
  });

  const results = await lookupAwbStatusesFromExternal(["90692546814"], {
    persist: false,
  });
  assert.equal(results["90692546814"].display_status, "RETURN DELIVERED");
  assert.equal(results["90692546814"].type, "reverse");
});

test("forward DELIVERED stays forward", async () => {
  setExternalQuery(async (sql) => {
    if (sql.includes("FROM orders")) {
      return [
        {
          awb_number: "111",
          shipment_status: "DELIVERED",
          courier_name: "Bluedart",
          updated_at: "2026-10-16 10:00:00",
        },
      ];
    }
    return [];
  });

  const results = await lookupAwbStatusesFromExternal(["111"], { persist: false });
  assert.equal(results["111"].display_status, "DELIVERED");
  assert.equal(results["111"].mapped_status, "delivered");
  assert.equal(results["111"].type, "forward");
});

test("RINT on a return AWB stays reverse, not forward AWB assigned", async () => {
  setExternalQuery(async (sql) => {
    if (sql.includes("FROM orders")) {
      return [
        {
          awb_number: "90699301114",
          shipment_status: "RINT",
          courier_name: "Bluedart",
          updated_at: "2026-10-16 17:13:24",
        },
      ];
    }
    return [];
  });

  const results = await lookupAwbStatusesFromExternal(["90699301114"], {
    persist: false,
    expectedTypes: { "90699301114": "reverse" },
  });
  assert.equal(results["90699301114"].type, "reverse");
  assert.equal(results["90699301114"].mapped_status, "return_in_transit");
  assert.equal(results["90699301114"].display_status, "RINT");
  assert.equal(results["90699301114"].needs_action, false);
});

test("falls back to Shipway API when replica has no AWB", async () => {
  setExternalQuery(async () => []);
  const restoreEnv = setEnv({
    SHIPWAY_EMAIL: "ops@example.com",
    SHIPWAY_API_KEY: "test-key",
  });
  const net = installFetchStub();
  net.respondWith((url) => {
    if (String(url).includes("awb_numbers=90692546814")) {
      return jsonResponse({
        orders: [
          {
            awb: "90692546814",
            current_shipment_status: "RETURN DELIVERED",
            courier: "Bluedart",
          },
        ],
      });
    }
    return jsonResponse({ orders: [] });
  });
  try {
    const results = await lookupAwbStatusesFromExternal(["90692546814"], {
      persist: false,
    });
    assert.equal(results["90692546814"].display_status, "RETURN DELIVERED");
    assert.equal(results["90692546814"].mapped_status, "return_delivered");
    assert.equal(results["90692546814"].type, "reverse");
    assert.equal(results["90692546814"].courier, "Bluedart");
  } finally {
    net.restore();
    restoreEnv();
  }
});
