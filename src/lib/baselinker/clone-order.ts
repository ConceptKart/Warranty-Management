/**
 * PHP BaseLinkerService::cloneOrderWithSelectedProducts + updateAllWarrantyFields.
 * Website claims only. Ticket is created first; clone failure does not drop the claim.
 */

import { prisma } from "@/lib/db";
import { baselinkerCall } from "@/lib/cron/baselinker-client";
import { shopifyOrderIdVariants } from "@/lib/portal/verify-order";

export const CLONE_WAREHOUSE_ID = 9001702;
export const CLONE_STATUS_ID = 8111;

export type CloneSelectedProduct = {
  product_id?: string | number;
  variant_id?: string | number;
  sku?: string;
  name?: string;
  quantity?: number;
};

type BlProduct = {
  product_id?: number | string;
  variant_id?: number | string | null;
  name?: string;
  sku?: string;
  ean?: string | number;
  location?: string;
  attributes?: string;
  price_brutto?: number | string;
  tax_rate?: number | string;
  quantity?: number | string;
  weight?: number | string;
};

type BlOrder = {
  order_id?: number | string;
  shop_order_id?: number | string;
  external_order_id?: string;
  order_status_id?: number | string;
  custom_source_id?: number | string | null;
  currency?: string;
  payment_method_cod?: boolean | number;
  user_login?: string;
  phone?: string;
  email?: string;
  delivery_method?: string;
  delivery_price?: number | string;
  delivery_fullname?: string;
  delivery_company?: string;
  delivery_address?: string;
  delivery_postcode?: string;
  delivery_city?: string;
  delivery_state?: string;
  delivery_country_code?: string;
  invoice_fullname?: string;
  invoice_company?: string;
  invoice_address?: string;
  invoice_postcode?: string;
  invoice_city?: string;
  invoice_state?: string;
  invoice_country_code?: string;
  want_invoice?: boolean | number;
  products?: BlProduct[];
  custom_extra_fields?: Record<string, string>;
};

export type CloneResult =
  | {
      success: true;
      cloned_order_id: number;
      original_order_id: string;
    }
  | { success: false; error: string };

function hasToken() {
  return Boolean(process.env.BASELINKER_TOKEN?.trim());
}

function asRecord(value: unknown) {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

export async function getBaselinkerOrderById(
  orderId: string | number,
): Promise<BlOrder | null> {
  const numeric = Number(orderId);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  const data = await baselinkerCall("getOrders", {
    get_unconfirmed_orders: true,
    id_from: numeric,
    id_to: numeric,
  });
  const orders = (data.orders as BlOrder[] | undefined) ?? [];
  return (
    orders.find((order) => String(order.order_id) === String(orderId)) ??
    orders[0] ??
    null
  );
}

export async function findBaselinkerOrderIdForShopify(
  shopifyOrderId: string,
): Promise<string | null> {
  const variants = shopifyOrderIdVariants(shopifyOrderId);
  const [a, b, c, d, e] = [
    variants[0] ?? shopifyOrderId,
    variants[1] ?? variants[0] ?? shopifyOrderId,
    variants[2] ?? variants[0] ?? shopifyOrderId,
    variants[3] ?? variants[0] ?? shopifyOrderId,
    variants[4] ?? variants[0] ?? shopifyOrderId,
  ];
  try {
    const rows = await prisma.$queryRaw<Array<{ base_order_id: string | null }>>`
      SELECT base_order_id
      FROM shopify_orders
      WHERE shopify_order_id IN (${a}, ${b}, ${c}, ${d}, ${e})
        AND base_order_id IS NOT NULL
        AND base_order_id != ''
        AND base_order_id != '0'
      LIMIT 1
    `;
    const local = String(rows[0]?.base_order_id ?? "").trim();
    if (/^\d+$/.test(local)) return local;
  } catch (error) {
    console.error("[findBaselinkerOrderIdForShopify] local:", error);
  }

  const shopOrderId = variants.find((id) => /^\d+$/.test(id));
  if (!shopOrderId) return null;
  try {
    const data = await baselinkerCall("getOrders", {
      get_unconfirmed_orders: true,
      filter_shop_order_id: shopOrderId,
    });
    const orders = (data.orders as BlOrder[] | undefined) ?? [];
    const id = String(orders[0]?.order_id ?? "").trim();
    return /^\d+$/.test(id) ? id : null;
  } catch (error) {
    console.error("[findBaselinkerOrderIdForShopify] live:", error);
    return null;
  }
}

export function matchSelectedCloneProducts(
  originalProducts: BlProduct[],
  selected: CloneSelectedProduct[],
) {
  const used = new Set<number>();
  const matched: Array<{ original: BlProduct; quantity: number }> = [];

  for (const sel of selected) {
    const sku = String(sel.sku ?? "").trim().toLowerCase();
    const requested = Math.max(1, Number(sel.quantity ?? 1) || 1);
    let index = -1;
    if (sku) {
      index = originalProducts.findIndex(
        (product, i) =>
          !used.has(i) &&
          String(product.sku ?? "").trim().toLowerCase() === sku,
      );
    }
    if (index < 0 && /^\d+$/.test(String(sel.product_id ?? ""))) {
      index = originalProducts.findIndex(
        (product, i) =>
          !used.has(i) && String(product.product_id) === String(sel.product_id),
      );
    }
    if (index < 0) continue;
    used.add(index);
    const original = originalProducts[index]!;
    const originalQty = Math.max(1, Number(original.quantity ?? 1) || 1);
    matched.push({
      original,
      quantity: Math.min(requested, originalQty),
    });
  }

  return matched;
}

function cloneComments(originalOrderId: string, original: BlOrder) {
  const external =
    String(original.external_order_id ?? "").trim() || originalOrderId;
  return `original order was: '${external}-01' of the order, platform-'website'`;
}

export async function setWarrantyCloneFields(input: {
  clonedOrderId: number;
  ticketNumber: string;
  issueDescription: string;
  claimType: "warranty" | "replacement";
  uploadedUrls?: string[];
}): Promise<{ success: boolean; error?: string }> {
  const fields: Record<string, string> = {
    "5344":
      input.claimType === "replacement" ? "10-Day Replacement" : "warranty",
    "5345": input.ticketNumber,
    "5356": input.issueDescription.trim() || "AWAITING_CUSTOMER_DESCRIPTION",
  };
  const urls = (input.uploadedUrls ?? []).filter(Boolean);
  if (urls[0]) fields["6397"] = urls[0]!;
  if (urls[1]) fields["6398"] = urls[1]!;

  try {
    await baselinkerCall("setOrderFields", {
      order_id: input.clonedOrderId,
      custom_extra_fields: fields,
    });
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "setOrderFields failed",
    };
  }
}

export async function cloneOrderWithSelectedProducts(input: {
  originalOrderId: string;
  selectedProducts: CloneSelectedProduct[];
  ticketNumber: string;
  issueDescription: string;
  claimType: "warranty" | "replacement";
  uploadedUrls?: string[];
}): Promise<CloneResult> {
  if (!hasToken()) {
    return { success: false, error: "BASELINKER_TOKEN is not configured" };
  }
  if (input.selectedProducts.length === 0) {
    return { success: false, error: "No products selected for cloning" };
  }

  const original = await getBaselinkerOrderById(input.originalOrderId);
  if (!original?.products?.length) {
    return { success: false, error: "Original order not found" };
  }

  const matched = matchSelectedCloneProducts(
    original.products,
    input.selectedProducts,
  );
  if (matched.length === 0) {
    return {
      success: false,
      error: "Selected products were not found on the original BaseLinker order",
    };
  }

  const products = matched.map(({ original: product, quantity }) => ({
    storage: CLONE_WAREHOUSE_ID,
    storage_id: CLONE_WAREHOUSE_ID,
    warehouse_id: CLONE_WAREHOUSE_ID,
    product_id: product.product_id,
    variant_id: product.variant_id ?? null,
    name: product.name ?? "",
    sku: product.sku ?? "",
    ean: product.ean ?? "",
    location: product.location ?? "",
    attributes: product.attributes ?? "",
    price_brutto: product.price_brutto ?? 0,
    tax_rate: product.tax_rate ?? 0,
    quantity,
    weight: product.weight ?? 0,
  }));

  const orderData = {
    order_status_id: CLONE_STATUS_ID,
    custom_source_id: original.custom_source_id ?? null,
    date_add: Math.floor(Date.now() / 1000),
    currency: original.currency ?? "INR",
    payment_method: "Prepaid",
    payment_method_cod: original.payment_method_cod ?? false,
    paid: 1,
    user_comments: cloneComments(input.originalOrderId, original),
    admin_comments: `Auto-cloned for warranty processing with selective products - Original Order ID: ${input.originalOrderId}`,
    phone: original.phone ?? "",
    email: original.email ?? "",
    user_login: original.user_login ?? "",
    delivery_method: "Prepaid Order",
    delivery_price: original.delivery_price ?? 0,
    delivery_fullname: original.delivery_fullname ?? "",
    delivery_company: original.delivery_company ?? "",
    delivery_address: original.delivery_address ?? "",
    delivery_postcode: original.delivery_postcode ?? "",
    delivery_city: original.delivery_city ?? "",
    delivery_state: original.delivery_state ?? "",
    delivery_country_code: original.delivery_country_code ?? "IN",
    invoice_fullname: original.invoice_fullname ?? "",
    invoice_company: original.invoice_company ?? "",
    invoice_address: original.invoice_address ?? "",
    invoice_postcode: original.invoice_postcode ?? "",
    invoice_city: original.invoice_city ?? "",
    invoice_state: original.invoice_state ?? "",
    invoice_country_code: original.invoice_country_code ?? "IN",
    want_invoice: original.want_invoice ?? false,
    products,
  };

  const created = await baselinkerCall("addOrder", orderData);
  const clonedId = Number(asRecord(created).order_id);
  if (!clonedId) {
    return { success: false, error: "addOrder did not return order_id" };
  }

  const fields = await setWarrantyCloneFields({
    clonedOrderId: clonedId,
    ticketNumber: input.ticketNumber,
    issueDescription: input.issueDescription,
    claimType: input.claimType,
    uploadedUrls: input.uploadedUrls,
  });
  if (!fields.success) {
    console.error("[cloneOrderWithSelectedProducts] fields:", fields.error);
  }

  return {
    success: true,
    cloned_order_id: clonedId,
    original_order_id: input.originalOrderId,
  };
}

export async function integrateShopifyClaimClone(input: {
  shopifyOrderId: string;
  selectedProducts: CloneSelectedProduct[];
  ticketNumber: string;
  issueDescription: string;
  claimType: "warranty" | "replacement";
  uploadedUrls?: string[];
}): Promise<CloneResult> {
  if (!hasToken()) {
    return { success: false, error: "BASELINKER_TOKEN is not configured" };
  }
  const originalOrderId = await findBaselinkerOrderIdForShopify(
    input.shopifyOrderId,
  );
  if (!originalOrderId) {
    return {
      success: false,
      error: "Original BaseLinker order not found for this Shopify order",
    };
  }
  return cloneOrderWithSelectedProducts({
    originalOrderId,
    selectedProducts: input.selectedProducts,
    ticketNumber: input.ticketNumber,
    issueDescription: input.issueDescription,
    claimType: input.claimType,
    uploadedUrls: input.uploadedUrls,
  });
}
