import type { IronSession } from "iron-session";
import type { PortalOrderData, PortalSessionData } from "@/lib/portal/session";

const emptyAddress = {
  address: "",
  city: "",
  state: "",
  zipcode: "",
  country: "India",
};

function clip(value: string | null | undefined, max: number) {
  return String(value ?? "").slice(0, max);
}

function compactAddress(input?: {
  address?: string;
  city?: string;
  state?: string;
  zipcode?: string;
  country?: string;
}) {
  return {
    address: clip(input?.address, 180),
    city: clip(input?.city, 60),
    state: clip(input?.state, 60),
    zipcode: clip(input?.zipcode, 20),
    country: clip(input?.country || "India", 40),
  };
}

export function compactPortalOrderData(
  data: PortalOrderData,
): PortalOrderData {
  const shipping = compactAddress(
    data.customer.shipping_address?.address
      ? data.customer.shipping_address
      : data.customer.billing_address,
  );
  return {
    success: true,
    order: {
      order_id: clip(data.order.order_id, 40),
      date_add: data.order.date_add,
      external_order_id: clip(data.order.external_order_id, 40),
      order_status_name: clip(data.order.order_status_name, 40),
    },
    products: data.products.map((p) => ({
      product_id: p.product_id,
      name: clip(p.name, 80),
      sku: clip(p.sku, 80),
      ...(p.ean ? { ean: clip(p.ean, 20) } : {}),
      quantity: p.quantity,
      ...(p.variant_id != null && String(p.variant_id) !== "0"
        ? { variant_id: p.variant_id }
        : {}),
      warranty_months: p.warranty_months,
      warranty_valid: p.warranty_valid,
      warranty_expiry: p.warranty_expiry,
      warranty_days_remaining: p.warranty_days_remaining,
      warranty_status: p.warranty_status,
    })),
    customer: {
      name: clip(data.customer.name, 80),
      email: clip(data.customer.email, 120),
      phone: clip(data.customer.phone, 20),
      shipping_address: shipping,
      billing_address: emptyAddress,
    },
    warranty: data.warranty,
    replacement: {
      is_eligible: Boolean(data.replacement?.is_eligible),
      expiry_date: data.replacement?.expiry_date ?? null,
      days_remaining: data.replacement?.days_remaining ?? 0,
      days_since_delivery: data.replacement?.days_since_delivery ?? null,
    },
    is_amazon_order: data.is_amazon_order,
    is_shopify_order: data.is_shopify_order,
    claim_type: data.claim_type,
  };
}

function slimSelectedProductsJson(raw: string | undefined) {
  if (!raw?.trim()) return raw;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return raw;
    return JSON.stringify(
      parsed.map((row) => {
        const item = row as {
          product_id?: string | number;
          sku?: string;
          name?: string;
          ean?: string;
          quantity?: number;
        };
        return {
          product_id: item.product_id,
          sku: clip(item.sku, 80),
          name: clip(item.name, 80),
          ...(item.ean ? { ean: clip(item.ean, 20) } : {}),
          quantity: item.quantity ?? 1,
        };
      }),
    );
  } catch {
    return raw;
  }
}

function sessionPayloadBytes(session: IronSession<PortalSessionData>) {
  return Buffer.byteLength(
    JSON.stringify({
      orderData: session.orderData,
      platform: session.platform,
      selectedIssueId: session.selectedIssueId,
      selectedProduct: session.selectedProduct,
      selectedProductsJson: session.selectedProductsJson,
      ticketNumber: session.ticketNumber,
      selectedEanIssue: session.selectedEanIssue,
    }),
    "utf8",
  );
}

/** Drop bulky fields before sealing the portal cookie (browser 4KB limit). */
export async function savePortalSession(
  session: IronSession<PortalSessionData>,
) {
  if (session.orderData) {
    session.orderData = compactPortalOrderData(session.orderData);
  }
  session.selectedProductsJson = slimSelectedProductsJson(
    session.selectedProductsJson,
  );
  if (session.selectedEanIssue) {
    session.selectedEanIssue = {
      issue: clip(session.selectedEanIssue.issue, 120),
      category_name: session.selectedEanIssue.category_name
        ? clip(session.selectedEanIssue.category_name, 80)
        : undefined,
      sku: session.selectedEanIssue.sku
        ? clip(session.selectedEanIssue.sku, 80)
        : undefined,
      issue_index: session.selectedEanIssue.issue_index,
      troubleshoot_steps: "",
    };
  }
  if (session.orderData && session.selectedProductsJson) {
    try {
      const selected = JSON.parse(session.selectedProductsJson) as Array<{
        sku?: string;
        product_id?: string | number;
      }>;
      if (Array.isArray(selected) && selected.length > 0) {
        const keys = new Set(
          selected.flatMap((row) =>
            [String(row.sku ?? "").trim(), String(row.product_id ?? "").trim()].filter(
              Boolean,
            ),
          ),
        );
        const filtered = session.orderData.products.filter(
          (p) =>
            keys.has(String(p.sku ?? "").trim()) ||
            keys.has(String(p.product_id).trim()),
        );
        if (filtered.length > 0) {
          session.orderData.products = filtered;
        }
      }
    } catch {
      /* keep full product list */
    }
  }

  // Sealed cookie must stay under 4096 bytes; leave room for iron-session overhead.
  if (session.orderData && sessionPayloadBytes(session) > 2200) {
    session.orderData = {
      ...session.orderData,
      products: session.orderData.products.map((p) => ({
        ...p,
        name: clip(p.name, 40),
      })),
      customer: {
        ...session.orderData.customer,
        shipping_address: {
          ...session.orderData.customer.shipping_address,
          address: clip(session.orderData.customer.shipping_address.address, 80),
        },
      },
    };
  }
  await session.save();
}
