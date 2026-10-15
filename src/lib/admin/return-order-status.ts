/**
 * Port of the "Update Shipment Status" card on the live
 * correct_shopify_import_order.php page:
 * returnorders.orders by CK order id → Shipway tracking → write shipment_status.
 */

import { queryExternalShipway } from "@/lib/db-external-shipway";

export function normalizeCkOrderId(raw: string): string | null {
  let orderId = raw.trim().toUpperCase().replace(/#/g, "");
  if (!orderId) return null;
  if (!orderId.startsWith("CK")) {
    orderId = `CK${orderId}`;
  }
  return orderId;
}

function extractShipmentStatus(payload: unknown): string {
  if (Array.isArray(payload)) {
    const details = (payload[0] as { tracking_details?: { shipment_status?: string } } | undefined)
      ?.tracking_details;
    return String(details?.shipment_status ?? "").trim();
  }
  if (payload && typeof payload === "object") {
    const obj = payload as Record<string, unknown>;
    const nested = obj[0] ?? obj.message ?? obj.data;
    if (nested) return extractShipmentStatus(nested);
  }
  return "";
}

export async function updateCkOrderShipmentStatus(rawOrderId: string): Promise<{
  success: boolean;
  message: string;
  order_id: string | null;
  awb: string | null;
  status: string | null;
}> {
  const orderId = normalizeCkOrderId(rawOrderId);
  if (!orderId) {
    return {
      success: false,
      message: "Please enter CK Order ID.",
      order_id: null,
      awb: null,
      status: null,
    };
  }

  const rows = await queryExternalShipway<Array<{ awb_number: string | null }>>(
    "SELECT awb_number FROM orders WHERE order_id = ? LIMIT 1",
    [orderId],
  );
  if (!rows[0]) {
    return {
      success: false,
      message: "Order not found.",
      order_id: orderId,
      awb: null,
      status: null,
    };
  }

  const awb = String(rows[0].awb_number ?? "").trim();
  if (!awb) {
    return {
      success: false,
      message: "Status not found.",
      order_id: orderId,
      awb: null,
      status: null,
    };
  }

  const email = process.env.SHIPWAY_EMAIL?.trim() ?? "";
  const apiKey = process.env.SHIPWAY_API_KEY?.trim() ?? "";
  const apiUrl = (
    process.env.SHIPWAY_API_URL?.trim() || "https://app.shipway.com/api"
  ).replace(/\/$/, "");
  if (!email || !apiKey) {
    throw new Error("SHIPWAY_EMAIL / SHIPWAY_API_KEY are not configured");
  }

  const auth = Buffer.from(`${email}:${apiKey}`).toString("base64");
  const url = `${apiUrl}/tracking?awb_numbers=${encodeURIComponent(awb)}`;
  const res = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: "application/json",
    },
  });
  const raw = await res.text();
  let payload: unknown = null;
  try {
    payload = raw ? JSON.parse(raw) : null;
  } catch {
    payload = null;
  }

  const shipmentStatus = extractShipmentStatus(payload);
  if (!shipmentStatus) {
    return {
      success: false,
      message: "Status not found.",
      order_id: orderId,
      awb,
      status: null,
    };
  }

  await queryExternalShipway(
    "UPDATE orders SET shipment_status = ?, last_checked_at = NOW() WHERE order_id = ?",
    [shipmentStatus, orderId],
  );

  return {
    success: true,
    message: "Status Updated Successfully",
    order_id: orderId,
    awb,
    status: shipmentStatus,
  };
}
