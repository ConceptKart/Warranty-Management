import { prisma } from "@/lib/db";
import {
  lookupAwbStatusesFromExternal,
  type AwbStatusResult,
} from "@/lib/admin/external-shipment-sync";

const FORWARD_TERMINAL = new Set(["delivered"]);
const REVERSE_TERMINAL = new Set(["return_delivered", "return_cancelled"]);
const ALL_TERMINAL = new Set([...FORWARD_TERMINAL, ...REVERSE_TERMINAL]);

export type TicketTrackingSnapshot = {
  forward_awb: string | null;
  reverse_awb: string | null;
  forward: AwbStatusResult | null;
  reverse: AwbStatusResult | null;
};

async function buildAwbTypeMap(ticketId: number) {
  const awbTypeMap: Record<string, "forward" | "reverse"> = {};

  const ticketRows = await prisma.$queryRaw<
    Array<{ awb_number: string | null; reverse_awb_number: string | null }>
  >`
    SELECT awb_number, reverse_awb_number FROM warranty_tickets
    WHERE ticket_id = ${ticketId} LIMIT 1
  `;
  const ticketRow = ticketRows[0];
  if (ticketRow?.awb_number?.trim()) {
    awbTypeMap[ticketRow.awb_number.trim()] = "forward";
  }
  if (ticketRow?.reverse_awb_number?.trim()) {
    awbTypeMap[ticketRow.reverse_awb_number.trim()] = "reverse";
  }

  const shipmentRows = await prisma.$queryRaw<
    Array<{
      awb_number: string;
      shipment_type: string | null;
      shipment_status: string | null;
    }>
  >`
    SELECT awb_number, shipment_type, shipment_status
    FROM shipments
    WHERE ticket_id = ${ticketId}
      AND awb_number IS NOT NULL AND awb_number != ''
  `;

  const terminalStatusMap: Record<string, AwbStatusResult> = {};

  for (const shipment of shipmentRows) {
    const awb = shipment.awb_number.trim();
    if (shipment.shipment_type === "forward" || shipment.shipment_type === "reverse") {
      awbTypeMap[awb] = shipment.shipment_type;
    }
    if (
      shipment.shipment_status &&
      ALL_TERMINAL.has(shipment.shipment_status)
    ) {
      const cacheRows = await prisma.$queryRaw<
        Array<{ tracking_data: string | null }>
      >`
        SELECT tracking_data FROM shipway_tracking_cache
        WHERE awb_number = ${awb} LIMIT 1
      `;
      let externalStatus: string | null = null;
      let syncedAt: string | null = null;
      try {
        const parsed = JSON.parse(cacheRows[0]?.tracking_data ?? "{}") as {
          external_status?: string;
          synced_at?: string;
        };
        externalStatus = parsed.external_status ?? null;
        syncedAt = parsed.synced_at ?? null;
      } catch {
        /* ignore */
      }

      terminalStatusMap[awb] = {
        display_status:
          externalStatus ??
          (shipment.shipment_status ?? "").toUpperCase().replace(/_/g, " "),
        mapped_status: shipment.shipment_status,
        type: (shipment.shipment_type as "forward" | "reverse") ?? "forward",
        courier: null,
        last_updated: syncedAt,
        needs_action: false,
        raw_status: externalStatus,
        locked: true,
      };
    }
  }

  return { awbTypeMap, terminalStatusMap };
}

function splitByType(
  awbTypeMap: Record<string, "forward" | "reverse">,
  statuses: Record<string, AwbStatusResult>,
): { forward: AwbStatusResult | null; reverse: AwbStatusResult | null } {
  let forward: AwbStatusResult | null = null;
  let reverse: AwbStatusResult | null = null;

  for (const [awb, status] of Object.entries(statuses)) {
    if ((awbTypeMap[awb] ?? "forward") === "forward") {
      forward = status;
    } else {
      reverse = status;
    }
  }

  return { forward, reverse };
}

export async function getTrackingStatusesForTicket(
  ticketId: number,
  forwardAwb?: string | null,
  reverseAwb?: string | null,
): Promise<TicketTrackingSnapshot> {
  const { awbTypeMap, terminalStatusMap } = await buildAwbTypeMap(ticketId);

  const fwd =
    forwardAwb?.trim() ||
    Object.entries(awbTypeMap).find(([, t]) => t === "forward")?.[0] ||
    null;
  const rev =
    reverseAwb?.trim() ||
    Object.entries(awbTypeMap).find(([, t]) => t === "reverse")?.[0] ||
    null;

  const awbs = Object.keys(awbTypeMap);
  if (awbs.length === 0) {
    return {
      forward_awb: fwd,
      reverse_awb: rev,
      forward: null,
      reverse: null,
    };
  }

  const awbsToQuery = awbs.filter((awb) => !terminalStatusMap[awb]);
  let liveStatuses: Record<string, AwbStatusResult> = {};
  if (awbsToQuery.length > 0) {
    liveStatuses = await lookupAwbStatusesFromExternal(awbsToQuery);
  }

  const allStatuses = { ...liveStatuses, ...terminalStatusMap };
  const { forward, reverse } = splitByType(awbTypeMap, allStatuses);

  return {
    forward_awb: fwd,
    reverse_awb: rev,
    forward,
    reverse,
  };
}

/** Mirrors ticket-details.php action=refresh_tracking */
export async function refreshTicketTracking(ticketId: number) {
  if (!ticketId) {
    return { success: false as const, error: "Ticket ID required" };
  }

  const { awbTypeMap, terminalStatusMap } = await buildAwbTypeMap(ticketId);
  const awbs = Object.keys(awbTypeMap);

  if (awbs.length === 0) {
    return {
      success: false as const,
      error: "No AWB numbers found for this ticket",
    };
  }

  const awbsToQuery = awbs.filter((awb) => !terminalStatusMap[awb]);
  let liveStatuses: Record<string, AwbStatusResult> = {};
  if (awbsToQuery.length > 0) {
    try {
      liveStatuses = await lookupAwbStatusesFromExternal(awbsToQuery);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "External DB lookup failed";
      return { success: false as const, error: `Failed to refresh: ${message}` };
    }
  }

  const allStatuses = { ...terminalStatusMap, ...liveStatuses };
  const { forward, reverse } = splitByType(awbTypeMap, allStatuses);

  const statusRows = await prisma.$queryRaw<Array<{ status_code: string }>>`
    SELECT ts.status_code
    FROM warranty_tickets wt
    JOIN ticket_statuses ts ON ts.status_id = wt.status_id
    WHERE wt.ticket_id = ${ticketId}
    LIMIT 1
  `;

  return {
    success: true as const,
    forward,
    reverse,
    case_completed: statusRows[0]?.status_code === "case_completed",
  };
}
