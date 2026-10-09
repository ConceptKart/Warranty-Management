import { prisma } from "@/lib/db";
import {
  asNumber,
  asString,
  serializeRow,
  serializeRows,
  sqlNullableString,
} from "@/lib/crud/http";

const SHIPMENT_COLS = `
  shipment_id, ticket_id, awb_number, courier_partner, shipment_type,
  pickup_address, delivery_address, shipment_status, estimated_delivery,
  actual_delivery, weight_kg, dimensions, declared_value, cod_amount,
  shipway_order_id, tracking_url, created_at, updated_at
`;

export async function listShipments(page: number, limit: number, offset: number) {
  const [countRows, rows] = await Promise.all([
    prisma.$queryRaw<[{ c: bigint }]>`SELECT COUNT(*) AS c FROM shipments`,
    prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT ${SHIPMENT_COLS} FROM shipments
       ORDER BY shipment_id DESC LIMIT ? OFFSET ?`,
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

export async function getShipmentById(id: number) {
  const rows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
    `SELECT ${SHIPMENT_COLS} FROM shipments WHERE shipment_id = ? LIMIT 1`,
    id,
  );
  return rows[0] ? serializeRow(rows[0]) : null;
}

export async function getShipmentByAwb(awb: string) {
  const rows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
    `SELECT ${SHIPMENT_COLS} FROM shipments WHERE awb_number = ? LIMIT 1`,
    awb,
  );
  return rows[0] ? serializeRow(rows[0]) : null;
}

export async function createShipment(body: Record<string, unknown>) {
  const ticketId = asNumber(body.ticket_id);
  const awb = asString(body.awb_number)?.trim();
  const courier = asString(body.courier_partner)?.trim();
  const delivery = asString(body.delivery_address);
  if (!ticketId || !awb || !courier || delivery == null || delivery === "") {
    return {
      error:
        "ticket_id, awb_number, courier_partner, and delivery_address are required.",
    };
  }

  await prisma.$executeRaw`
    INSERT INTO shipments (
      ticket_id, awb_number, courier_partner, shipment_type,
      pickup_address, delivery_address, shipment_status,
      estimated_delivery, actual_delivery, weight_kg, dimensions,
      declared_value, cod_amount, shipway_order_id, tracking_url, created_at
    ) VALUES (
      ${ticketId},
      ${awb},
      ${courier},
      ${sqlNullableString(body.shipment_type) ?? "forward"},
      ${sqlNullableString(body.pickup_address)},
      ${delivery},
      ${sqlNullableString(body.shipment_status) ?? "created"},
      ${sqlNullableString(body.estimated_delivery)},
      ${sqlNullableString(body.actual_delivery)},
      ${asNumber(body.weight_kg)},
      ${sqlNullableString(body.dimensions)},
      ${asNumber(body.declared_value)},
      ${asNumber(body.cod_amount) ?? 0},
      ${sqlNullableString(body.shipway_order_id)},
      ${sqlNullableString(body.tracking_url)},
      NOW()
    )
  `;

  const created = await prisma.$queryRaw<Array<{ shipment_id: number }>>`
    SELECT shipment_id FROM shipments
    WHERE awb_number = ${awb} AND ticket_id = ${ticketId}
    ORDER BY shipment_id DESC LIMIT 1
  `;
  const id = created[0]?.shipment_id;
  return { data: id ? await getShipmentById(id) : null };
}

export async function updateShipment(body: Record<string, unknown>) {
  const id = asNumber(body.shipment_id ?? body.id);
  if (!id) return { error: "shipment_id is required." };
  const existing = await getShipmentById(id);
  if (!existing) return { error: "Shipment not found." };

  await prisma.$executeRaw`
    UPDATE shipments SET
      ticket_id = COALESCE(${asNumber(body.ticket_id)}, ticket_id),
      awb_number = COALESCE(${sqlNullableString(body.awb_number)}, awb_number),
      courier_partner = COALESCE(${sqlNullableString(body.courier_partner)}, courier_partner),
      shipment_type = COALESCE(${sqlNullableString(body.shipment_type)}, shipment_type),
      pickup_address = COALESCE(${sqlNullableString(body.pickup_address)}, pickup_address),
      delivery_address = COALESCE(${sqlNullableString(body.delivery_address)}, delivery_address),
      shipment_status = COALESCE(${sqlNullableString(body.shipment_status)}, shipment_status),
      estimated_delivery = COALESCE(${sqlNullableString(body.estimated_delivery)}, estimated_delivery),
      actual_delivery = COALESCE(${sqlNullableString(body.actual_delivery)}, actual_delivery),
      weight_kg = COALESCE(${asNumber(body.weight_kg)}, weight_kg),
      dimensions = COALESCE(${sqlNullableString(body.dimensions)}, dimensions),
      declared_value = COALESCE(${asNumber(body.declared_value)}, declared_value),
      cod_amount = COALESCE(${asNumber(body.cod_amount)}, cod_amount),
      shipway_order_id = COALESCE(${sqlNullableString(body.shipway_order_id)}, shipway_order_id),
      tracking_url = COALESCE(${sqlNullableString(body.tracking_url)}, tracking_url),
      updated_at = NOW()
    WHERE shipment_id = ${id}
  `;
  return { data: await getShipmentById(id) };
}

export async function deleteShipment(id: number) {
  if (!id) return { error: "shipment_id is required." };
  const existing = await getShipmentById(id);
  if (!existing) return { error: "Shipment not found." };
  await prisma.$executeRaw`DELETE FROM shipments WHERE shipment_id = ${id}`;
  return { data: { deleted: true, shipment_id: id } };
}
