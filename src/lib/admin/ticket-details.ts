import { prisma } from "@/lib/db";
import { getTrackingStatusesForTicket } from "@/lib/admin/shipment-tracking";

export type TicketDetail = {
  ticket_id: number;
  ticket_number: string;
  claim_number: string | null;
  order_id: number;
  product_id: number;
  selected_products_json: string | null;
  product_quantity: number;
  ticket_type_id: number;
  issue_type_id: number;
  status_id: number;
  customer_description: string;
  internal_notes: string | null;
  resolution_details: string | null;
  ticket_date: Date | null;
  resolution_date: Date | null;
  priority: string;
  assigned_to: string | null;
  tracking_number: string | null;
  awb_number: string | null;
  reverse_awb_number: string | null;
  courier_partner: string | null;
  shipment_status: string | null;
  created_at: Date | null;
  updated_at: Date | null;
  replacement_ean: string | null;
  replacement_product_id: number | null;
  replacement_variant_id: number | null;
  replacement_warehouse_id: number | null;
  replacement_location: string | null;
  source_device: string | null;
  customer_email: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  address: string | null;
  customer_id: number;
  product_name: string | null;
  product_sku: string | null;
  warranty_period_months: unknown;
  order_number: string | null;
  baselinker_order_id: string | null;
  source_platform: string | null;
  order_value: unknown;
  order_status: string | null;
  order_date: Date | null;
  delivery_date: Date | null;
  warranty_start_date: Date | null;
  warranty_end_date: Date | null;
  replacement_end_date: Date | null;
  status_name: string | null;
  status_color: string | null;
  ticket_type: string | null;
  issue_name: string | null;
};

export type TicketAttachment = {
  attachment_id: number;
  ticket_id: number;
  original_filename: string;
  stored_filename: string;
  file_path: string;
  remote_url: string | null;
  file_type: string;
  file_size: number;
  uploaded_by: string;
  created_at: Date | null;
};

export type TicketComment = {
  comment_id: number;
  ticket_id: number;
  comment_type: string;
  comment_text: string;
  author_name: string;
  author_email: string | null;
  is_internal: number | boolean | null;
  created_at: Date | null;
};

export type StatusHistoryItem = {
  history_id: number;
  ticket_id: number;
  old_status_id: number | null;
  new_status_id: number;
  changed_by: string;
  change_reason: string | null;
  notes: string | null;
  changed_at: Date | null;
  old_status_name: string | null;
  new_status_name: string | null;
};

export type EmailLogItem = {
  log_id: number;
  recipient_email: string;
  subject: string;
  status_code: string;
  sent: number | boolean;
  error_message: string | null;
  body_html: string | null;
  sent_at: Date;
};

export type TicketStatusOption = {
  status_id: number;
  status_name: string;
  status_code: string;
  status_color: string | null;
  sort_order: number;
};

export type PreviousClaim = {
  ticket_number: string;
  ticket_id: number;
  created_at: Date | null;
  type_name: string | null;
  status_name: string | null;
  status_color: string | null;
};

/** Mirrors AdminController::getTicketDetails (without external AWB sync) */
export async function getTicketDetails(ticketNumber: string) {
  const rows = await prisma.$queryRaw<TicketDetail[]>`
    SELECT
      wt.ticket_id,
      wt.ticket_number,
      wt.claim_number,
      wt.order_id,
      wt.product_id,
      wt.selected_products_json,
      wt.product_quantity,
      wt.ticket_type_id,
      wt.issue_type_id,
      wt.status_id,
      wt.customer_description,
      wt.internal_notes,
      wt.resolution_details,
      wt.ticket_date,
      wt.resolution_date,
      wt.priority,
      wt.assigned_to,
      wt.tracking_number,
      wt.awb_number,
      wt.reverse_awb_number,
      wt.courier_partner,
      wt.shipment_status,
      wt.created_at,
      wt.updated_at,
      wt.replacement_ean,
      wt.replacement_product_id,
      wt.replacement_variant_id,
      wt.replacement_warehouse_id,
      wt.replacement_location,
      wt.source_device,
      c.email AS customer_email,
      c.first_name,
      c.last_name,
      c.phone,
      c.address,
      c.customer_id,
      p.product_name,
      p.product_sku,
      p.warranty_period_months,
      COALESCE(wt.claim_number, o.order_number) AS order_number,
      o.baselinker_order_id,
      o.source_platform,
      o.order_value,
      o.order_status,
      o.order_date,
      o.delivery_date,
      o.warranty_start_date,
      o.warranty_end_date,
      o.replacement_end_date,
      ts.status_name,
      ts.status_color,
      tt.type_name AS ticket_type,
      it.issue_name
    FROM warranty_tickets wt
    JOIN orders o ON wt.order_id = o.order_id
    JOIN customers c ON o.customer_id = c.customer_id
    LEFT JOIN products p ON wt.product_id = p.product_id
    LEFT JOIN ticket_statuses ts ON wt.status_id = ts.status_id
    LEFT JOIN ticket_types tt ON wt.ticket_type_id = tt.ticket_type_id
    LEFT JOIN issue_types it ON wt.issue_type_id = it.issue_type_id
    WHERE wt.ticket_number = ${ticketNumber}
    LIMIT 1
  `;

  const ticket = rows[0];
  if (!ticket) return null;

  const [
    attachments,
    comments,
    statusHistory,
    emailLogs,
    availableStatuses,
    tracking,
    previousClaims,
  ] = await Promise.all([
    getTicketAttachments(ticketNumber),
    getTicketComments(ticket.ticket_id),
    getTicketStatusHistory(ticket.ticket_id),
    getTicketEmailLogs(ticket.ticket_id),
    getAllStatusesForType(ticket.ticket_type_id),
    getTrackingStatusesForTicket(
      ticket.ticket_id,
      ticket.awb_number,
      ticket.reverse_awb_number,
    ).catch((error) => {
      console.error("[getTicketDetails] tracking lookup:", error);
      return {
        forward_awb: ticket.awb_number,
        reverse_awb: ticket.reverse_awb_number,
        forward: null,
        reverse: null,
      };
    }),
    getPreviousClaimsForOrder(
      ticket.baselinker_order_id,
      ticket.ticket_id,
    ),
  ]);

  return {
    ...ticket,
    attachments,
    comments,
    status_history: statusHistory,
    email_logs: emailLogs,
    available_statuses: availableStatuses,
    tracking,
    previous_claims: previousClaims,
  };
}

/** Other claims on the same BaseLinker order (PHP ticket-details.php). */
export async function getPreviousClaimsForOrder(
  baselinkerOrderId: string | null | undefined,
  currentTicketId: number,
): Promise<PreviousClaim[]> {
  const orderKey = String(baselinkerOrderId ?? "").trim();
  if (!orderKey || !currentTicketId) return [];

  try {
    const rows = await prisma.$queryRaw<PreviousClaim[]>`
      SELECT
        wt.ticket_number,
        wt.ticket_id,
        wt.created_at,
        tt.type_name,
        ts.status_name,
        ts.status_color
      FROM warranty_tickets wt
      JOIN orders o ON wt.order_id = o.order_id
      LEFT JOIN ticket_types tt ON wt.ticket_type_id = tt.ticket_type_id
      LEFT JOIN ticket_statuses ts ON wt.status_id = ts.status_id
      WHERE o.baselinker_order_id = ${orderKey}
        AND wt.ticket_id != ${currentTicketId}
      ORDER BY wt.created_at DESC
    `;

    return rows.map((row) => ({
      ...row,
      ticket_id: Number(row.ticket_id),
      type_name: row.type_name ?? null,
      status_name: row.status_name ?? null,
      status_color: row.status_color ?? null,
    }));
  } catch (error) {
    console.error("[getPreviousClaimsForOrder]", error);
    return [];
  }
}

export async function getTicketAttachments(ticketNumber: string) {
  return prisma.$queryRaw<TicketAttachment[]>`
    SELECT ta.*
    FROM ticket_attachments ta
    JOIN warranty_tickets wt ON ta.ticket_id = wt.ticket_id
    WHERE wt.ticket_number = ${ticketNumber}
    ORDER BY ta.created_at DESC
  `;
}

export async function getTicketComments(ticketId: number) {
  return prisma.$queryRaw<TicketComment[]>`
    SELECT *
    FROM ticket_comments
    WHERE ticket_id = ${ticketId}
    ORDER BY created_at ASC
  `;
}

export async function getTicketStatusHistory(ticketId: number) {
  return prisma.$queryRaw<StatusHistoryItem[]>`
    SELECT
      tsh.*,
      ts_old.status_name AS old_status_name,
      ts_new.status_name AS new_status_name
    FROM ticket_status_history tsh
    LEFT JOIN ticket_statuses ts_old ON tsh.old_status_id = ts_old.status_id
    JOIN ticket_statuses ts_new ON tsh.new_status_id = ts_new.status_id
    WHERE tsh.ticket_id = ${ticketId}
    ORDER BY tsh.changed_at DESC
  `;
}

export async function getTicketEmailLogs(ticketId: number) {
  return prisma.$queryRaw<EmailLogItem[]>`
    SELECT log_id, recipient_email, subject, status_code, sent, error_message, body_html, sent_at
    FROM ticket_email_log
    WHERE ticket_id = ${ticketId}
    ORDER BY sent_at DESC
    LIMIT 50
  `;
}

export async function getAllStatusesForType(ticketTypeId: number) {
  return prisma.$queryRaw<TicketStatusOption[]>`
    SELECT status_id, status_name, status_code, status_color, sort_order
    FROM ticket_statuses
    WHERE is_active = 1 AND ticket_type_id = ${ticketTypeId}
    ORDER BY sort_order ASC
  `;
}

async function resolveStatusIdByCode(
  ticketTypeId: number,
  statusCode: string,
): Promise<number | null> {
  const rows = await prisma.$queryRaw<Array<{ status_id: number }>>`
    SELECT status_id
    FROM ticket_statuses
    WHERE ticket_type_id = ${ticketTypeId}
      AND status_code = ${statusCode}
      AND is_active = 1
    LIMIT 1
  `;
  return rows[0]?.status_id ?? null;
}

export type TicketShipmentData = {
  ticket_id: number;
  ticket_number: string;
  ticket_type_id: number;
  awb_number: string | null;
  reverse_awb_number: string | null;
  courier_partner: string | null;
  selected_products_json: string | null;
  first_name: string | null;
  last_name: string | null;
  customer_email: string | null;
  customer_phone: string | null;
  customer_address: string | null;
  product_name: string | null;
  product_sku: string | null;
  order_number: string | null;
  order_value: number | null;
  source_platform: string | null;
};

/** Mirrors AdminController::getTicketDataForReturnShipment */
export async function getTicketDataForShipment(
  ticketId: number,
): Promise<TicketShipmentData | null> {
  const rows = await prisma.$queryRaw<TicketShipmentData[]>`
    SELECT
      wt.ticket_id,
      wt.ticket_number,
      wt.ticket_type_id,
      wt.awb_number,
      wt.reverse_awb_number,
      wt.courier_partner,
      wt.selected_products_json,
      c.first_name,
      c.last_name,
      c.email AS customer_email,
      c.phone AS customer_phone,
      c.address AS customer_address,
      p.product_name,
      p.product_sku,
      COALESCE(wt.claim_number, o.order_number) AS order_number,
      o.order_value,
      o.source_platform
    FROM warranty_tickets wt
    JOIN orders o ON wt.order_id = o.order_id
    JOIN customers c ON o.customer_id = c.customer_id
    LEFT JOIN products p ON wt.product_id = p.product_id
    WHERE wt.ticket_id = ${ticketId}
    LIMIT 1
  `;

  const result = rows[0];
  if (!result) return null;

  try {
    const selected = JSON.parse(result.selected_products_json ?? "null") as Array<{
      name?: string;
      sku?: string;
      product_name?: string;
      product_sku?: string;
    }>;
    if (Array.isArray(selected) && selected[0]) {
      result.product_name =
        selected[0].product_name || selected[0].name || result.product_name;
      result.product_sku =
        selected[0].product_sku || selected[0].sku || result.product_sku;
    }
  } catch {
    /* ignore */
  }

  return result;
}

export function parseCustomerAddress(rawAddress: string) {
  const parts = rawAddress
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  let pincode = "";
  let state = "";
  let city = "";
  let address = rawAddress.trim();

  for (let i = parts.length - 1; i >= 0; i--) {
    if (/^\d{6}$/.test(parts[i]!)) {
      pincode = parts[i]!;
      state = parts[i - 1] ?? "";
      city = parts[i - 2] ?? "";
      address = parts.slice(0, Math.max(0, i - 2)).join(", ");
      break;
    }
  }

  if (!pincode && parts.length >= 3) {
    pincode = parts[parts.length - 1]!;
    state = parts[parts.length - 2]!;
    city = parts[parts.length - 3]!;
    address = parts.slice(0, parts.length - 3).join(", ");
  }

  return { address, city, state, pincode };
}

/**
 * Persist reverse AWB without changing ticket workflow status.
 * Used after status → accepted (PHP bypasses assignAWBToTicket).
 */
export async function persistReverseAwbOnly(input: {
  ticketId: number;
  awbNumber: string;
  courierPartner: string;
}) {
  const awb = input.awbNumber.trim();
  const courier = input.courierPartner.trim() || "Shipway";
  if (!input.ticketId || !awb) {
    return { success: false as const, error: "ticket_id and awb_number required" };
  }

  await prisma.$executeRaw`
    UPDATE warranty_tickets
    SET reverse_awb_number = ${awb},
        courier_partner = ${courier},
        shipment_status = 'shipped',
        updated_at = NOW()
    WHERE ticket_id = ${input.ticketId}
  `;
  await prisma.$executeRaw`
    DELETE FROM shipments WHERE ticket_id = ${input.ticketId} AND awb_number = ${awb}
  `;
  await prisma.$executeRaw`
    INSERT INTO shipments (
      ticket_id, awb_number, courier_partner, shipment_type,
      delivery_address, shipment_status, created_at, updated_at
    ) VALUES (
      ${input.ticketId}, ${awb}, ${courier}, 'reverse',
      '', 'created', NOW(), NOW()
    )
  `;

  return { success: true as const, awb_number: awb, courier_name: courier };
}

/** Mirrors AdminController::assignAWBToTicket (manual / post-Shipway assign path). */
export async function assignAwbToTicket(input: {
  ticketId: number;
  awbNumber: string;
  courierPartner: string;
  shipmentType: "forward" | "reverse";
  assignedBy: string;
  updateWorkflowStatus?: boolean;
}) {
  const awb = input.awbNumber.trim();
  const courier = input.courierPartner.trim();
  const updateWorkflow = input.updateWorkflowStatus !== false;
  if (!input.ticketId || !awb || !courier) {
    return { success: false as const, error: "ticket_id, awb_number and courier_partner are required" };
  }
  if (!/^[a-zA-Z0-9-]+$/.test(awb)) {
    return { success: false as const, error: "Invalid AWB format" };
  }

  const ticketRows = await prisma.$queryRaw<
    Array<{
      ticket_id: number;
      status_id: number;
      ticket_type_id: number;
      reverse_awb_number: string | null;
    }>
  >`
    SELECT ticket_id, status_id, ticket_type_id, reverse_awb_number
    FROM warranty_tickets
    WHERE ticket_id = ${input.ticketId}
    LIMIT 1
  `;
  const ticket = ticketRows[0];
  if (!ticket) {
    return { success: false as const, error: "Ticket not found" };
  }

  const targetStatusCode =
    input.shipmentType === "reverse"
      ? "awb_assigned_return"
      : "awb_assigned_forward";

  const newStatusId = updateWorkflow
    ? ((await resolveStatusIdByCode(ticket.ticket_type_id, targetStatusCode)) ??
      ticket.status_id)
    : ticket.status_id;

  const label =
    input.shipmentType === "reverse" ? "Return Shipment" : "Forward Shipment";

  if (input.shipmentType === "reverse") {
    const oldRev = ticket.reverse_awb_number?.trim();
    if (oldRev && oldRev !== awb) {
      await prisma.$executeRaw`DELETE FROM shipments WHERE awb_number = ${oldRev}`;
    }
    await prisma.$executeRaw`
      UPDATE warranty_tickets
      SET reverse_awb_number = ${awb},
          courier_partner = ${courier},
          shipment_status = 'shipped',
          status_id = ${newStatusId},
          updated_at = NOW()
      WHERE ticket_id = ${input.ticketId}
    `;
  } else {
    await prisma.$executeRaw`
      UPDATE warranty_tickets
      SET awb_number = ${awb},
          courier_partner = ${courier},
          shipment_status = 'shipped',
          tracking_number = ${awb},
          status_id = ${newStatusId},
          updated_at = NOW()
      WHERE ticket_id = ${input.ticketId}
    `;
  }

  await prisma.$executeRaw`
    DELETE FROM shipments WHERE ticket_id = ${input.ticketId} AND awb_number = ${awb}
  `;
  await prisma.$executeRaw`
    INSERT INTO shipments (
      ticket_id, awb_number, courier_partner, shipment_type,
      delivery_address, shipment_status, created_at, updated_at
    ) VALUES (
      ${input.ticketId}, ${awb}, ${courier}, ${input.shipmentType},
      '', 'created', NOW(), NOW()
    )
  `;

  if (updateWorkflow) {
    await prisma.$executeRaw`
      INSERT INTO ticket_status_history (
        ticket_id, old_status_id, new_status_id, changed_by, change_reason, notes, changed_at
      ) VALUES (
        ${input.ticketId},
        ${ticket.status_id},
        ${newStatusId},
        ${input.assignedBy},
        'AWB Assignment',
        ${`${label} AWB: ${awb} | Courier: ${courier}`},
        NOW()
      )
    `;

    try {
      const { sendForStatus } = await import("@/lib/email/email-service");
      await sendForStatus(input.ticketId, targetStatusCode);
    } catch (error) {
      console.error("[assignAwbToTicket] Email error:", error);
    }
  }

  return { success: true as const };
}

/** Create Shipway return/forward shipment then assign AWB locally. */
export async function createShipwayShipmentAndAssign(input: {
  ticketId: number;
  mode: "return" | "forward";
  assignedBy: string;
  customerAddress: string;
  customerCity: string;
  customerState: string;
  customerZipcode: string;
}) {
  if (
    !input.customerAddress.trim() ||
    !input.customerCity.trim() ||
    !input.customerState.trim() ||
    !input.customerZipcode.trim()
  ) {
    return {
      success: false as const,
      error:
        "Customer address, city, state, and zipcode are required for shipment creation",
    };
  }

  const ticketData = await getTicketDataForShipment(input.ticketId);
  if (!ticketData) {
    return {
      success: false as const,
      error: "Could not fetch ticket details for shipment",
    };
  }

  const baseOrderId =
    ticketData.order_number || ticketData.ticket_number || String(input.ticketId);
  const shipmentData = {
    order_id: input.mode === "forward" ? `${baseOrderId}P` : baseOrderId,
    ticket_number: ticketData.ticket_number,
    product_name: ticketData.product_name || "Warranty Product",
    product_sku: ticketData.product_sku || "PRODUCT",
    product_price: Number(ticketData.order_value ?? 0),
    order_total: Number(ticketData.order_value ?? 0),
    quantity: 1,
    customer_name: `${ticketData.first_name ?? ""} ${ticketData.last_name ?? ""}`.trim(),
    customer_email: ticketData.customer_email || "",
    customer_phone: ticketData.customer_phone || "",
    customer_address: input.customerAddress.trim(),
    customer_city: input.customerCity.trim(),
    customer_state: input.customerState.trim(),
    customer_zipcode: input.customerZipcode.trim(),
  };

  const {
    createForwardShipment,
    createReturnShipment,
  } = await import("@/lib/admin/shipway-service");

  const shipwayResult =
    input.mode === "return"
      ? await createReturnShipment(shipmentData)
      : await createForwardShipment(shipmentData);

  const label = input.mode === "return" ? "Return" : "Forward";

  if (!shipwayResult.success) {
    return {
      success: false as const,
      error: `Shipway API error: ${shipwayResult.error}`,
      shipway_details: shipwayResult.data ?? null,
    };
  }

  const shipwayAwb = shipwayResult.awb_number || "";
  const shipwayCourier = shipwayResult.courier_name || "";
  const shippingUrl = shipwayResult.shipping_url || "";
  const rmaNo = "rma_no" in shipwayResult ? shipwayResult.rma_no || "" : "";

  if (!shipwayAwb) {
    return {
      success: true as const,
      message: `${label} shipment created on Shipway. AWB will be assigned by courier shortly.`,
      awb_number: "",
      courier_name: "",
      rma_no: rmaNo,
      shipping_url: shippingUrl,
      shipment_type: input.mode,
    };
  }

  const finalCourier = shipwayCourier || "Shipway";
  const dbShipmentType = input.mode === "return" ? "reverse" : "forward";
  const assignResult = await assignAwbToTicket({
    ticketId: input.ticketId,
    awbNumber: shipwayAwb,
    courierPartner: finalCourier,
    shipmentType: dbShipmentType,
    assignedBy: input.assignedBy,
  });

  if (!assignResult.success) {
    return {
      success: false as const,
      error: `Shipway created the shipment (AWB: ${shipwayAwb}) but it could not be saved to the database: ${assignResult.error}. Please assign AWB ${shipwayAwb} manually.`,
      awb_number: shipwayAwb,
      courier_name: finalCourier,
      shipping_url: shippingUrl,
      shipment_type: input.mode,
    };
  }

  return {
    success: true as const,
    message: `${label} shipment created successfully on Shipway!`,
    awb_number: shipwayAwb,
    courier_name: finalCourier,
    rma_no: rmaNo,
    shipping_url: shippingUrl,
    shipment_type: input.mode,
  };
}

/** Mirrors AdminController::updateTicketPriority */
export async function updateTicketPriority(ticketId: number, priority: string) {
  const allowed = ["medium", "high", "urgent"];
  if (!allowed.includes(priority)) {
    return { success: false as const, error: "Invalid priority value" };
  }

  await prisma.$executeRaw`
    UPDATE warranty_tickets
    SET priority = ${priority}, updated_at = NOW()
    WHERE ticket_id = ${ticketId}
  `;

  return { success: true as const };
}

/** Mirrors AdminController::updateTicketStatus (incl. status emails; accepted skipped) */
export async function updateTicketStatus(
  ticketId: number,
  newStatusId: number,
  changedBy: string,
  reason = "",
  notes = "",
) {
  const current = await prisma.$queryRaw<Array<{ status_id: number }>>`
    SELECT status_id FROM warranty_tickets WHERE ticket_id = ${ticketId} LIMIT 1
  `;
  const currentStatusId = current[0]?.status_id;

  if (currentStatusId == null) {
    return { success: false as const, error: "Ticket not found" };
  }

  if (Number(currentStatusId) === Number(newStatusId)) {
    return {
      success: false as const,
      error: "Status is already set to this value",
    };
  }

  await prisma.$transaction([
    prisma.$executeRaw`
      UPDATE warranty_tickets
      SET status_id = ${newStatusId}, updated_at = NOW()
      WHERE ticket_id = ${ticketId}
    `,
    prisma.$executeRaw`
      INSERT INTO ticket_status_history (
        ticket_id, old_status_id, new_status_id, changed_by, change_reason, notes, changed_at
      ) VALUES (
        ${ticketId}, ${currentStatusId}, ${newStatusId}, ${changedBy}, ${reason}, ${notes}, NOW()
      )
    `,
  ]);

  let emailSent = false;
  let emailError: string | null = null;
  let shipwayReturn:
    | {
        success: boolean;
        awb_number?: string;
        courier_name?: string;
        shipping_url?: string;
        error?: string;
        warning?: string;
      }
    | null = null;

  try {
    const codeRows = await prisma.$queryRaw<Array<{ status_code: string }>>`
      SELECT status_code FROM ticket_statuses WHERE status_id = ${newStatusId} LIMIT 1
    `;
    const statusCode = codeRows[0]?.status_code;
    if (statusCode && statusCode !== "accepted") {
      const { sendForStatus } = await import("@/lib/email/email-service");
      const emailResult = await sendForStatus(ticketId, statusCode);
      emailSent = emailResult.sent;
      emailError = emailResult.error;
    }

    // Auto-create reverse shipment when status → accepted (PHP ticket-details.php)
    if (statusCode === "accepted") {
      shipwayReturn = await autoCreateReturnOnAccepted(ticketId);
    }
  } catch (error) {
    console.error("[updateTicketStatus] Email/shipway error:", error);
    emailError = error instanceof Error ? error.message : "Email send failed";
  }

  return {
    success: true as const,
    email_sent: emailSent,
    email_error: emailError,
    shipway_return: shipwayReturn,
  };
}

async function autoCreateReturnOnAccepted(ticketId: number) {
  const existing = await prisma.$queryRaw<
    Array<{ reverse_awb_number: string | null }>
  >`
    SELECT reverse_awb_number FROM warranty_tickets WHERE ticket_id = ${ticketId} LIMIT 1
  `;
  if (existing[0]?.reverse_awb_number?.trim()) {
    return {
      success: true,
      awb_number: existing[0].reverse_awb_number,
      warning: "Return AWB already present; skipped Shipway create",
    };
  }

  const ticketData = await getTicketDataForShipment(ticketId);
  if (!ticketData) {
    return { success: false, error: "Could not load ticket for return shipment" };
  }

  const parsed = parseCustomerAddress(ticketData.customer_address || "");
  if (!parsed.city || !parsed.state || !parsed.pincode) {
    return {
      success: false,
      error:
        "Customer address incomplete (city/state/pincode required) for auto return shipment",
    };
  }

  const { createReturnShipment } = await import("@/lib/admin/shipway-service");
  const shipwayResult = await createReturnShipment({
    order_id: ticketData.order_number || ticketData.ticket_number,
    ticket_number: ticketData.ticket_number,
    product_name: ticketData.product_name || "Warranty Product",
    product_sku: ticketData.product_sku || "PRODUCT",
    product_price: Number(ticketData.order_value ?? 0),
    order_total: Number(ticketData.order_value ?? 0),
    quantity: 1,
    customer_name: `${ticketData.first_name ?? ""} ${ticketData.last_name ?? ""}`.trim(),
    customer_email: ticketData.customer_email || "",
    customer_phone: ticketData.customer_phone || "",
    customer_address: parsed.address || ticketData.customer_address || "",
    customer_city: parsed.city,
    customer_state: parsed.state,
    customer_zipcode: parsed.pincode,
  });

  if (!shipwayResult.success || !shipwayResult.awb_number) {
    return {
      success: false,
      error: shipwayResult.success
        ? "Shipway accepted request but returned no AWB"
        : shipwayResult.error,
    };
  }

  const persisted = await persistReverseAwbOnly({
    ticketId,
    awbNumber: shipwayResult.awb_number,
    courierPartner: shipwayResult.courier_name || "Shipway",
  });

  if (!persisted.success) {
    return {
      success: false,
      error: `Shipway AWB ${shipwayResult.awb_number} created but DB save failed`,
      awb_number: shipwayResult.awb_number,
    };
  }

  return {
    success: true,
    awb_number: shipwayResult.awb_number,
    courier_name: shipwayResult.courier_name || "Shipway",
    shipping_url: shipwayResult.shipping_url || "",
  };
}

/** Mirrors ticket-details.php update_customer_info */
export async function updateCustomerInfo(
  ticketId: number,
  phone: string,
  address: string,
) {
  if (!ticketId) {
    return { success: false as const, error: "Invalid ticket id" };
  }

  try {
    await prisma.$executeRaw`
      UPDATE customers c
      JOIN orders o ON c.customer_id = o.customer_id
      SET c.phone = ${phone}, c.address = ${address}
      WHERE o.order_id = (
        SELECT order_id FROM warranty_tickets WHERE ticket_id = ${ticketId}
      )
    `;
    return { success: true as const };
  } catch (error) {
    console.error("updateCustomerInfo:", error);
    return { success: false as const, error: "Failed to update customer info" };
  }
}

/** Mirrors AdminController::addTicketComment */
export async function addTicketComment(
  ticketId: number,
  commentText: string,
  authorName: string,
  authorEmail: string,
  isInternal = false,
) {
  const commentType = isInternal ? "internal" : "customer";
  const internalFlag = isInternal ? 1 : 0;

  await prisma.$executeRaw`
    INSERT INTO ticket_comments (
      ticket_id, comment_type, comment_text, author_name, author_email, is_internal, created_at
    ) VALUES (
      ${ticketId}, ${commentType}, ${commentText}, ${authorName}, ${authorEmail}, ${internalFlag}, NOW()
    )
  `;

  return { success: true as const };
}
