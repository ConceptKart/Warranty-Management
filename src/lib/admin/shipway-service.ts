import { prisma } from "@/lib/db";
import { indianMobileDigits } from "@/lib/tickets/ticket-number";

export type ShipwayCreateResult =
  | {
      success: true;
      awb_number: string;
      courier_name: string;
      carrier_id?: string;
      rma_no?: string;
      shipping_url?: string;
      message?: string;
      data?: unknown;
    }
  | {
      success: false;
      error: string;
      http_code?: number;
      data?: unknown;
    };

export type ShipwayShipmentInput = {
  order_id: string;
  ticket_number?: string;
  product_name: string;
  product_sku: string;
  product_price?: number;
  order_total?: number;
  quantity?: number;
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  customer_address: string;
  customer_city: string;
  customer_state: string;
  customer_zipcode: string;
  weight?: number;
  box_length?: number;
  box_breadth?: number;
  box_height?: number;
};

type ShipwayConfig = {
  api_key: string;
  api_url: string;
  email: string;
  timeout_seconds: number;
};

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
        api_url: row.api_url || "https://app.shipway.com/api",
        email: row.email,
        timeout_seconds: Number(row.timeout_seconds ?? 30),
      };
    }
  } catch (error) {
    console.error("[shipway] config load failed:", error);
  }

  return {
    api_key: process.env.SHIPWAY_API_KEY ?? "",
    api_url: process.env.SHIPWAY_API_URL ?? "https://app.shipway.com/api",
    email: process.env.SHIPWAY_EMAIL ?? "operations@conceptkart.com",
    timeout_seconds: Number(process.env.SHIPWAY_TIMEOUT ?? "30"),
  };
}

function splitName(fullName: string) {
  const parts = fullName.trim().split(/\s+/, 2);
  return {
    firstName: parts[0] ?? "",
    lastName: parts[1] ?? "",
  };
}

async function postShipway(
  url: string,
  payload: Record<string, unknown>,
): Promise<{ httpCode: number; body: unknown; raw: string; error?: string }> {
  const config = await getShipwayConfig();
  if (!config.api_key || !config.email) {
    return {
      httpCode: 0,
      body: null,
      raw: "",
      error: "Shipway API credentials are not configured.",
    };
  }
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
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const raw = await response.text();
    let body: unknown = null;
    try {
      body = JSON.parse(raw);
    } catch {
      body = raw;
    }
    return { httpCode: response.status, body, raw };
  } catch (error) {
    return {
      httpCode: 0,
      body: null,
      raw: "",
      error: error instanceof Error ? error.message : "Shipway request failed",
    };
  } finally {
    clearTimeout(timer);
  }
}

function isTruthySuccess(value: unknown) {
  return value === 1 || value === true || value === "1";
}

function isShipwaySuccess(decoded: Record<string, unknown> | null) {
  if (!decoded) return false;
  if (isTruthySuccess(decoded.success)) return true;
  const awbResp = decoded.awb_response;
  if (awbResp && typeof awbResp === "object" && isTruthySuccess((awbResp as Record<string, unknown>).success)) {
    return true;
  }
  const createResp = decoded.create_return_response;
  if (
    createResp &&
    typeof createResp === "object" &&
    isTruthySuccess((createResp as Record<string, unknown>).success)
  ) {
    return true;
  }
  return false;
}

function looksLikeAwb(value: unknown) {
  const text = String(value ?? "").trim();
  return Boolean(text) && /^[A-Za-z0-9-]{5,20}$/.test(text) && !/^\d{6}$/.test(text);
}

function firstAwb(...values: unknown[]) {
  for (const value of values) {
    if (looksLikeAwb(value)) return String(value).trim();
  }
  return "";
}

function extractReturnAwb(decoded: Record<string, unknown> | null) {
  if (!decoded) return "";
  const awbResp = (decoded.awb_response ?? {}) as Record<string, unknown>;
  const createResp = (decoded.create_return_response ?? {}) as Record<string, unknown>;
  return firstAwb(
    awbResp.AWB,
    awbResp.awb,
    awbResp.awb_number,
    awbResp.carrier_awb,
    awbResp.tracking_number,
    decoded.awb_number,
    decoded.AWB,
    decoded.awb,
    decoded.tracking_number,
    createResp.awb,
    createResp.AWB,
    createResp.awb_number,
    createResp.tracking_number,
  );
}

function extractForwardAwb(decoded: Record<string, unknown> | null) {
  if (!decoded) return "";
  const awbResp = (decoded.awb_response ?? {}) as Record<string, unknown>;
  const orderResp = (decoded.order_response ?? {}) as Record<string, unknown>;
  const dataResp = (decoded.data ?? {}) as Record<string, unknown>;
  return firstAwb(
    awbResp.AWB,
    awbResp.awb,
    awbResp.awb_number,
    awbResp.carrier_awb,
    awbResp.tracking_number,
    decoded.AWB,
    decoded.awb,
    decoded.awb_number,
    decoded.tracking_number,
    orderResp.AWB,
    orderResp.awb,
    orderResp.awb_number,
    orderResp.carrier_awb,
    orderResp.tracking_number,
    dataResp.AWB,
    dataResp.awb,
    dataResp.awb_number,
    dataResp.tracking_number,
  );
}

async function fetchForwardAwbByOrderId(orderId: string) {
  const trimmed = orderId.trim();
  if (!trimmed) return { awb: "", courier: "" };
  const config = await getShipwayConfig();
  if (!config.api_key || !config.email) return { awb: "", courier: "" };

  const auth = Buffer.from(`${config.email}:${config.api_key}`).toString("base64");
  const urls = [
    `https://app.shipway.com/api/orders?order_id=${encodeURIComponent(trimmed)}`,
    `https://app.shipway.com/api/getorders?order_id=${encodeURIComponent(trimmed)}`,
  ];

  for (const url of urls) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      const response = await fetch(url, {
        headers: {
          Authorization: `Basic ${auth}`,
          Accept: "application/json",
        },
        signal: controller.signal,
      });
      clearTimeout(timer);
      const raw = await response.text();
      let body: unknown = null;
      try {
        body = JSON.parse(raw);
      } catch {
        body = raw;
      }
      const decoded =
        body && typeof body === "object" ? (body as Record<string, unknown>) : null;
      const awb = extractForwardAwb(decoded);
      if (awb) {
        const orderResp = (decoded?.order_response ?? {}) as Record<string, unknown>;
        return {
          awb,
          courier: String(
            decoded?.courier_name ?? orderResp.courier_name ?? "",
          ),
        };
      }
    } catch {
      /* try the next Shipway lookup */
    }
  }

  return { awb: "", courier: "" };
}

/** Shipway carrier list: 1 = Blue Dart (same as ticket-details.php pickup path). */
function blueDartCarrierId() {
  return process.env.SHIPWAY_BLUE_DART_CARRIER_ID?.trim() || "1";
}

function isPincodeUnserviceable(message: string) {
  const text = message.toLowerCase();
  return (
    text.includes("unserviceable") ||
    text.includes("not serviceable") ||
    text.includes("non serviceable") ||
    text.includes("nonserviceable") ||
    text.includes("not serviceabl") ||
    text.includes("does not serve") ||
    text.includes("pickup not available") ||
    text.includes("pincode not serviceable") ||
    text.includes("pin code not serviceable") ||
    text.includes("not available for this pincode") ||
    text.includes("not available for this pin") ||
    /pin\s*code.+(not|cannot|can't|unable)/i.test(text) ||
    /(not|cannot|can't|unable).+(pin\s*code|pincode)/i.test(text)
  );
}

function shipwayErrorMessage(
  decoded: Record<string, unknown> | null,
  raw: string,
  fallback: string,
) {
  const nested = (key: string) => {
    const block = decoded?.[key];
    if (block && typeof block === "object") {
      return (block as Record<string, unknown>).message;
    }
    return undefined;
  };
  return (
    (decoded?.message as string) ||
    (nested("create_return_response") as string | undefined) ||
    (nested("order_response") as string | undefined) ||
    (nested("awb_response") as string | undefined) ||
    raw ||
    fallback
  );
}

function fallbackCarrierId() {
  return process.env.SHIPWAY_FALLBACK_CARRIER_ID?.trim() || "";
}

/**
 * Prefer Blue Dart. If Shipway says the pincode is unserviceable and a
 * fallback carrier_id is configured, retry that partner. Never send a blank
 * carrier_id — that creates a Requested return with no courier.
 */
async function postShipwayPreferringBlueDart(
  url: string,
  payload: Record<string, unknown>,
): Promise<{
  posted: Awaited<ReturnType<typeof postShipway>>;
  carrierIdUsed: string;
}> {
  const preferred = blueDartCarrierId();
  const first = await postShipway(url, { ...payload, carrier_id: preferred });
  const decoded =
    first.body && typeof first.body === "object"
      ? (first.body as Record<string, unknown>)
      : null;
  if (first.error) {
    return { posted: first, carrierIdUsed: preferred };
  }
  if (
    first.httpCode >= 200 &&
    first.httpCode < 300 &&
    isShipwaySuccess(decoded)
  ) {
    return { posted: first, carrierIdUsed: preferred };
  }

  const message = shipwayErrorMessage(decoded, first.raw, "");
  const fallbackId = fallbackCarrierId();
  if (!isPincodeUnserviceable(message) || !fallbackId || fallbackId === preferred) {
    return { posted: first, carrierIdUsed: preferred };
  }

  const fallback = await postShipway(url, { ...payload, carrier_id: fallbackId });
  return { posted: fallback, carrierIdUsed: fallbackId };
}

/**
 * Port of ticket-details.php tryShipwayReturnShipment (Createreturns API).
 * Blank carrier_id / missing product return_reason_id / zero price leave
 * Shipway in Requested with no courier.
 */
export async function createReturnShipment(
  input: ShipwayShipmentInput,
): Promise<ShipwayCreateResult> {
  const { firstName, lastName } = splitName(input.customer_name);
  const productKey = input.product_sku || "PRODUCT";
  const products: Record<string, unknown> = {
    [productKey]: {
      product: input.product_name || "Warranty Return Product",
      product_code: input.product_sku || "",
      product_quantity: String(input.quantity ?? 1),
      price: "1",
      variants: "",
      return_reason_id: 76487,
    },
  };

  const payload = {
    order_id: input.order_id || input.ticket_number || "",
    return_warehouse_id: "56024",
    products,
    shipping: 55,
    order_total: 1,
    payment_type: "P",
    email: input.customer_email,
    billing_address: input.customer_address,
    billing_city: input.customer_city,
    billing_state: input.customer_state,
    billing_country: "IN",
    billing_firstname: firstName,
    billing_lastname: lastName,
    billing_phone: input.customer_phone,
    billing_zipcode: input.customer_zipcode,
    shipping_address: input.customer_address,
    shipping_city: input.customer_city,
    shipping_state: input.customer_state,
    shipping_country: "IN",
    shipping_firstname: firstName,
    shipping_lastname: lastName,
    shipping_phone: input.customer_phone,
    shipping_zipcode: input.customer_zipcode,
    order_weight: input.weight ?? 480,
    box_length: input.box_length ?? 13,
    box_breadth: input.box_breadth ?? 12,
    box_height: input.box_height ?? 9,
    return_order_status: "E",
    refund_payment_id: 1,
    transfer_details: [],
  };

  const { posted: result, carrierIdUsed } = await postShipwayPreferringBlueDart(
    "https://app.shipway.com/api/Createreturns",
    payload,
  );

  if (result.error) {
    return { success: false, error: `Connection error: ${result.error}`, http_code: 0 };
  }

  const decoded =
    result.body && typeof result.body === "object"
      ? (result.body as Record<string, unknown>)
      : null;

  if (result.httpCode >= 200 && result.httpCode < 300 && isShipwaySuccess(decoded)) {
    const awbNumber = extractReturnAwb(decoded);
    if (!awbNumber) {
      return {
        success: false,
        error: "Shipway accepted the request but returned no AWB number",
        http_code: result.httpCode,
        data: decoded,
      };
    }
    const awbResp = (decoded?.awb_response ?? {}) as Record<string, unknown>;
    const createResp = (decoded?.create_return_response ?? {}) as Record<
      string,
      unknown
    >;
    return {
      success: true,
      message: "Return shipment created on Shipway successfully",
      awb_number: awbNumber,
      courier_name: String(awbResp.courier_name ?? "Blue Dart"),
      carrier_id: String(awbResp.carrier_id ?? carrierIdUsed),
      rma_no: String(createResp.rma_no ?? ""),
      shipping_url: String(
        decoded?.shipping_url ??
          awbResp.shipping_url ??
          createResp.shipping_url ??
          "",
      ),
      data: decoded,
    };
  }

  const message = shipwayErrorMessage(
    decoded,
    result.raw,
    "Failed to create return shipment on Shipway",
  );

  return {
    success: false,
    error: message,
    http_code: result.httpCode,
    data: decoded,
  };
}

/**
 * Port of ShipwayService::createForwardShipment (v2orders API).
 */
export async function createForwardShipment(
  input: ShipwayShipmentInput,
): Promise<ShipwayCreateResult> {
  const { firstName, lastName } = splitName(input.customer_name);
  const products = [
    {
      product: input.product_name || "Warranty Replacement Product",
      price: String(Math.max(1, Number(input.product_price ?? 0))),
      product_code: input.product_sku || "",
      product_quantity: String(input.quantity ?? 1),
      discount: "0",
      tax_rate: "0",
      tax_title: "",
    },
  ];

  const payload = {
    order_id: input.order_id || "",
    warehouse_id: "56024",
    return_warehouse_id: "56024",
    products,
    discount: "0",
    shipping: "0",
    order_total: String(
      Math.max(1, Number(input.order_total ?? input.product_price ?? 0)),
    ),
    payment_type: "P",
    email: input.customer_email,
    billing_address: input.customer_address,
    billing_city: input.customer_city,
    billing_state: input.customer_state,
    billing_country: "India",
    billing_firstname: firstName,
    billing_lastname: lastName,
    billing_phone: indianMobileDigits(input.customer_phone) || input.customer_phone,
    billing_zipcode: input.customer_zipcode,
    shipping_address: input.customer_address,
    shipping_city: input.customer_city,
    shipping_state: input.customer_state,
    shipping_country: "India",
    shipping_firstname: firstName,
    shipping_lastname: lastName,
    shipping_phone: indianMobileDigits(input.customer_phone) || input.customer_phone,
    shipping_zipcode: input.customer_zipcode,
    order_weight: String(input.weight ?? 100),
    box_length: String(input.box_length ?? 10),
    box_breadth: String(input.box_breadth ?? 5),
    box_height: String(input.box_height ?? 4),
    order_date: new Date().toISOString().slice(0, 19).replace("T", " "),
  };

  const { posted: result, carrierIdUsed } = await postShipwayPreferringBlueDart(
    "https://app.shipway.com/api/v2orders",
    payload,
  );

  if (result.error) {
    return { success: false, error: `Connection error: ${result.error}`, http_code: 0 };
  }

  const decoded =
    result.body && typeof result.body === "object"
      ? (result.body as Record<string, unknown>)
      : null;

  if (result.httpCode >= 200 && result.httpCode < 300 && isShipwaySuccess(decoded)) {
    const awbResp = (decoded?.awb_response ?? {}) as Record<string, unknown>;
    const orderResp = (decoded?.order_response ?? {}) as Record<string, unknown>;
    let awbNumber = extractForwardAwb(decoded);
    let courierName = String(
      awbResp.courier_name ??
        decoded?.courier_name ??
        orderResp.courier_name ??
        "",
    );

    if (!awbNumber) {
      const lookedUp = await fetchForwardAwbByOrderId(String(payload.order_id ?? ""));
      awbNumber = lookedUp.awb;
      courierName = courierName || lookedUp.courier;
    }

    if (!awbNumber) {
      return {
        success: false,
        error:
          "Shipway accepted the forward request but returned no AWB number",
        http_code: result.httpCode,
        data: decoded,
      };
    }

    return {
      success: true,
      message: "Forward shipment created on Shipway successfully",
      awb_number: awbNumber,
      courier_name: courierName,
      carrier_id: String(awbResp.carrier_id ?? carrierIdUsed),
      shipping_url: String(
        decoded?.shipping_url ??
          awbResp.shipping_url ??
          orderResp.shipping_url ??
          decoded?.label_url ??
          "",
      ),
      data: decoded,
    };
  }

  const message = shipwayErrorMessage(
    decoded,
    result.raw,
    "Failed to create forward shipment on Shipway",
  );

  return {
    success: false,
    error: message,
    http_code: result.httpCode,
    data: decoded,
  };
}
