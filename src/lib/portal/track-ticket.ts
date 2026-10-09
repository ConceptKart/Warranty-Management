import { prisma } from "@/lib/db";
import {
  getBaselinkerOrderById,
  getOrderStatusInfo,
  isNumericBaselinkerOrderId,
} from "@/lib/portal/baselinker-live-status";

export type TrackedTicket = {
  ticket_number: string;
  product_name: string | null;
  status_name: string | null;
  status_color: string | null;
  created_at: Date | null;
  updated_at: Date | null;
  order_number: string | null;
  source_platform: string | null;
  awb_number: string | null;
  reverse_awb_number: string | null;
  ticket_type_name: string | null;
  issue_name: string | null;
  customer_description: string | null;
  baselinker_order_id: string | null;
  /** local | live_baselinker */
  status_source: "local_database" | "live_baselinker";
  current_status_description: string | null;
  original_ticket_status: string | null;
};

type TrackRow = {
  ticket_number: string;
  product_name: string | null;
  status_name: string | null;
  status_color: string | null;
  created_at: Date | null;
  updated_at: Date | null;
  order_number: string | null;
  source_platform: string | null;
  awb_number: string | null;
  reverse_awb_number: string | null;
  ticket_type_name: string | null;
  issue_name: string | null;
  customer_description: string | null;
  baselinker_order_id: string | number | null;
};

/**
 * Local DB ticket lookup + optional live BaseLinker status override
 * (ports WarrantyController::getTicketDetails).
 */
export async function getTicketForTracking(
  ticketNumber: string,
): Promise<TrackedTicket | null> {
  const trimmed = ticketNumber.trim();
  if (!trimmed) return null;

  const rows = await prisma.$queryRaw<TrackRow[]>`
    SELECT
      wt.ticket_number,
      p.product_name,
      ts.status_name,
      ts.status_color,
      wt.created_at,
      wt.updated_at,
      COALESCE(wt.claim_number, o.order_number) AS order_number,
      o.source_platform,
      wt.awb_number,
      wt.reverse_awb_number,
      tt.type_name AS ticket_type_name,
      it.issue_name,
      wt.customer_description,
      o.baselinker_order_id
    FROM warranty_tickets wt
    LEFT JOIN issue_types it ON wt.issue_type_id = it.issue_type_id
    LEFT JOIN ticket_types tt ON wt.ticket_type_id = tt.ticket_type_id
    LEFT JOIN ticket_statuses ts ON wt.status_id = ts.status_id
    LEFT JOIN orders o ON wt.order_id = o.order_id
    LEFT JOIN products p ON wt.product_id = p.product_id
    WHERE wt.ticket_number = ${trimmed}
    LIMIT 1
  `;

  const row = rows[0];
  if (!row) return null;

  const localStatus = row.status_name ?? "Pending";
  const blId =
    row.baselinker_order_id != null ? String(row.baselinker_order_id) : null;

  const base: TrackedTicket = {
    ticket_number: row.ticket_number,
    product_name: row.product_name,
    status_name: localStatus,
    status_color: row.status_color,
    created_at: row.created_at,
    updated_at: row.updated_at,
    order_number: row.order_number,
    source_platform: row.source_platform,
    awb_number: row.awb_number,
    reverse_awb_number: row.reverse_awb_number,
    ticket_type_name: row.ticket_type_name,
    issue_name: row.issue_name,
    customer_description: row.customer_description,
    baselinker_order_id: blId,
    status_source: "local_database",
    current_status_description:
      "Using local ticket status (No BaseLinker order ID)",
    original_ticket_status: localStatus,
  };

  if (!isNumericBaselinkerOrderId(blId)) {
    if (blId) {
      base.current_status_description =
        "Using local ticket status (BaseLinker order ID is not numeric)";
    }
    return base;
  }

  try {
    const order = await getBaselinkerOrderById(blId!);
    if (!order) {
      base.current_status_description =
        "Using local ticket status (BaseLinker unavailable)";
      return base;
    }

    const live = await getOrderStatusInfo(order.order_status_id);
    return {
      ...base,
      status_name: live.status,
      status_source: "live_baselinker",
      current_status_description: live.description,
      original_ticket_status: localStatus,
    };
  } catch (error) {
    console.error("[getTicketForTracking] BaseLinker live status:", error);
    base.current_status_description =
      "Using local ticket status (BaseLinker error)";
    return base;
  }
}
