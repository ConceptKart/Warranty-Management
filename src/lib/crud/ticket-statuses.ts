import { prisma } from "@/lib/db";
import {
  asNumber,
  serializeRow,
  serializeRows,
  sqlNullableString,
} from "@/lib/crud/http";

export async function listTicketStatuses() {
  const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT status_id, status_name, status_code, status_color,
           is_final, is_active, ticket_type_id, sort_order, created_at
    FROM ticket_statuses
    ORDER BY sort_order ASC, status_id ASC
  `;
  return serializeRows(rows);
}

export async function getTicketStatusById(id: number) {
  const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT status_id, status_name, status_code, status_color,
           is_final, is_active, ticket_type_id, sort_order, created_at
    FROM ticket_statuses
    WHERE status_id = ${id}
    LIMIT 1
  `;
  return rows[0] ? serializeRow(rows[0]) : null;
}

export async function createTicketStatus(body: Record<string, unknown>) {
  const statusName = sqlNullableString(body.status_name);
  const statusCode = sqlNullableString(body.status_code);
  const ticketTypeId = asNumber(body.ticket_type_id);
  if (!statusName || !statusCode || !ticketTypeId) {
    return {
      error: "status_name, status_code, and ticket_type_id are required.",
    };
  }

  const sortOrder = asNumber(body.sort_order) ?? 0;
  await prisma.$executeRaw`
    INSERT INTO ticket_statuses (
      status_name, status_code, ticket_type_id, sort_order,
      is_final, is_active, status_color, created_at
    ) VALUES (
      ${statusName},
      ${statusCode},
      ${ticketTypeId},
      ${sortOrder},
      ${body.is_final ? 1 : 0},
      ${body.is_active === false || body.is_active === 0 ? 0 : 1},
      ${sqlNullableString(body.status_color) ?? "#007bff"},
      NOW()
    )
  `;

  const created = await prisma.$queryRaw<Array<{ status_id: number }>>`
    SELECT status_id FROM ticket_statuses
    WHERE status_code = ${statusCode} AND ticket_type_id = ${ticketTypeId}
    ORDER BY status_id DESC LIMIT 1
  `;
  const id = created[0]?.status_id;
  return { data: id ? await getTicketStatusById(id) : null };
}

export async function updateTicketStatus(body: Record<string, unknown>) {
  const id = asNumber(body.status_id ?? body.id);
  if (!id) return { error: "status_id is required." };
  const existing = await getTicketStatusById(id);
  if (!existing) return { error: "Status not found." };

  await prisma.$executeRaw`
    UPDATE ticket_statuses SET
      status_name = COALESCE(${sqlNullableString(body.status_name)}, status_name),
      status_code = COALESCE(${sqlNullableString(body.status_code)}, status_code),
      ticket_type_id = COALESCE(${asNumber(body.ticket_type_id)}, ticket_type_id),
      sort_order = COALESCE(${asNumber(body.sort_order)}, sort_order),
      is_final = COALESCE(${
        body.is_final === undefined
          ? null
          : body.is_final
            ? 1
            : 0
      }, is_final),
      is_active = COALESCE(${
        body.is_active === undefined
          ? null
          : body.is_active === false || body.is_active === 0
            ? 0
            : 1
      }, is_active),
      status_color = COALESCE(${sqlNullableString(body.status_color)}, status_color)
    WHERE status_id = ${id}
  `;
  return { data: await getTicketStatusById(id) };
}

export async function deleteTicketStatus(id: number) {
  if (!id) return { error: "status_id is required." };
  const existing = await getTicketStatusById(id);
  if (!existing) return { error: "Status not found." };
  await prisma.$executeRaw`DELETE FROM ticket_statuses WHERE status_id = ${id}`;
  return { data: { deleted: true, status_id: id } };
}
