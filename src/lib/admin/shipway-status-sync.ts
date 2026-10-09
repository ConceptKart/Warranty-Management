/**
 * Sync Shipway mapped_status codes onto local warranty_tickets.status_id.
 * Ports AdminController::syncMappedStatusToTicket + updateStatusFromShipway.
 */

import { prisma } from "@/lib/db";
import { updateTicketStatus } from "@/lib/admin/ticket-details";

export type ShipwayStatusSyncResult = {
  success: boolean;
  error?: string;
  new_status_name?: string;
  new_status_color?: string | null;
  changed?: boolean;
};

/**
 * Silent auto-sync (page load / list). Forward-only by sort_order.
 * Does NOT send emails. Skips final statuses.
 */
export async function syncMappedStatusToTicket(
  ticketId: number,
  mappedStatus: string,
  awbType: "forward" | "reverse",
): Promise<void> {
  const mapped = mappedStatus.trim();
  if (!ticketId || !mapped) return;

  try {
    const tickets = await prisma.$queryRaw<
      Array<{
        ticket_type_id: number;
        current_status_id: number;
        current_sort_order: number;
        current_is_final: number | boolean | null;
      }>
    >`
      SELECT wt.ticket_type_id,
             wt.status_id AS current_status_id,
             ts.sort_order AS current_sort_order,
             ts.is_final AS current_is_final
      FROM warranty_tickets wt
      JOIN ticket_statuses ts ON ts.status_id = wt.status_id
      WHERE wt.ticket_id = ${ticketId}
      LIMIT 1
    `;
    const ticket = tickets[0];
    if (!ticket) return;
    if (ticket.current_is_final) return;

    const newStatuses = await prisma.$queryRaw<
      Array<{ status_id: number; status_name: string; sort_order: number }>
    >`
      SELECT status_id, status_name, sort_order
      FROM ticket_statuses
      WHERE status_code = ${mapped}
        AND ticket_type_id = ${ticket.ticket_type_id}
        AND is_active = 1
      LIMIT 1
    `;
    const newStatus = newStatuses[0];
    if (!newStatus) return;
    if (Number(newStatus.status_id) === Number(ticket.current_status_id)) return;
    if (Number(newStatus.sort_order) <= Number(ticket.current_sort_order)) return;

    const note = `${capitalize(awbType)} AWB status synced automatically from Shipway`;
    await prisma.$executeRaw`
      UPDATE warranty_tickets
      SET status_id = ${newStatus.status_id}, updated_at = NOW()
      WHERE ticket_id = ${ticketId}
    `;
    await prisma.$executeRaw`
      INSERT INTO ticket_status_history
        (ticket_id, old_status_id, new_status_id, changed_by, change_reason, notes, changed_at)
      VALUES (
        ${ticketId},
        ${ticket.current_status_id},
        ${newStatus.status_id},
        ${"system"},
        ${"Shipway auto-sync"},
        ${note},
        NOW()
      )
    `;
  } catch (error) {
    console.error(
      `[syncMappedStatusToTicket] ticket ${ticketId}:`,
      error instanceof Error ? error.message : error,
    );
  }
}

/**
 * Manual refresh path (Refresh AWB Statuses). Uses updateTicketStatus (emails).
 */
export async function updateStatusFromShipway(
  ticketId: number,
  mappedStatus: string,
  awbType: "forward" | "reverse",
  changedBy: string,
): Promise<ShipwayStatusSyncResult> {
  const mapped = mappedStatus.trim();
  if (!ticketId || !mapped) {
    return { success: false, error: "Missing parameters" };
  }

  try {
    const tickets = await prisma.$queryRaw<
      Array<{ ticket_type_id: number; current_status_id: number }>
    >`
      SELECT wt.ticket_type_id, wt.status_id AS current_status_id
      FROM warranty_tickets wt
      WHERE wt.ticket_id = ${ticketId}
      LIMIT 1
    `;
    const ticket = tickets[0];
    if (!ticket) {
      return { success: false, error: "Ticket not found" };
    }

    const newStatuses = await prisma.$queryRaw<
      Array<{
        status_id: number;
        status_name: string;
        status_color: string | null;
      }>
    >`
      SELECT status_id, status_name, status_color
      FROM ticket_statuses
      WHERE status_code = ${mapped}
        AND ticket_type_id = ${ticket.ticket_type_id}
        AND is_active = 1
      LIMIT 1
    `;
    const newStatus = newStatuses[0];
    if (!newStatus) {
      return {
        success: false,
        error: `No local status mapped for: ${mapped}`,
      };
    }

    if (Number(newStatus.status_id) === Number(ticket.current_status_id)) {
      return {
        success: true,
        new_status_name: newStatus.status_name,
        new_status_color: newStatus.status_color,
        changed: false,
      };
    }

    const result = await updateTicketStatus(
      ticketId,
      Number(newStatus.status_id),
      changedBy,
      "Shipway sync",
      `${capitalize(awbType)} AWB status updated automatically via Shipway refresh`,
    );

    if (result.success) {
      return {
        success: true,
        new_status_name: newStatus.status_name,
        new_status_color: newStatus.status_color,
        changed: true,
      };
    }

    return {
      success: false,
      error: "error" in result ? result.error : "Failed to update status",
    };
  } catch (error) {
    console.error("[updateStatusFromShipway]", error);
    return { success: false, error: "Database error" };
  }
}

/**
 * Apply mapped statuses from an AWB lookup map (refresh button path).
 * Skips awb_assigned_* like PHP tickets.php.
 */
export async function applyShipwayStatusUpdatesFromLookup(
  lookup: Record<
    number,
    {
      forward: { mapped_status?: string | null } | null;
      reverse: { mapped_status?: string | null } | null;
    }
  >,
  changedBy: string,
): Promise<
  Record<
    number,
    {
      status_name?: string;
      status_color?: string | null;
      changed: boolean;
    }
  >
> {
  const updates: Record<
    number,
    { status_name?: string; status_color?: string | null; changed: boolean }
  > = {};

  for (const [tidRaw, statuses] of Object.entries(lookup)) {
    const ticketId = Number(tidRaw);
    if (!ticketId) continue;

    const mappedFwd = statuses.forward?.mapped_status?.trim() || "";
    if (mappedFwd && mappedFwd !== "awb_assigned_forward") {
      const res = await updateStatusFromShipway(
        ticketId,
        mappedFwd,
        "forward",
        changedBy,
      );
      if (res.success && res.changed) {
        updates[ticketId] = {
          status_name: res.new_status_name,
          status_color: res.new_status_color,
          changed: true,
        };
      }
    }

    const mappedRev = statuses.reverse?.mapped_status?.trim() || "";
    if (mappedRev && mappedRev !== "awb_assigned_return") {
      const res = await updateStatusFromShipway(
        ticketId,
        mappedRev,
        "reverse",
        changedBy,
      );
      if (res.success && res.changed) {
        updates[ticketId] = {
          status_name: res.new_status_name,
          status_color: res.new_status_color,
          changed: true,
        };
      }
    }
  }

  return updates;
}

/**
 * Silent page-load sync for a ticket list (ports getTickets auto-persist).
 */
export async function silentSyncTicketsFromAwbLookup(
  lookup: Record<
    number,
    {
      forward: { mapped_status?: string | null } | null;
      reverse: { mapped_status?: string | null } | null;
    }
  >,
): Promise<void> {
  for (const [tidRaw, statuses] of Object.entries(lookup)) {
    const ticketId = Number(tidRaw);
    if (!ticketId) continue;

    const mappedFwd = statuses.forward?.mapped_status?.trim() || "";
    if (mappedFwd && mappedFwd !== "awb_assigned_forward") {
      await syncMappedStatusToTicket(ticketId, mappedFwd, "forward");
    }
    const mappedRev = statuses.reverse?.mapped_status?.trim() || "";
    if (mappedRev && mappedRev !== "awb_assigned_return") {
      await syncMappedStatusToTicket(ticketId, mappedRev, "reverse");
    }
  }
}

function capitalize(s: string) {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Admin-set statuses that cron/shipment sync must never overwrite (PHP ExternalShipmentSyncService). */
const ADMIN_SET_STATUSES = new Set([
  "accepted",
  "under_review",
  "rejected",
  "unit_replaced",
  "case_completed",
  "closed",
  "pending_customer",
  "escalated",
]);

const REVERSE_ONLY_CODES = new Set([
  "return_delivered",
  "return_cancelled",
  "return_in_transit",
  "return_out_for_pickup",
  "awb_assigned_return",
  "return_pickup_generated",
]);

/**
 * Guarded ticket workflow update for cron/shipment sync
 * (ports ExternalShipmentSyncService::updateTicketWorkflowStatus).
 * Only advances status_id; never overwrites admin-set or terminal statuses.
 */
export async function updateTicketWorkflowStatusGuarded(
  ticketId: number,
  mappedStatus: string,
): Promise<void> {
  const mapped = mappedStatus.trim();
  if (!ticketId || !mapped) return;

  try {
    const currentRows = await prisma.$queryRaw<
      Array<{ status_code: string; current_sort_order: number }>
    >`
      SELECT ts.status_code, ts.sort_order AS current_sort_order
      FROM warranty_tickets wt
      JOIN ticket_statuses ts ON ts.status_id = wt.status_id
      WHERE wt.ticket_id = ${ticketId}
      LIMIT 1
    `;
    const current = currentRows[0];
    if (!current) return;

    const currentCode = current.status_code;
    if (currentCode === "case_completed") return;
    if (ADMIN_SET_STATUSES.has(currentCode)) return;
    if (currentCode === "delivered" && REVERSE_ONLY_CODES.has(mapped)) return;

    const newSortRows = await prisma.$queryRaw<
      Array<{ new_sort_order: number }>
    >`
      SELECT ts_new.sort_order AS new_sort_order
      FROM warranty_tickets wt
      JOIN ticket_statuses ts_new
        ON ts_new.status_code = ${mapped}
       AND ts_new.ticket_type_id = wt.ticket_type_id
      WHERE wt.ticket_id = ${ticketId}
      LIMIT 1
    `;
    const newSort = newSortRows[0];
    if (!newSort) return;
    if (Number(newSort.new_sort_order) <= Number(current.current_sort_order)) {
      return;
    }

    await prisma.$executeRaw`
      UPDATE warranty_tickets wt
      JOIN ticket_statuses ts_new
        ON ts_new.status_code = ${mapped}
       AND ts_new.ticket_type_id = wt.ticket_type_id
      SET wt.status_id = ts_new.status_id, wt.updated_at = NOW()
      WHERE wt.ticket_id = ${ticketId}
    `;
  } catch (error) {
    console.error(
      `[updateTicketWorkflowStatusGuarded] ticket ${ticketId}:`,
      error instanceof Error ? error.message : error,
    );
  }
}
