import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { assignAwbToTicket } from "@/lib/admin/ticket-details";

export type ShipmentFilters = {
  status?: string;
  courier?: string;
  search?: string;
};

export type ShipmentListItem = {
  shipment_id: number;
  ticket_id: number;
  awb_number: string;
  courier_partner: string;
  shipment_type: string;
  shipment_status: string | null;
  tracking_url: string | null;
  created_at: Date | string | null;
  ticket_number: string;
  priority: string | null;
  customer_name: string | null;
  customer_email: string | null;
  customer_phone: string | null;
  product_name: string | null;
  ticket_status: string | null;
  status_color: string | null;
};

export type ReadyTicket = {
  ticket_id: number;
  ticket_number: string;
  first_name: string | null;
  last_name: string | null;
  customer_address: string | null;
};

export type TrackingEvent = {
  tracking_id: number;
  status_code: string | null;
  status_message: string | null;
  location: string | null;
  timestamp: Date | string | null;
  courier_status: string | null;
  remarks: string | null;
  is_delivered: number | boolean | null;
  is_exception: number | boolean | null;
  exception_reason: string | null;
  formatted_timestamp: string | null;
};

function buildWhere(filters: ShipmentFilters) {
  const conditions: Prisma.Sql[] = [];

  if (filters.status?.trim()) {
    conditions.push(Prisma.sql`s.shipment_status = ${filters.status.trim()}`);
  }
  if (filters.courier?.trim()) {
    conditions.push(Prisma.sql`s.courier_partner = ${filters.courier.trim()}`);
  }
  if (filters.search?.trim()) {
    const like = `%${filters.search.trim()}%`;
    conditions.push(
      Prisma.sql`(
        s.awb_number LIKE ${like}
        OR wt.ticket_number LIKE ${like}
        OR CONCAT(IFNULL(c.first_name, ''), ' ', IFNULL(c.last_name, '')) LIKE ${like}
      )`,
    );
  }

  if (conditions.length === 0) return Prisma.empty;
  return Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}`;
}

/** Port of shipments.php list query */
export async function getShipments(
  filters: ShipmentFilters,
  page = 1,
  limit = 20,
) {
  const where = buildWhere(filters);
  const offset = (Math.max(1, page) - 1) * limit;

  const [shipments, countRows, couriers, statuses, readyTickets] =
    await Promise.all([
      prisma.$queryRaw<ShipmentListItem[]>`
        SELECT
          s.shipment_id,
          s.ticket_id,
          s.awb_number,
          s.courier_partner,
          s.shipment_type,
          s.shipment_status,
          s.tracking_url,
          s.created_at,
          wt.ticket_number,
          wt.priority,
          CONCAT(IFNULL(c.first_name, ''), ' ', IFNULL(c.last_name, '')) AS customer_name,
          c.email AS customer_email,
          c.phone AS customer_phone,
          p.product_name,
          ts.status_name AS ticket_status,
          ts.status_color
        FROM shipments s
        JOIN warranty_tickets wt ON s.ticket_id = wt.ticket_id
        JOIN orders o ON wt.order_id = o.order_id
        JOIN customers c ON o.customer_id = c.customer_id
        LEFT JOIN products p ON wt.product_id = p.product_id
        JOIN ticket_statuses ts ON wt.status_id = ts.status_id
        ${where}
        ORDER BY s.created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `,
      prisma.$queryRaw<Array<{ total: bigint | number }>>`
        SELECT COUNT(*) AS total
        FROM shipments s
        JOIN warranty_tickets wt ON s.ticket_id = wt.ticket_id
        JOIN orders o ON wt.order_id = o.order_id
        JOIN customers c ON o.customer_id = c.customer_id
        ${where}
      `,
      prisma.$queryRaw<Array<{ courier_partner: string }>>`
        SELECT DISTINCT courier_partner
        FROM shipments
        WHERE courier_partner IS NOT NULL AND courier_partner != ''
        ORDER BY courier_partner
      `,
      prisma.$queryRaw<Array<{ shipment_status: string }>>`
        SELECT DISTINCT shipment_status
        FROM shipments
        WHERE shipment_status IS NOT NULL AND shipment_status != ''
        ORDER BY shipment_status
      `,
      getTicketsReadyForShipment(),
    ]);

  const total = Number(countRows[0]?.total ?? 0);
  return {
    shipments,
    total,
    page: Math.max(1, page),
    per_page: limit,
    total_pages: Math.max(1, Math.ceil(total / limit)),
    couriers: couriers.map((r) => r.courier_partner),
    statuses: statuses.map((r) => r.shipment_status),
    readyTickets,
  };
}

/**
 * Replacement for CALL sp_get_tickets_ready_for_shipment()
 * (stored procedure is not present in the local dump).
 * Tickets without a forward AWB in accepted / return-assigned states.
 */
export async function getTicketsReadyForShipment(): Promise<ReadyTicket[]> {
  return prisma.$queryRaw<ReadyTicket[]>`
    SELECT
      wt.ticket_id,
      wt.ticket_number,
      c.first_name,
      c.last_name,
      c.address AS customer_address
    FROM warranty_tickets wt
    JOIN orders o ON wt.order_id = o.order_id
    JOIN customers c ON o.customer_id = c.customer_id
    JOIN ticket_statuses ts ON wt.status_id = ts.status_id
    WHERE (wt.awb_number IS NULL OR wt.awb_number = '')
      AND ts.status_code IN (
        'accepted',
        'awb_assigned_return',
        'replacement_approved',
        'in_process'
      )
    ORDER BY wt.updated_at DESC
    LIMIT 200
  `;
}

/** Port of assign_awb / shipments.php assign_awb action */
export async function assignShipmentAwb(input: {
  ticketId: number;
  awbNumber: string;
  courierPartner: string;
  shipmentType?: "forward" | "reverse";
  assignedBy: string;
}) {
  const existing = await prisma.$queryRaw<Array<{ shipment_id: number }>>`
    SELECT shipment_id FROM shipments
    WHERE awb_number = ${input.awbNumber.trim()}
    LIMIT 1
  `;
  if (existing[0]) {
    return { success: false as const, message: "AWB number already exists" };
  }

  const result = await assignAwbToTicket({
    ticketId: input.ticketId,
    awbNumber: input.awbNumber,
    courierPartner: input.courierPartner,
    shipmentType: input.shipmentType ?? "forward",
    assignedBy: input.assignedBy,
  });

  if (!result.success) {
    return { success: false as const, message: result.error };
  }

  return {
    success: true as const,
    message: "AWB assigned successfully",
    awb_number: input.awbNumber.trim(),
  };
}

/**
 * Port of shipments.php update_status without stored procedure
 * (mirrors ShipwayService::createManualTrackingStatus).
 */
export async function updateShipmentStatus(input: {
  awbNumber: string;
  statusCode: string;
  statusMessage: string;
  location?: string;
  remarks?: string;
  courierStatus?: string;
  timestamp?: string | null;
}) {
  const awb = input.awbNumber.trim();
  const statusCode = input.statusCode.trim();
  const statusMessage = input.statusMessage.trim();
  if (!awb || !statusCode || !statusMessage) {
    return {
      success: false as const,
      message: "AWB, status code, and status message are required",
    };
  }

  const shipments = await prisma.$queryRaw<
    Array<{
      shipment_id: number;
      ticket_id: number;
      shipment_status: string | null;
    }>
  >`
    SELECT shipment_id, ticket_id, shipment_status FROM shipments
    WHERE awb_number = ${awb}
    LIMIT 1
  `;
  const shipment = shipments[0];
  if (!shipment) {
    return { success: false as const, message: "Shipment not found" };
  }

  const normalized = statusCode.toLowerCase().replace(/\s+/g, "_");
  const oldStatus = (shipment.shipment_status || "").toLowerCase().replace(/\s+/g, "_");
  const statusChanged = Boolean(normalized) && normalized !== oldStatus;
  const isDelivered =
    normalized === "delivered" || normalized === "return_delivered" ? 1 : 0;
  const isException =
    normalized === "exception" ||
    normalized === "returned" ||
    normalized === "return_cancelled"
      ? 1
      : 0;
  const location = input.location?.trim() || "";
  const remarks = input.remarks?.trim() || "Manual status update";
  const courierStatus = input.courierStatus?.trim() || "manual_update";
  const eventAt = input.timestamp?.trim() || null;

  try {
    if (eventAt) {
      await prisma.$executeRaw`
        INSERT INTO shipment_tracking (
          shipment_id, status_code, status_message, location,
          timestamp, courier_status, remarks, is_delivered, is_exception, created_at
        ) VALUES (
          ${shipment.shipment_id},
          ${normalized},
          ${statusMessage},
          ${location},
          ${eventAt},
          ${courierStatus},
          ${remarks},
          ${isDelivered},
          ${isException},
          NOW()
        )
      `;
    } else {
      await prisma.$executeRaw`
        INSERT INTO shipment_tracking (
          shipment_id, status_code, status_message, location,
          timestamp, courier_status, remarks, is_delivered, is_exception, created_at
        ) VALUES (
          ${shipment.shipment_id},
          ${normalized},
          ${statusMessage},
          ${location},
          NOW(),
          ${courierStatus},
          ${remarks},
          ${isDelivered},
          ${isException},
          NOW()
        )
      `;
    }

    if (isDelivered) {
      await prisma.$executeRaw`
        UPDATE shipments
        SET shipment_status = ${normalized},
            actual_delivery = NOW(),
            updated_at = NOW()
        WHERE shipment_id = ${shipment.shipment_id}
      `;
    } else {
      await prisma.$executeRaw`
        UPDATE shipments
        SET shipment_status = ${normalized},
            updated_at = NOW()
        WHERE shipment_id = ${shipment.shipment_id}
      `;
    }

    await prisma.$executeRaw`
      UPDATE warranty_tickets
      SET shipment_status = ${normalized}, updated_at = NOW()
      WHERE ticket_id = ${shipment.ticket_id}
    `;

    // Only advance ticket workflow when shipment status actually changed (PHP syncLocalFromLookup)
    if (statusChanged) {
      const { updateTicketWorkflowStatusGuarded } = await import(
        "@/lib/admin/shipway-status-sync"
      );
      await updateTicketWorkflowStatusGuarded(
        Number(shipment.ticket_id),
        normalized,
      );
    }

    return { success: true as const, message: "Status updated successfully" };
  } catch (error) {
    console.error("[updateShipmentStatus]", error);
    return {
      success: false as const,
      message: error instanceof Error ? error.message : "Database error",
    };
  }
}

/** Port of tracking.php data load */
export async function getShipmentTracking(awbNumber: string) {
  const awb = awbNumber.trim();
  if (!awb) {
    return { success: false as const, error: "AWB number is required" };
  }

  const shipments = await prisma.$queryRaw<
    Array<{
      shipment_id: number;
      ticket_id: number;
      awb_number: string;
      courier_partner: string;
      shipment_type: string;
      shipment_status: string | null;
      tracking_url: string | null;
      estimated_delivery: Date | string | null;
      actual_delivery: Date | string | null;
      ticket_number: string;
      priority: string | null;
      customer_name: string | null;
      customer_email: string | null;
      customer_phone: string | null;
      product_name: string | null;
      ticket_status: string | null;
    }>
  >`
    SELECT
      s.shipment_id,
      s.ticket_id,
      s.awb_number,
      s.courier_partner,
      s.shipment_type,
      s.shipment_status,
      s.tracking_url,
      s.estimated_delivery,
      s.actual_delivery,
      wt.ticket_number,
      wt.priority,
      CONCAT(IFNULL(c.first_name, ''), ' ', IFNULL(c.last_name, '')) AS customer_name,
      c.email AS customer_email,
      c.phone AS customer_phone,
      p.product_name,
      ts.status_name AS ticket_status
    FROM shipments s
    JOIN warranty_tickets wt ON s.ticket_id = wt.ticket_id
    JOIN orders o ON wt.order_id = o.order_id
    JOIN customers c ON o.customer_id = c.customer_id
    LEFT JOIN products p ON wt.product_id = p.product_id
    JOIN ticket_statuses ts ON wt.status_id = ts.status_id
    WHERE s.awb_number = ${awb}
    LIMIT 1
  `;

  const shipment = shipments[0];
  if (!shipment) {
    return { success: false as const, error: "Shipment not found" };
  }

  const history = await prisma.$queryRaw<TrackingEvent[]>`
    SELECT
      st.tracking_id,
      st.status_code,
      st.status_message,
      st.location,
      st.timestamp,
      st.courier_status,
      st.remarks,
      st.is_delivered,
      st.is_exception,
      st.exception_reason,
      DATE_FORMAT(st.timestamp, '%M %d, %Y at %h:%i %p') AS formatted_timestamp
    FROM shipment_tracking st
    WHERE st.shipment_id = ${shipment.shipment_id}
    ORDER BY st.timestamp DESC
  `;

  return {
    success: true as const,
    shipment,
    history,
  };
}
