/**
 * Port of public/shipway_tracker.php + ShipwayService::fetchFromGetOrdersEndpoint.
 * Always calls app.shipway.com (DB may still store dead shipway.in host).
 */

import { prisma } from "@/lib/db";

type ShipwayConfig = {
  api_key: string;
  api_url: string;
  email: string;
  timeout_seconds: number;
};

export type ShipwayTrackResult = {
  number: string;
  type: "awb" | "rma" | "invalid";
  timestamp: string;
  found: boolean;
  status: string;
  order_id?: string | null;
  courier?: string | null;
  error?: string;
  validation_error?: boolean;
  source?: string;
  endpoints_tested: Array<{
    endpoint: string;
    params: Record<string, string>;
    url: string;
    http_code: number;
    success: boolean;
    error?: string;
    found_exact_match?: boolean;
    extracted_status?: string;
  }>;
  errors: Array<{ endpoint: string; error: string }>;
};

const APP_SHIPWAY_API = "https://app.shipway.com/api";

async function getShipwayConfig(): Promise<ShipwayConfig> {
  try {
    const rows = await prisma.$queryRaw<
      Array<{
        api_key: string | null;
        api_url: string | null;
        email: string | null;
        timeout_seconds: number | null;
      }>
    >`
      SELECT api_key, api_url, email, timeout_seconds
      FROM shipway_config
      WHERE is_active = 1
      LIMIT 1
    `;
    const row = rows[0];
    if (row?.api_key && row?.email) {
      return {
        api_key: row.api_key,
        // shipway.in/api returns 404 for getorders — force working host
        api_url: APP_SHIPWAY_API,
        email: row.email,
        timeout_seconds: Number(row.timeout_seconds ?? 30),
      };
    }
  } catch (error) {
    console.error("[shipway-tracker] config load failed:", error);
  }

  return {
    api_key: process.env.SHIPWAY_API_KEY ?? "",
    api_url: APP_SHIPWAY_API,
    email: process.env.SHIPWAY_EMAIL ?? "",
    timeout_seconds: Number(process.env.SHIPWAY_TIMEOUT ?? "30"),
  };
}

function validateInput(number: string): {
  valid: boolean;
  type: "awb" | "rma" | "invalid";
  number: string;
} {
  const trimmed = number.trim();
  if (!trimmed) {
    return { valid: false, type: "invalid", number: trimmed };
  }
  if (/^\d{11,13}$/.test(trimmed)) {
    return { valid: true, type: "awb", number: trimmed };
  }
  // also allow slightly wider numeric AWBs used in our tickets
  if (/^\d{6,25}$/.test(trimmed)) {
    return { valid: true, type: "awb", number: trimmed };
  }
  if (/^\d+\.[A-Z0-9]+-[A-Z]$/i.test(trimmed)) {
    return { valid: true, type: "rma", number: trimmed };
  }
  return { valid: false, type: "invalid", number: trimmed };
}

function normalizeStatus(status: string) {
  const key = status.toLowerCase().trim();
  const map: Record<string, string> = {
    delivered: "Delivered",
    "out for delivery": "Out for Delivery",
    "in transit": "In Transit",
    shipped: "Shipped",
    "picked up": "Picked Up",
    pickup: "Picked Up",
    pending: "Pending",
    processing: "Processing",
    cancelled: "Cancelled",
    returned: "Returned",
    rto: "Return to Origin",
    exception: "Exception",
  };
  return map[key] ?? status.charAt(0).toUpperCase() + status.slice(1);
}

function getStatusFromOrder(order: Record<string, unknown>) {
  const statusFields = [
    "current_shipment_status",
    "shipment_status",
    "status",
    "order_status",
    "tracking_status",
  ];
  for (const field of statusFields) {
    const value = order[field];
    if (typeof value === "string" && value.trim()) {
      return normalizeStatus(value);
    }
  }
  return "Unknown";
}

function extractOrders(data: Record<string, unknown>): Record<string, unknown>[] {
  for (const key of ["message", "payload", "orders", "data"] as const) {
    const list = data[key];
    if (Array.isArray(list)) {
      return list.filter(
        (item): item is Record<string, unknown> =>
          Boolean(item) && typeof item === "object",
      );
    }
  }
  return [];
}

function valuesMatch(value: unknown, search: string): boolean {
  if (value == null) return false;
  const s = String(value).trim();
  if (!s) return false;
  if (s === search) return true;
  // RMA / order ids often appear inside larger strings
  if (s.toLowerCase().includes(search.toLowerCase())) return true;
  return false;
}

function orderMatches(order: Record<string, unknown>, search: string): boolean {
  const fields = [
    "order_id",
    "awb_number",
    "tracking_number",
    "reference_number",
    "order_number",
    "rma_number",
    "ticket_number",
    "shipment_id",
    "order_reference",
    "external_order_id",
    "merchant_order_id",
    "ima_no",
    "awb",
  ];
  for (const field of fields) {
    if (valuesMatch(order[field], search)) return true;
  }

  // nested rma / label tracking
  const rma = order.rma;
  if (Array.isArray(rma)) {
    for (const item of rma) {
      if (!item || typeof item !== "object") continue;
      const row = item as Record<string, unknown>;
      if (valuesMatch(row.tracking_number, search) || valuesMatch(row.awb, search)) {
        return true;
      }
      const label = row.label;
      if (label && typeof label === "object") {
        const tracking = (label as Record<string, unknown>).tracking;
        if (valuesMatch(tracking, search)) return true;
      }
    }
  }

  return false;
}

function getCourier(order: Record<string, unknown>) {
  for (const field of ["courier", "courier_name", "carrier_name", "shipping_method"]) {
    const v = order[field];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

async function makeApiCall(
  config: ShipwayConfig,
  endpoint: string,
  params: Record<string, string> = {},
) {
  const base = config.api_url.replace(/\/$/, "");
  const qs = new URLSearchParams(params).toString();
  const path = endpoint.replace(/^\//, "");
  const url = `${base}/${path}${qs ? `?${qs}` : ""}`;
  const auth = Buffer.from(`${config.email}:${config.api_key}`).toString(
    "base64",
  );

  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    Math.max(5, config.timeout_seconds) * 1000,
  );

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      signal: controller.signal,
    });
    const raw = await response.text();
    let parsed: Record<string, unknown> | null = null;
    try {
      parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
    } catch {
      parsed = null;
    }
    return {
      url,
      http_code: response.status,
      error: "",
      response: raw,
      parsed_response: parsed,
    };
  } catch (error) {
    return {
      url,
      http_code: 0,
      error: error instanceof Error ? error.message : "Request failed",
      response: "",
      parsed_response: null as Record<string, unknown> | null,
    };
  } finally {
    clearTimeout(timer);
  }
}

function ymdDaysAgo(days: number) {
  const d = new Date(Date.now() - days * 86400000);
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

export async function trackShipwayNumber(
  number: string,
): Promise<ShipwayTrackResult> {
  const validation = validateInput(number);
  const timestamp = new Date().toLocaleString("sv-SE", {
    timeZone: "Asia/Kolkata",
    hour12: false,
  });

  if (!validation.valid) {
    return {
      number: validation.number,
      type: "invalid",
      timestamp,
      found: false,
      status: "Invalid Format",
      error:
        "Invalid format. AWB: 6–25 digits. RMA: number.CODE-LETTER (e.g. 628408.CK143057-E)",
      validation_error: true,
      endpoints_tested: [],
      errors: [],
    };
  }

  const config = await getShipwayConfig();
  if (!config.api_key || !config.email) {
    return {
      number: validation.number,
      type: validation.type,
      timestamp,
      found: false,
      status: "Not Found",
      error: "Shipway API credentials are not configured.",
      endpoints_tested: [],
      errors: [],
    };
  }

  const results: ShipwayTrackResult = {
    number: validation.number,
    type: validation.type,
    timestamp,
    found: false,
    status: "Not Found",
    endpoints_tested: [],
    errors: [],
  };

  const queries: Array<{ endpoint: string; params: Record<string, string>; label: string }> =
    validation.type === "awb"
      ? [
          {
            endpoint: "orders",
            params: { awb: validation.number },
            label: "orders?awb",
          },
          {
            endpoint: "orders",
            params: { tracking_number: validation.number },
            label: "orders?tracking_number",
          },
          { endpoint: "getorders", params: {}, label: "getorders (forward)" },
          {
            endpoint: "getorders",
            params: { order_type: "R" },
            label: "getorders (reverse)",
          },
          {
            endpoint: "getorders",
            params: {
              from_date: ymdDaysAgo(14),
              to_date: ymdDaysAgo(0),
              limit: "1000",
            },
            label: "getorders (14d)",
          },
          {
            endpoint: "getorders",
            params: {
              order_type: "R",
              from_date: ymdDaysAgo(14),
              to_date: ymdDaysAgo(0),
              limit: "1000",
            },
            label: "getorders reverse (14d)",
          },
        ]
      : [
          {
            endpoint: "getorders",
            params: { order_type: "R" },
            label: "getorders (reverse)",
          },
          { endpoint: "getorders", params: {}, label: "getorders (forward)" },
          {
            endpoint: "orders",
            params: { search: validation.number },
            label: "orders?search",
          },
          {
            endpoint: "getorders",
            params: {
              order_type: "R",
              from_date: ymdDaysAgo(30),
              to_date: ymdDaysAgo(0),
              limit: "1000",
            },
            label: "getorders reverse (30d)",
          },
        ];

  for (const q of queries) {
    const result = await makeApiCall(config, q.endpoint, q.params);
    const endpointResult: ShipwayTrackResult["endpoints_tested"][number] = {
      endpoint: q.label,
      params: q.params,
      url: result.url,
      http_code: result.http_code,
      success: result.http_code === 200,
      error: result.error || undefined,
    };

    if (result.http_code === 200 && result.parsed_response) {
      const orders = extractOrders(result.parsed_response);
      const match = orders.find((o) => orderMatches(o, validation.number));
      if (match) {
        results.found = true;
        results.status = getStatusFromOrder(match);
        results.order_id =
          match.order_id != null ? String(match.order_id) : null;
        results.courier = getCourier(match);
        results.source = q.label;
        endpointResult.found_exact_match = true;
        endpointResult.extracted_status = results.status;
        results.endpoints_tested.push(endpointResult);
        return results;
      }
      endpointResult.found_exact_match = false;
    } else {
      results.errors.push({
        endpoint: q.label,
        error: result.error || result.response || `HTTP ${result.http_code}`,
      });
    }

    results.endpoints_tested.push(endpointResult);
  }

  // Local fallback: tickets / shipments may still know this AWB
  try {
    const local = await prisma.$queryRaw<
      Array<{
        ticket_number: string | null;
        awb_number: string | null;
        reverse_awb_number: string | null;
        shipment_status: string | null;
      }>
    >`
      SELECT wt.ticket_number, wt.awb_number, wt.reverse_awb_number, s.shipment_status
      FROM warranty_tickets wt
      LEFT JOIN shipments s
        ON s.awb_number = wt.awb_number
        OR s.awb_number = wt.reverse_awb_number
      WHERE wt.awb_number = ${validation.number}
         OR wt.reverse_awb_number = ${validation.number}
      LIMIT 1
    `;
    if (local[0]) {
      results.found = true;
      results.status = local[0].shipment_status
        ? normalizeStatus(local[0].shipment_status)
        : "Found locally (no live Shipway match)";
      results.order_id = local[0].ticket_number;
      results.source = "local_db";
      results.error =
        "Live Shipway list did not contain this number; showing local DB match.";
    }
  } catch {
    /* ignore local fallback errors */
  }

  return results;
}
