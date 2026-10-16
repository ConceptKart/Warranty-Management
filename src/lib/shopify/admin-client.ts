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

async function shopifyGraphql(
  query: string,
  variables: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  const { store, token, version } = getShopifyConfig();
  const url = `https://${store}/admin/api/${version}/graphql.json`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "X-Shopify-Access-Token": token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });
  const text = await res.text();
  try {
    return text ? (JSON.parse(text) as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function mapGraphqlOrder(node: Record<string, unknown>): ShopifyAdminOrder {
  const shipping = (node.shippingAddress ?? null) as Record<string, unknown> | null;
  const billing = (node.billingAddress ?? null) as Record<string, unknown> | null;
  const customer = (node.customer ?? null) as Record<string, unknown> | null;
  const fulfillments = Array.isArray(node.fulfillments) ? node.fulfillments : [];
  const lineConn = node.lineItems as { nodes?: unknown[] } | undefined;
  const lineNodes = Array.isArray(lineConn?.nodes) ? lineConn.nodes : [];
  const gid = String(node.id ?? "");
  const numericId = gid.split("/").pop() ?? "";

  return {
    id: numericId || gid,
    name: String(node.name ?? ""),
    created_at: String(node.createdAt ?? ""),
    email: String(node.email ?? customer?.email ?? ""),
    phone: String(node.phone ?? customer?.phone ?? ""),
    fulfillments: fulfillments.map((f) => {
      const row = (f ?? {}) as { trackingInfo?: Array<{ number?: string }> };
      const numbers = (row.trackingInfo ?? [])
        .map((t) => t.number)
        .filter((n): n is string => Boolean(n));
      return {
        tracking_number: numbers[0],
        tracking_numbers: numbers,
      };
    }),
    shipping_address: shipping
      ? {
          first_name: String(shipping.firstName ?? ""),
          last_name: String(shipping.lastName ?? ""),
          phone: String(shipping.phone ?? ""),
          address1: String(shipping.address1 ?? ""),
          address2: String(shipping.address2 ?? ""),
          city: String(shipping.city ?? ""),
          province: String(shipping.province ?? ""),
          zip: String(shipping.zip ?? ""),
        }
      : undefined,
    billing_address: billing
      ? {
          first_name: String(billing.firstName ?? ""),
          last_name: String(billing.lastName ?? ""),
          phone: String(billing.phone ?? ""),
          address1: String(billing.address1 ?? ""),
          address2: String(billing.address2 ?? ""),
          city: String(billing.city ?? ""),
          province: String(billing.province ?? ""),
          zip: String(billing.zip ?? ""),
        }
      : undefined,
    customer: customer
      ? {
          first_name: String(customer.firstName ?? ""),
          last_name: String(customer.lastName ?? ""),
          phone: String(customer.phone ?? ""),
          email: String(customer.email ?? ""),
        }
      : undefined,
    line_items: lineNodes.map((item) => {
      const row = (item ?? {}) as {
        sku?: string;
        quantity?: number;
        variant?: { barcode?: string | null };
      };
      return {
        sku: row.sku,
        quantity: row.quantity,
        barcode: row.variant?.barcode ?? null,
      };
    }),
  };
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

  // REST name= only sees recent orders. GraphQL search covers older / archived.
  const gql = `query($q: String!) {
    orders(first: 5, query: $q) {
      nodes {
        id
        name
        createdAt
        email
        phone
        fulfillments(first: 10) { trackingInfo { number } }
        shippingAddress { firstName lastName address1 address2 city province zip phone }
        billingAddress { firstName lastName address1 address2 city province zip phone }
        customer { firstName lastName email phone }
        lineItems(first: 50) { nodes { sku quantity variant { barcode } } }
      }
    }
  }`;
  const gqlQueries = Array.from(
    new Set([
      `name:#CK${cleanSearch} status:any`,
      `name:#${cleanSearch} status:any`,
      `name:${cleanSearch} status:any`,
      `name:${input} status:any`,
    ]),
  );
  for (const q of gqlQueries) {
    try {
      const body = await shopifyGraphql(gql, { q });
      const data = body?.data as
        | { orders?: { nodes?: Record<string, unknown>[] } }
        | undefined;
      const node = data?.orders?.nodes?.[0];
      if (node) return mapGraphqlOrder(node);
    } catch (error) {
      console.error("[fetchShopifyAdminOrder] graphql:", error);
    }
  }

  return null;
}
