import assert from "node:assert/strict";
import { test } from "node:test";
import { compactPortalOrderData } from "@/lib/portal/compact-session";

test("compactPortalOrderData drops duplicate billing address and long fields", () => {
  const longAddr = "A".repeat(400);
  const compacted = compactPortalOrderData({
    success: true,
    order: {
      order_id: "#CK1",
      date_add: 1,
      external_order_id: "#CK1",
      order_status_name: "Shopify Order",
    },
    products: [
      {
        product_id: "1",
        name: "N".repeat(200),
        sku: "SKU-1",
        ean: "123",
        quantity: 1,
        warranty_months: 12,
        warranty_valid: true,
        warranty_expiry: "2027-01-01",
        warranty_days_remaining: 10,
        warranty_status: "active",
      },
    ],
    customer: {
      name: "Kartik",
      email: "a@b.com",
      phone: "+9190",
      billing_address: {
        address: longAddr,
        city: "Jaipur",
        state: "RJ",
        zipcode: "302001",
        country: "India",
      },
      shipping_address: {
        address: longAddr,
        city: "Jaipur",
        state: "RJ",
        zipcode: "302001",
        country: "India",
      },
    },
    warranty: { is_valid: true, expiry_date: "2027-01-01", days_remaining: 10 },
    replacement: { is_eligible: false, expiry_date: null, days_remaining: 0 },
    is_shopify_order: true,
    claim_type: "warranty",
  });

  assert.equal(compacted.customer.billing_address.address, "");
  assert.ok(compacted.customer.shipping_address.address.length <= 180);
  assert.ok(compacted.products[0].name.length <= 80);
  const json = JSON.stringify(compacted);
  assert.ok(json.length < 2500, json.length);
});

test("compactPortalOrderData keeps shipping and drops duplicate billing", () => {
  const compacted = compactPortalOrderData({
    success: true,
    order: {
      order_id: "#CK316743",
      date_add: 1,
      external_order_id: "#CK316743",
      order_status_name: "Shopify Order",
    },
    products: [
      {
        product_id: "p1",
        name: "AC Note Plus",
        sku: "AC-Note-Plus-DAC-Gry",
        quantity: 1,
        warranty_months: 12,
        warranty_valid: true,
        warranty_expiry: "2027-01-01",
        warranty_days_remaining: 90,
        warranty_status: "active",
      },
    ],
    customer: {
      name: "Kartik Kumavat",
      email: "kkrkartik333@gmail.com",
      phone: "+919075085019",
      billing_address: {
        address: "House 12 Street",
        city: "Jaipur",
        state: "Rajasthan",
        zipcode: "302001",
        country: "India",
      },
      shipping_address: {
        address: "House 12 Street",
        city: "Jaipur",
        state: "Rajasthan",
        zipcode: "302001",
        country: "India",
      },
    },
    warranty: { is_valid: true, expiry_date: "2027-01-01", days_remaining: 90 },
    replacement: { is_eligible: false, expiry_date: null, days_remaining: 0 },
    is_shopify_order: true,
    claim_type: "warranty",
  });

  assert.equal(compacted.customer.shipping_address.city, "Jaipur");
  assert.equal(compacted.customer.billing_address.address, "");
  assert.equal(compacted.products[0].sku, "AC-Note-Plus-DAC-Gry");
});
