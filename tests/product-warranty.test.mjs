import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { backfillProductWarranties } from "@/lib/cron/backfill-warranty";
import { calls, resetDb, setExecuteRaw, setQueryRaw } from "@/lib/db";
import {
  compactSku,
  indicatesNoWarranty,
  parseWarrantyMonths,
  resolveProductWarranty,
} from "@/lib/portal/product-warranty";
import { verifyOrder } from "@/lib/portal/verify-order";
import { captureConsole, installFetchStub, jsonResponse, setEnv } from "./helpers.mjs";

const TOKEN = "test-baselinker-token-not-real";
const API_URL = "https://baselinker.test.invalid/connector.php";

function blApi(catalog, list = {}) {
  return (_url, init) => {
    const body = new URLSearchParams(init.body);
    const method = body.get("method");
    const params = JSON.parse(body.get("parameters") || "{}");
    if (method === "getInventoryProductsData") {
      const products = {};
      for (const id of params.products ?? []) {
        if (catalog[String(id)]) products[String(id)] = catalog[String(id)];
      }
      return jsonResponse({ status: "SUCCESS", products });
    }
    if (method === "getInventoryProductsList") {
      return jsonResponse({ status: "SUCCESS", products: list });
    }
    return jsonResponse({
      status: "ERROR",
      error_code: "ERROR_UNKNOWN_METHOD",
      error_message: method,
    });
  };
}

function dispatchSql(sql, state) {
  if (sql.includes("SELECT DISTINCT") && sql.includes("shopify_orders")) {
    return state.missingSkus ?? [];
  }
  if (sql.includes("COUNT(*)")) return [{ c: BigInt(state.orderRows?.length ?? 0) }];
  if (sql.includes("FROM products")) return state.products ?? [];
  if (sql.includes("FROM amazon_order_details") || sql.includes("FROM shopify_orders")) {
    return state.orderRows ?? [];
  }
  if (sql.includes("FROM amazon_sku_mapping")) return state.mapping ?? [];
  if (sql.includes("FROM bl_products") && sql.includes("warranty IS NOT NULL")) {
    return state.blWarranty ?? [];
  }
  if (sql.includes("FROM bl_products") && sql.includes("warranty IS NULL")) {
    return state.blEmpty ?? [];
  }
  if (sql.includes("FROM bl_products") && sql.includes("product_id IS NOT NULL")) {
    return state.blIds ?? [];
  }
  return [];
}

let net;
let restoreEnv;
let output;

beforeEach(() => {
  resetDb();
  restoreEnv = setEnv({ BASELINKER_TOKEN: TOKEN, BASELINKER_API_URL: API_URL });
  net = installFetchStub();
  output = captureConsole();
  setExecuteRaw(async () => 1);
});

afterEach(() => {
  output.restore();
  net.restore();
  restoreEnv();
});

test("parseWarrantyMonths reads year/month text and never defaults to 12", () => {
  assert.equal(parseWarrantyMonths("3 MONTHS"), 3);
  assert.equal(parseWarrantyMonths("1 year"), 12);
  assert.equal(parseWarrantyMonths("no warranty is provided"), 0);
  assert.equal(parseWarrantyMonths(""), 0);
  assert.equal(parseWarrantyMonths(null), 0);
  assert.equal(compactSku("CK-AB 12"), "ckab12");
  assert.equal(indicatesNoWarranty("Warranty not available"), true);
});

test("resolve uses mapping months first and does not call BaseLinker", async () => {
  net.respondWith(() => {
    throw new Error("BaseLinker should not be called");
  });
  const resolved = await resolveProductWarranty({ sku: "SKU-1", mappingMonths: 6 });
  assert.equal(resolved.source, "mapping");
  assert.equal(resolved.months, 6);
  assert.equal(resolved.text, "6 months");
  assert.equal(net.calls.length, 0);
  assert.ok(calls.some((c) => c.kind === "executeRaw" && c.sql.includes("UPDATE bl_products")));
});

test("resolve uses products.warranty_period_months first, even if mapping and bl_products have values", async () => {
  net.respondWith(() => {
    throw new Error("BaseLinker should not be called");
  });
  setQueryRaw(async (sql) => {
    if (sql.includes("FROM products")) {
      assert.ok(sql.includes("product_sku"));
      return [{ warranty_period_months: 12 }];
    }
    if (sql.includes("FROM bl_products")) {
      return [{ warranty: "18 months", product_id: 99 }];
    }
    return [];
  });
  const resolved = await resolveProductWarranty({
    sku: "tanchjim-bunny-IEM-Clr-Mic-Type C",
    mappingMonths: 24,
    catalogProductId: 111,
  });
  assert.equal(resolved.source, "products");
  assert.equal(resolved.months, 12);
  assert.equal(resolved.text, "1 year");
  assert.equal(net.calls.length, 0);
});

test("resolve uses bl_products.warranty when the product table has no period", async () => {
  setQueryRaw(async (sql, values) => {
    if (sql.includes("FROM products")) return [];
    if (sql.includes("FROM bl_products") && sql.includes("warranty IS NOT NULL")) {
      assert.equal(values[1], compactSku("CK-AA-01"));
      return [{ warranty: "18 months", product_id: 99 }];
    }
    return [];
  });
  const resolved = await resolveProductWarranty({ sku: "CK-AA-01" });
  assert.equal(resolved.source, "bl_products");
  assert.equal(resolved.months, 18);
  assert.equal(net.calls.length, 0);
});

test("resolve uses amazon_sku_mapping.base_sku when catalog warranty is empty", async () => {
  setQueryRaw(async (sql) => {
    if (sql.includes("FROM amazon_sku_mapping")) {
      assert.ok(sql.includes("base_sku"));
      assert.ok(!sql.includes("TRIM(sku)"));
      return [{ warranty_given: 24 }];
    }
    return [];
  });
  const resolved = await resolveProductWarranty({ sku: "MAP-SKU" });
  assert.equal(resolved.source, "mapping_sku");
  assert.equal(resolved.months, 24);
  assert.equal(resolved.text, "2 years");
  assert.ok(calls.some((c) => c.kind === "executeRaw"));
});

test("resolve continues when mapping-by-SKU query fails", async () => {
  setQueryRaw(async (sql) => {
    if (sql.includes("FROM amazon_sku_mapping")) {
      throw new Error("Unknown column 'sku' in 'WHERE'");
    }
    return [];
  });
  net.respondWith(() =>
    jsonResponse({ status: "ERROR", error_code: "TIMEOUT", error_message: "down" }),
  );
  const resolved = await resolveProductWarranty({ sku: "CK/EARPHONECASE/Pck-1/BLACKCASE" });
  assert.equal(resolved.source, "none");
  assert.equal(resolved.months, 0);
});

test("Shopify verify still succeeds when mapping months are 0 and mapping-by-SKU fails", async () => {
  setQueryRaw(async (sql) => {
    if (
      sql.includes("FROM amazon_sku_mapping") &&
      !sql.includes("FROM shopify_orders")
    ) {
      throw new Error("Unknown column 'sku' in 'WHERE'");
    }
    return dispatchSql(sql, {
      orderRows: [
        {
          shopify_order_id: "#CK290897",
          order_date: new Date("2026-08-15T20:15:48Z"),
          product_id: 0,
          variant_id: 0,
          sku: "CK/EARPHONECASE/Pck-1/BLACKCASE",
          qty: 1,
          customer_name: "Test Customer",
          phone_number: "9999999999",
          email: "t@example.com",
          customer_address: "addr",
          city: "city",
          state: "state",
          pincode: "000000",
          v_warranty: null,
          p_warranty: null,
        },
      ],
    });
  });
  net.respondWith(() =>
    jsonResponse({ status: "ERROR", error_code: "TIMEOUT", error_message: "down" }),
  );

  const result = await verifyOrder("#CK290897", "website");
  assert.equal(result.success, true);
  assert.equal(result.products[0].sku, "CK/EARPHONECASE/Pck-1/BLACKCASE");
});

test("resolve falls back to BaseLinker extra_field_1281 and writes it back", async () => {
  setQueryRaw(async (sql) => {
    if (sql.includes("FROM bl_products") && sql.includes("product_id IS NOT NULL")) {
      return [{ product_id: 4401 }];
    }
    return [];
  });
  net.respondWith(
    blApi({
      4401: {
        sku: "LIVE-SKU",
        text_fields: { extra_field_1281: "9 months" },
      },
    }),
  );

  const resolved = await resolveProductWarranty({ sku: "LIVE-SKU" });
  assert.equal(resolved.source, "baselinker");
  assert.equal(resolved.months, 9);
  assert.equal(resolved.text, "9 months");
  assert.ok(
    calls.some(
      (c) =>
        c.kind === "executeRaw" &&
        c.sql.includes("UPDATE bl_products") &&
        c.values.includes("9 months"),
    ),
  );
});

test("resolve prefers parent extra_field_1281 over the variant field", async () => {
  setQueryRaw(async () => []);
  net.respondWith(
    blApi(
      {
        77: {
          sku: "CHILD-SKU",
          parent_product_id: 70,
          text_fields: { extra_field_1281: "no warranty" },
        },
        70: {
          sku: "PARENT-SKU",
          text_fields: { extra_field_1281: "1 year" },
        },
      },
      { 77: { sku: "CHILD-SKU" } },
    ),
  );

  const resolved = await resolveProductWarranty({ sku: "CHILD-SKU" });
  assert.equal(resolved.source, "baselinker");
  assert.equal(resolved.months, 12);
  assert.equal(resolved.text, "1 year");
});

test("resolve does not invent 12 months when BaseLinker is down", async () => {
  setQueryRaw(async () => []);
  net.respondWith(() => jsonResponse({ status: "ERROR", error_code: "TIMEOUT", error_message: "down" }));
  const resolved = await resolveProductWarranty({ sku: "MISSING-SKU" });
  assert.equal(resolved.source, "none");
  assert.equal(resolved.months, 0);
  assert.equal(resolved.text, null);
});

test("stored no-warranty text is not treated as a period", async () => {
  setQueryRaw(async (sql) => {
    if (sql.includes("warranty IS NOT NULL")) {
      return [{ warranty: "No warranty is provided", product_id: 1 }];
    }
    return [];
  });
  const resolved = await resolveProductWarranty({ sku: "NONE-SKU" });
  assert.equal(resolved.months, 0);
  assert.equal(net.calls.length, 0);
});

test("Amazon verify uses live warranty months without defaulting to 12", async () => {
  setQueryRaw(async (sql) =>
    dispatchSql(sql, {
      orderRows: [
        {
          id: 11,
          amazon_order_id: "403-111",
          sku: "AMZ-SKU",
          amazon_title: "Test product",
          order_date: new Date("2026-09-01T10:00:00Z"),
          aod_product_id: 0,
          aod_variant_id: 0,
          v_warranty: null,
          p_warranty: null,
        },
      ],
      blIds: [{ product_id: 8801 }],
    }),
  );
  net.respondWith(
    blApi({
      8801: { sku: "AMZ-SKU", text_fields: { extra_field_1281: "6 months" } },
    }),
  );

  const result = await verifyOrder("403-111", "amazon");
  assert.equal(result.success, true);
  assert.equal(result.products[0].warranty_months, 6);
  assert.equal(result.products[0].warranty_status, "active");
});

test("resolve falls back to BaseLinker SKU search when catalog product_id is not a BL id", async () => {
  setExecuteRaw(async (sql) => (sql.includes("INSERT") ? 1 : 0));
  setQueryRaw(async () => []);
  net.respondWith(
    blApi(
      {
        999001: {
          sku: "COZOY-D1-IEM-Blu-Mic-3.5",
          text_fields: { extra_field_1281: "1 year" },
        },
      },
      { 999001: { sku: "COZOY-D1-IEM-Blu-Mic-3.5" } },
    ),
  );

  const resolved = await resolveProductWarranty({
    sku: "COZOY-D1-IEM-Blu-Mic-3.5",
    catalogProductId: 13078459,
  });
  assert.equal(resolved.source, "baselinker");
  assert.equal(resolved.months, 12);
  assert.ok(
    calls.some((c) => c.kind === "executeRaw" && c.sql.includes("INSERT INTO bl_products")),
  );
  assert.ok(
    calls.some(
      (c) =>
        c.kind === "executeRaw" &&
        c.sql.includes("INSERT INTO amazon_sku_mapping") &&
        c.sql.includes("base_sku"),
    ),
  );
});

test("backfill writes extra_field_1281 onto empty bl_products rows", async () => {
  setQueryRaw(async (sql) =>
    dispatchSql(sql, {
      blEmpty: [
        { product_id: 501, sku: "BF-1" },
        { product_id: 502, sku: "BF-2" },
      ],
    }),
  );
  net.respondWith(
    blApi({
      501: { text_fields: { extra_field_1281: "12 months" } },
      502: { text_fields: { extra_field_1281: "no warranty" } },
    }),
  );

  const result = await backfillProductWarranties({ limit: 10, dryRun: false });
  assert.equal(result.scanned, 2);
  assert.equal(result.filled, 1);
  assert.equal(result.skipped, 1);
  assert.ok(
    calls.some(
      (c) =>
        c.kind === "executeRaw" &&
        c.sql.includes("UPDATE bl_products") &&
        c.values.includes("12 months"),
    ),
  );
});

test("backfill upserts warranty for order SKUs missing from bl_products", async () => {
  setExecuteRaw(async (sql) => (sql.includes("INSERT") ? 1 : 0));
  setQueryRaw(async (sql) =>
    dispatchSql(sql, {
      missingSkus: [
        {
          sku: "COZOY-D1-IEM-Blu-Mic-3.5",
          product_id: 13078459,
          variant_id: 0,
        },
      ],
    }),
  );
  net.respondWith(
    blApi(
      {
        999001: {
          sku: "COZOY-D1-IEM-Blu-Mic-3.5",
          text_fields: { extra_field_1281: "1 year" },
        },
      },
      { 999001: { sku: "COZOY-D1-IEM-Blu-Mic-3.5" } },
    ),
  );

  const result = await backfillProductWarranties({ limit: 10, dryRun: false });
  assert.equal(result.filled, 1);
  assert.ok(
    calls.some((c) => c.kind === "executeRaw" && c.sql.includes("INSERT INTO bl_products")),
  );
});
