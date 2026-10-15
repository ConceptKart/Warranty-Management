/**
 * Shopify Admin REST helper for the ops import tool
 * (port of the live correct_shopify_import_order.php Shopify block).
 */

export type ShopifyAdminOrder = {
  id?: number | string;
  name?: string;
  order_number?: number | string;
  created_at?: string;
  email?: string;
  contact_email?: string;
  phone?: string;
  fulfillments?: Array<{
    tracking_number?: string;
    tracking_numbers?: string[];
  }>;
  shipping_address?: ShopifyAddress;
  billing_address?: ShopifyAddress;
  customer?: {
    first_name?: string;
    last_name?: string;
    phone?: string;
    email?: string;
  };
  line_items?: Array<{
    sku?: string;
    quantity?: number;
    barcode?: string | null;
  }>;
};

type ShopifyAddress = {
  first_name?: string;
  last_name?: string;
  name?: string;
  phone?: string;
  address1?: string;
  address2?: string;
  city?: string;
  province?: string;
  province_code?: string;
  zip?: string;
};

function getShopifyConfig() {
  const store = (
    process.env.SHOPIFY_STORE?.trim() || "concept-kart.myshopify.com"
  ).replace(/^https?:\/\//, "");
  const token = process.env.SHOPIFY_ACCESS_TOKEN?.trim();
  const version = process.env.SHOPIFY_API_VERSION?.trim() || "2025-10";
  if (!token) {
    throw new Error("SHOPIFY_ACCESS_TOKEN is not configured");
  }
  return { store, token, version };
}

async function shopifyGet(pathAndQuery: string): Promise<{
  httpCode: number;
  body: Record<string, unknown> | null;
}> {
  const { store, token, version } = getShopifyConfig();
  const url = `https://${store}/admin/api/${version}/${pathAndQuery}`;
  const res = await fetch(url, {
    method: "GET",
    headers: {
      "X-Shopify-Access-Token": token,
      "Content-Type": "application/json",
    },
  });
  const text = await res.text();
  let body: Record<string, unknown> | null = null;
  try {
    body = text ? (JSON.parse(text) as Record<string, unknown>) : null;
  } catch {
    body = null;
  }
  return { httpCode: res.status, body };
}

/**
 * PHP search: numeric id >= 10 digits via /orders/{id}.json,
 * then name queries #CK… / #… / digits / raw input with status=any.
 */
export async function fetchShopifyAdminOrder(
  rawInput: string,
): Promise<ShopifyAdminOrder | null> {
  const input = rawInput.trim();
  if (!input) return null;

  const cleanSearch = input.replace(/#?CK|#/gi, "");

  if (/^\d+$/.test(input) && input.length >= 10) {
    const byId = await shopifyGet(`orders/${input}.json`);
    if (byId.httpCode === 200) {
      const order = byId.body?.order as ShopifyAdminOrder | undefined;
      if (order) return order;
    }
  }

  const searchQueries = Array.from(
    new Set([`#CK${cleanSearch}`, `#${cleanSearch}`, cleanSearch, input]),
  );

  for (const query of searchQueries) {
    const found = await shopifyGet(
      `orders.json?name=${encodeURIComponent(query)}&status=any`,
    );
    if (found.httpCode === 200) {
      const orders = found.body?.orders as ShopifyAdminOrder[] | undefined;
      if (orders?.[0]) return orders[0];
    }
  }

  return null;
}
