import { prisma } from "@/lib/db";
import {
  asNumber,
  asString,
  serializeRow,
  serializeRows,
  sqlNullableString,
} from "@/lib/crud/http";

const ORDER_SELECT = `
  o.order_id, o.baselinker_order_id, o.order_number, o.customer_id,
  o.source_platform, o.order_value, o.order_status, o.order_date,
  o.delivery_date, o.warranty_start_date, o.warranty_end_date,
  o.replacement_end_date, o.created_at, o.updated_at,
  o.original_order_id, o.is_cloned_order, o.clone_reason, o.ticket_number,
  c.first_name, c.last_name,
  c.email AS customer_email, c.phone AS customer_phone
`;

export async function listOrders(page: number, limit: number, offset: number) {
  const [countRows, rows] = await Promise.all([
    prisma.$queryRaw<[{ c: bigint }]>`SELECT COUNT(*) AS c FROM orders`,
    prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT ${ORDER_SELECT}
       FROM orders o
       LEFT JOIN customers c ON c.customer_id = o.customer_id
       ORDER BY o.order_id DESC
       LIMIT ? OFFSET ?`,
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

export async function getOrderById(id: number) {
  const rows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
    `SELECT ${ORDER_SELECT}
     FROM orders o
     LEFT JOIN customers c ON c.customer_id = o.customer_id
     WHERE o.order_id = ?
     LIMIT 1`,
    id,
  );
  return rows[0] ? serializeRow(rows[0]) : null;
}

export async function createOrder(body: Record<string, unknown>) {
  const baselinkerOrderId = asString(body.baselinker_order_id)?.trim();
  const customerId = asNumber(body.customer_id);
  if (!baselinkerOrderId || !customerId) {
    return { error: "baselinker_order_id and customer_id are required." };
  }

  const orderDate =
    sqlNullableString(body.order_date) ??
    new Date().toISOString().slice(0, 19).replace("T", " ");

  await prisma.$executeRaw`
    INSERT INTO orders (
      baselinker_order_id, order_number, customer_id, source_platform,
      order_value, order_status, order_date, delivery_date,
      warranty_start_date, warranty_end_date, replacement_end_date,
      original_order_id, is_cloned_order, clone_reason, ticket_number, created_at
    ) VALUES (
      ${baselinkerOrderId},
      ${sqlNullableString(body.order_number)},
      ${customerId},
      ${sqlNullableString(body.source_platform)},
      ${asNumber(body.order_value)},
      ${sqlNullableString(body.order_status)},
      ${orderDate},
      ${sqlNullableString(body.delivery_date)},
      ${sqlNullableString(body.warranty_start_date)},
      ${sqlNullableString(body.warranty_end_date)},
      ${sqlNullableString(body.replacement_end_date)},
      ${sqlNullableString(body.original_order_id)},
      ${body.is_cloned_order ? 1 : 0},
      ${sqlNullableString(body.clone_reason)},
      ${sqlNullableString(body.ticket_number)},
      NOW()
    )
  `;

  const created = await prisma.$queryRaw<Array<{ order_id: number }>>`
    SELECT order_id FROM orders
    WHERE baselinker_order_id = ${baselinkerOrderId} AND customer_id = ${customerId}
    ORDER BY order_id DESC LIMIT 1
  `;
  const id = created[0]?.order_id;
  return { data: id ? await getOrderById(id) : null };
}

export async function updateOrder(body: Record<string, unknown>) {
  const id = asNumber(body.order_id ?? body.id);
  if (!id) return { error: "order_id is required." };
  const existing = await getOrderById(id);
  if (!existing) return { error: "Order not found." };

  await prisma.$executeRaw`
    UPDATE orders SET
      baselinker_order_id = COALESCE(${sqlNullableString(body.baselinker_order_id)}, baselinker_order_id),
      order_number = COALESCE(${sqlNullableString(body.order_number)}, order_number),
      customer_id = COALESCE(${asNumber(body.customer_id)}, customer_id),
      source_platform = COALESCE(${sqlNullableString(body.source_platform)}, source_platform),
      order_value = COALESCE(${asNumber(body.order_value)}, order_value),
      order_status = COALESCE(${sqlNullableString(body.order_status)}, order_status),
      order_date = COALESCE(${sqlNullableString(body.order_date)}, order_date),
      delivery_date = COALESCE(${sqlNullableString(body.delivery_date)}, delivery_date),
      warranty_start_date = COALESCE(${sqlNullableString(body.warranty_start_date)}, warranty_start_date),
      warranty_end_date = COALESCE(${sqlNullableString(body.warranty_end_date)}, warranty_end_date),
      replacement_end_date = COALESCE(${sqlNullableString(body.replacement_end_date)}, replacement_end_date),
      original_order_id = COALESCE(${sqlNullableString(body.original_order_id)}, original_order_id),
      clone_reason = COALESCE(${sqlNullableString(body.clone_reason)}, clone_reason),
      ticket_number = COALESCE(${sqlNullableString(body.ticket_number)}, ticket_number),
      updated_at = NOW()
    WHERE order_id = ${id}
  `;
  return { data: await getOrderById(id) };
}

export async function deleteOrder(id: number) {
  if (!id) return { error: "order_id is required." };
  const existing = await getOrderById(id);
  if (!existing) return { error: "Order not found." };
  await prisma.$executeRaw`DELETE FROM orders WHERE order_id = ${id}`;
  return { data: { deleted: true, order_id: id } };
}
