import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { lookupAwbStatusesFromExternal } from "@/lib/admin/external-shipment-sync";
import { resetExternal, setExternalQuery } from "@/lib/db-external-shipway";

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
