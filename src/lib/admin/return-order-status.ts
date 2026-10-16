/**
 * Port of the "Update Shipment Status" card on the live
 * correct_shopify_import_order.php page:
 * returnorders.orders by CK order id → Shipway tracking → write shipment_status.
 */

import { prisma } from "@/lib/db";
import { queryExternalShipway } from "@/lib/db-external-shipway";

export function normalizeCkOrderId(raw: string): string | null {
  let orderId = raw.trim().toUpperCase().replace(/#/g, "");
  if (!orderId) return null;
  if (!orderId.startsWith("CK")) {
    orderId = `CK${orderId}`;
  }
  return orderId;
}

function ckOrderIdVariants(orderId: string) {
  const digits = orderId.replace(/^CK/i, "");
  return [
    ...new Set(
      [orderId, `#${orderId}`, `CK${digits}`, `#CK${digits}`, digits].filter(
        Boolean,
      ),
    ),
  ];
}

async function lookupReplicaOrder(orderId: string) {
  const variants = ckOrderIdVariants(orderId);
  const placeholders = variants.map(() => "?").join(",");
  try {
    const exact = await queryExternalShipway<
      Array<{ order_id: string; awb_number: string | null }>
    >(
      `SELECT order_id, awb_number FROM orders WHERE order_id IN (${placeholders}) LIMIT 1`,
      variants,
    );
    if (exact[0]) return exact[0];

    const fuzzy = await queryExternalShipway<
      Array<{ order_id: string; awb_number: string | null }>
    >(
      "SELECT order_id, awb_number FROM orders WHERE order_id LIKE ? LIMIT 1",
      [`%${orderId.replace(/^CK/i, "")}%`],
    );
    if (fuzzy[0]) return fuzzy[0];
  } catch (error) {
    console.error("[updateCkOrderShipmentStatus] replica lookup:", error);
  }
  return null;
}

async function lookupLocalAwb(orderId: string) {
  const hashed = `#${orderId}`;
  const digits = orderId.replace(/^CK/i, "");
  try {
    const rows = await prisma.$queryRaw<Array<{ awb_number: string | null }>>`
      SELECT awb_number FROM shopify_orders
      WHERE shopify_order_id IN (${orderId}, ${hashed}, ${digits})
        AND awb_number IS NOT NULL AND awb_number != ''
      LIMIT 1
    `;
    return (rows[0]?.awb_number ?? "").trim() || null;
  } catch (error) {
    console.error("[updateCkOrderShipmentStatus] local AWB:", error);
    return null;
  }
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

  const replica = await lookupReplicaOrder(orderId);
  const replicaOrderId = replica?.order_id?.trim() || orderId;
  const awb =
    String(replica?.awb_number ?? "").trim() ||
    (await lookupLocalAwb(orderId)) ||
    "";
  if (!replica && !awb) {
    return {
      success: false,
      message: "Order not found.",
      order_id: orderId,
      awb: null,
      status: null,
    };
  }

  if (!awb) {
    return {
      success: false,
      message: "Status not found.",
      order_id: replicaOrderId,
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

  try {
    await queryExternalShipway(
      "UPDATE orders SET shipment_status = ?, last_checked_at = NOW() WHERE order_id = ?",
      [shipmentStatus, replicaOrderId],
    );
  } catch (error) {
    console.error("[updateCkOrderShipmentStatus] replica write:", error);
  }

  return {
    success: true,
    message: "Status Updated Successfully",
    order_id: replicaOrderId,
    awb,
    status: shipmentStatus,
  };
}
