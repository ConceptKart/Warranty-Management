import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { getReplacementProductInfo } from "@/lib/admin/replacement-ean";
import { resetDb, setQueryRaw } from "@/lib/db";

const CLAIMED_SKU = "AC-Note-Plus-DAC-Gry";
const WRONG_JOIN_PRODUCT = "Kz/Edx/ProX/IEM/Mic/Cyn";

function dispatch(sql) {
  if (sql.includes("FROM warranty_tickets")) {
    return [
      {
        ticket_id: 42,
        ticket_number: "T-1",
        baselinker_order_id: "1001",
        replacement_product_id: null,
        replacement_ean: null,
        selected_products_json: JSON.stringify([
          { name: CLAIMED_SKU, sku: CLAIMED_SKU, quantity: 1 },
        ]),
        product_name: WRONG_JOIN_PRODUCT,
        product_sku: WRONG_JOIN_PRODUCT,
        ean: null,
      },
    ];
  }
  if (sql.includes("FROM products")) {
    return [
      {
        product_id: 99,
        product_name: "AC Note Plus DAC Grey",
        product_sku: CLAIMED_SKU,
        ean: "8901234567890",
      },
    ];
  }
  if (sql.includes("FROM bl_products")) {
    return [
      {
        product_name: "AC Note Plus DAC Grey",
        sku: CLAIMED_SKU,
        ean: "8901234567890",
      },
    ];
  }
  if (sql.includes("FROM shopify_orders") || sql.includes("FROM amazon_order_details")) {
    return [{ ean: "8901234567890" }];
  }
  return [];
}

beforeEach(() => {
  resetDb();
  setQueryRaw(async (sql) => dispatch(sql));
});

afterEach(() => {
  resetDb();
});

test("replacement modal uses the claimed SKU, not a mismatched products join", async () => {
  const result = await getReplacementProductInfo(42);
  assert.equal(result.success, true);
  assert.equal(result.original_product?.product_sku, CLAIMED_SKU);
  assert.notEqual(result.original_product?.product_name, WRONG_JOIN_PRODUCT);
  assert.equal(result.original_product?.product_name, "AC Note Plus DAC Grey");
  assert.equal(result.original_product?.ean, "8901234567890");
});

test("claimed SKU is kept even when catalog lookup is empty", async () => {
  setQueryRaw(async (sql) => {
    if (sql.includes("FROM warranty_tickets")) return dispatch(sql);
    return [];
  });
  const result = await getReplacementProductInfo(42);
  assert.equal(result.success, true);
  assert.equal(result.original_product?.product_sku, CLAIMED_SKU);
  assert.equal(result.original_product?.product_name, CLAIMED_SKU);
  assert.notEqual(result.original_product?.product_name, WRONG_JOIN_PRODUCT);
});
