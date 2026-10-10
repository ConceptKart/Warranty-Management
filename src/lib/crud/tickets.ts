import { prisma } from "@/lib/db";
import {
  asNumber,
  asString,
  serializeRow,
  serializeRows,
  sqlNullableString,
} from "@/lib/crud/http";

const TICKET_COLS = `
  wt.ticket_id, wt.ticket_number, wt.order_id, wt.claim_number, wt.product_id,
  wt.selected_products_json, wt.product_quantity, wt.ticket_type_id, wt.issue_type_id,
  wt.status_id, wt.customer_description, wt.internal_notes, wt.resolution_details,
  wt.ticket_date, wt.resolution_date, wt.priority, wt.assigned_to, wt.tracking_number,
  wt.awb_number, wt.reverse_awb_number, wt.courier_partner, wt.shipment_status,
  wt.created_at, wt.updated_at, wt.baselinker_integrated, wt.cloned_from_order_id,
  wt.replacement_ean, wt.replacement_product_id, wt.replacement_variant_id,
  wt.replacement_warehouse_id, wt.replacement_location, wt.source_device,
  o.order_number, o.source_platform, o.customer_id,
  c.first_name, c.last_name,
  c.email AS customer_email, c.phone AS customer_phone
`;

const TICKET_FROM = `
  FROM warranty_tickets wt
  LEFT JOIN orders o ON o.order_id = wt.order_id
  LEFT JOIN customers c ON c.customer_id = o.customer_id
`;

async function generateTicketNumber(ticketTypeId: number): Promise<string> {
  let prefix = "WR";
  const typeRows = await prisma.$queryRaw<Array<{ type_code: string | null }>>`
    SELECT type_code FROM ticket_types WHERE ticket_type_id = ${ticketTypeId}
  `;
  const typeCode = typeRows[0]?.type_code ?? "";
  if (typeCode === "replacement") prefix = "RP";
  else if (typeCode === "warranty") prefix = "WR";
  else if (typeCode) prefix = "TK";

  const now = new Date();
  const yearMonth = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
  const like = `${prefix}${yearMonth}%`;
  const offset = prefix.length + yearMonth.length + 1;

  const rows = await prisma.$queryRaw<Array<{ max_seq: bigint | number | null }>>`
    SELECT COALESCE(MAX(CAST(SUBSTRING(ticket_number, ${offset}) AS UNSIGNED)), 0) AS max_seq
    FROM warranty_tickets
    WHERE ticket_number LIKE ${like}
  `;
  const next = Number(rows[0]?.max_seq ?? 0) + 1;
  return `${prefix}${yearMonth}${String(next).padStart(4, "0")}`;
}

export async function listTickets(
  page: number,
  limit: number,
  offset: number,
  search?: string | null,
) {
  const term = search?.trim();
  if (term) {
    const like = `%${term}%`;
    const [countRows, rows] = await Promise.all([
      prisma.$queryRaw<[{ c: bigint }]>`
        SELECT COUNT(*) AS c FROM warranty_tickets wt
        LEFT JOIN orders o ON o.order_id = wt.order_id
        LEFT JOIN customers c ON c.customer_id = o.customer_id
        WHERE wt.ticket_number LIKE ${like}
           OR wt.claim_number LIKE ${like}
           OR wt.awb_number LIKE ${like}
           OR wt.reverse_awb_number LIKE ${like}
           OR CAST(wt.ticket_id AS CHAR) = ${term}
           OR c.phone LIKE ${like}
      `,
      prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
        `SELECT ${TICKET_COLS} ${TICKET_FROM}
         WHERE wt.ticket_number LIKE ?
            OR wt.claim_number LIKE ?
            OR wt.awb_number LIKE ?
            OR wt.reverse_awb_number LIKE ?
            OR CAST(wt.ticket_id AS CHAR) = ?
            OR c.phone LIKE ?
         ORDER BY wt.ticket_id DESC
         LIMIT ? OFFSET ?`,
        like,
        like,
        like,
        like,
        term,
        like,
        limit,
        offset,
      ),
    ]);
    return {
      totalRecords: Number(countRows[0]?.c ?? 0),
      data: serializeRows(rows),
      page,
      limit,
    };
  }

  const [countRows, rows] = await Promise.all([
    prisma.$queryRaw<[{ c: bigint }]>`SELECT COUNT(*) AS c FROM warranty_tickets`,
    prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT ${TICKET_COLS} ${TICKET_FROM}
       ORDER BY wt.ticket_id DESC LIMIT ? OFFSET ?`,
      limit,
      offset,
    ),
  ]);
  return {
    totalRecords: Number(countRows[0]?.c ?? 0),
    data: serializeRows(rows),
    page,
    limit,
  };
}

export async function getTicketById(id: number) {
  const rows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
    `SELECT ${TICKET_COLS} ${TICKET_FROM} WHERE wt.ticket_id = ? LIMIT 1`,
    id,
  );
  return rows[0] ? serializeRow(rows[0]) : null;
}

export async function createTicket(body: Record<string, unknown>) {
  const orderId = asNumber(body.order_id);
  const productId = asNumber(body.product_id);
  const customerDescription = asString(body.customer_description)?.trim();
  if (!orderId || !productId || !customerDescription) {
    return {
      error:
        "Mandatory fields missing: order_id, product_id, customer_description are required.",
    };
  }

  const ticketTypeId = asNumber(body.ticket_type_id) ?? 1;
  const issueTypeId = asNumber(body.issue_type_id) ?? 1;
  let statusId = asNumber(body.status_id);
  if (!statusId) {
    const statusRows = await prisma.$queryRaw<Array<{ status_id: number }>>`
      SELECT status_id FROM ticket_statuses
      WHERE ticket_type_id = ${ticketTypeId} AND is_active = 1
      ORDER BY sort_order ASC LIMIT 1
    `;
    statusId = statusRows[0]?.status_id ?? 1;
  }

  const ticketNumber =
    asString(body.ticket_number)?.trim() ||
    (await generateTicketNumber(ticketTypeId));

  const selectedJson =
    body.selected_products_json == null
      ? null
      : typeof body.selected_products_json === "string"
        ? body.selected_products_json
        : JSON.stringify(body.selected_products_json);

  await prisma.$executeRaw`
    INSERT INTO warranty_tickets (
      ticket_number, order_id, claim_number, product_id, selected_products_json,
      product_quantity, ticket_type_id, issue_type_id, status_id,
      customer_description, internal_notes, resolution_details, priority,
      assigned_to, tracking_number, awb_number, reverse_awb_number,
      courier_partner, shipment_status, source_device, created_at
    ) VALUES (
      ${ticketNumber},
      ${orderId},
      ${sqlNullableString(body.claim_number)},
      ${productId},
      ${selectedJson},
      ${asNumber(body.product_quantity) ?? 1},
      ${ticketTypeId},
      ${issueTypeId},
      ${statusId},
      ${customerDescription},
      ${sqlNullableString(body.internal_notes)},
      ${sqlNullableString(body.resolution_details)},
      ${sqlNullableString(body.priority) ?? "medium"},
      ${sqlNullableString(body.assigned_to)},
      ${sqlNullableString(body.tracking_number)},
      ${sqlNullableString(body.awb_number)},
      ${sqlNullableString(body.reverse_awb_number)},
      ${sqlNullableString(body.courier_partner)},
      ${sqlNullableString(body.shipment_status) ?? "pending"},
      ${sqlNullableString(body.source_device)},
      NOW()
    )
  `;

  const created = await prisma.$queryRaw<Array<{ ticket_id: number }>>`
    SELECT ticket_id FROM warranty_tickets
    WHERE ticket_number = ${ticketNumber} LIMIT 1
  `;
  const id = created[0]?.ticket_id;
  return { data: id ? await getTicketById(id) : null };
}

export async function updateTicket(body: Record<string, unknown>) {
  const id = asNumber(body.ticket_id ?? body.id);
  if (!id) return { error: "ticket_id is required." };
  const existing = await getTicketById(id);
  if (!existing) return { error: "Ticket not found." };

  const selectedJson =
    body.selected_products_json === undefined
      ? undefined
      : typeof body.selected_products_json === "string"
        ? body.selected_products_json
        : JSON.stringify(body.selected_products_json);

  await prisma.$executeRaw`
    UPDATE warranty_tickets SET
      claim_number = COALESCE(${sqlNullableString(body.claim_number)}, claim_number),
      product_id = COALESCE(${asNumber(body.product_id)}, product_id),
      selected_products_json = COALESCE(${selectedJson ?? null}, selected_products_json),
      product_quantity = COALESCE(${asNumber(body.product_quantity)}, product_quantity),
      ticket_type_id = COALESCE(${asNumber(body.ticket_type_id)}, ticket_type_id),
      issue_type_id = COALESCE(${asNumber(body.issue_type_id)}, issue_type_id),
      status_id = COALESCE(${asNumber(body.status_id)}, status_id),
      customer_description = COALESCE(${sqlNullableString(body.customer_description)}, customer_description),
      internal_notes = COALESCE(${sqlNullableString(body.internal_notes)}, internal_notes),
      resolution_details = COALESCE(${sqlNullableString(body.resolution_details)}, resolution_details),
      priority = COALESCE(${sqlNullableString(body.priority)}, priority),
      assigned_to = COALESCE(${sqlNullableString(body.assigned_to)}, assigned_to),
      tracking_number = COALESCE(${sqlNullableString(body.tracking_number)}, tracking_number),
      awb_number = COALESCE(${sqlNullableString(body.awb_number)}, awb_number),
      reverse_awb_number = COALESCE(${sqlNullableString(body.reverse_awb_number)}, reverse_awb_number),
      courier_partner = COALESCE(${sqlNullableString(body.courier_partner)}, courier_partner),
      shipment_status = COALESCE(${sqlNullableString(body.shipment_status)}, shipment_status),
      replacement_ean = COALESCE(${sqlNullableString(body.replacement_ean)}, replacement_ean),
      resolution_date = COALESCE(${sqlNullableString(body.resolution_date)}, resolution_date),
      updated_at = NOW()
    WHERE ticket_id = ${id}
  `;
  return { data: await getTicketById(id) };
}

export async function deleteTicket(id: number) {
  if (!id) return { error: "ticket_id is required." };
  const existing = await getTicketById(id);
  if (!existing) return { error: "Ticket not found." };
  await prisma.$executeRaw`DELETE FROM warranty_tickets WHERE ticket_id = ${id}`;
  return { data: { deleted: true, ticket_id: id } };
}
