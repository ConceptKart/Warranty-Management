import { prisma } from "@/lib/db";

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
    api_key:
      process.env.SHIPWAY_API_KEY ?? "78Kf87Vc35Y9P1DNK9M7kxv8w5ktQ965",
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

function isShipwaySuccess(decoded: Record<string, unknown> | null) {
  if (!decoded) return false;
  const success = decoded.success;
  return success === 1 || success === true || success === "1";
}

/**
 * Port of ShipwayService::createReturnShipment (Createreturns API).
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
      product_quantity: input.quantity ?? 1,
      price: input.product_price ?? 0,
      variants: "",
    },
  };

  const payload = {
    order_id: input.order_id || input.ticket_number || "",
    return_warehouse_id: "56024",
    products,
    shipping: 0,
    order_total: input.order_total ?? input.product_price ?? 0,
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
    carrier_id: "",
    order_weight: input.weight ?? 100,
    box_length: input.box_length ?? 10,
    box_breadth: input.box_breadth ?? 5,
    box_height: input.box_height ?? 4,
    return_order_status: "E",
    return_reason_id: 76487,
    refund_payment_id: 1,
    transfer_details: [],
  };

  const result = await postShipway(
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
    const awbResp = (decoded?.awb_response ?? {}) as Record<string, unknown>;
    const createResp = (decoded?.create_return_response ?? {}) as Record<
      string,
      unknown
    >;
    return {
      success: true,
      message: "Return shipment created on Shipway successfully",
      awb_number: String(awbResp.AWB ?? ""),
      courier_name: String(awbResp.courier_name ?? ""),
      carrier_id: String(awbResp.carrier_id ?? ""),
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

  const message =
    (decoded?.message as string) ||
    ((decoded?.create_return_response as Record<string, unknown>)?.message as string) ||
    ((decoded?.awb_response as Record<string, unknown>)?.message as string) ||
    result.raw ||
    "Failed to create return shipment on Shipway";

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
    carrier_id: "",
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
    billing_phone: input.customer_phone,
    billing_zipcode: input.customer_zipcode,
    shipping_address: input.customer_address,
    shipping_city: input.customer_city,
    shipping_state: input.customer_state,
    shipping_country: "India",
    shipping_firstname: firstName,
    shipping_lastname: lastName,
    shipping_phone: input.customer_phone,
    shipping_zipcode: input.customer_zipcode,
    order_weight: String(input.weight ?? 100),
    box_length: String(input.box_length ?? 10),
    box_breadth: String(input.box_breadth ?? 5),
    box_height: String(input.box_height ?? 4),
    order_date: new Date().toISOString().slice(0, 19).replace("T", " "),
  };

  const result = await postShipway(
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
    const awbNumber = String(
      awbResp.AWB ??
        awbResp.awb ??
        decoded?.AWB ??
        decoded?.awb ??
        orderResp.AWB ??
        orderResp.awb ??
        "",
    );
    const courierName = String(
      awbResp.courier_name ??
        decoded?.courier_name ??
        orderResp.courier_name ??
        "",
    );

    return {
      success: true,
      message: "Forward shipment created on Shipway successfully",
      awb_number: awbNumber,
      courier_name: courierName,
      carrier_id: String(awbResp.carrier_id ?? ""),
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

  const message =
    (decoded?.message as string) ||
    ((decoded?.order_response as Record<string, unknown>)?.message as string) ||
    ((decoded?.awb_response as Record<string, unknown>)?.message as string) ||
    result.raw ||
    "Failed to create forward shipment on Shipway";

  return {
    success: false,
    error: message,
    http_code: result.httpCode,
    data: decoded,
  };
}
