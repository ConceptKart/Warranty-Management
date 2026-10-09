import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { parseCustomerAddress, assignAwbToTicket } from "@/lib/admin/ticket-details";
import { createForwardShipment } from "@/lib/admin/shipway-service";
import {
  lookupAwbStatusesFromExternal,
  type AwbStatusResult,
} from "@/lib/admin/external-shipment-sync";

export type BulkForwardResultItem = {
  ticket_id: number;
  ticket_number: string;
  order_number?: string | null;
  product_name?: string | null;
  success: boolean;
  awb_number?: string;
  courier_name?: string;
  label_url?: string;
  replacement_ean?: string | null;
  replacement_location?: string | null;
  error?: string | null;
};

type BulkTicketRow = {
  ticket_id: number;
  ticket_number: string;
  awb_number: string | null;
  product_id: number | null;
  selected_products_json: string | null;
  replacement_ean: string | null;
  replacement_location: string | null;
  first_name: string | null;
  last_name: string | null;
  customer_email: string | null;
  customer_phone: string | null;
  customer_address: string | null;
  product_name: string | null;
  product_sku: string | null;
  order_number: string | null;
  order_value: unknown;
};

async function getBulkTicketData(ticketIds: number[]): Promise<BulkTicketRow[]> {
  if (ticketIds.length === 0) return [];
  const idList = Prisma.join(ticketIds);

  const rows = await prisma.$queryRaw<BulkTicketRow[]>`
    SELECT
      wt.ticket_id,
      wt.ticket_number,
      wt.awb_number,
      wt.product_id,
      wt.selected_products_json,
      wt.replacement_ean,
      wt.replacement_location,
      c.first_name,
      c.last_name,
      c.email AS customer_email,
      c.phone AS customer_phone,
      c.address AS customer_address,
      p.product_name,
      p.product_sku,
      COALESCE(wt.claim_number, o.order_number) AS order_number,
      o.order_value
    FROM warranty_tickets wt
    JOIN orders o ON wt.order_id = o.order_id
    JOIN customers c ON o.customer_id = c.customer_id
    LEFT JOIN products p ON wt.product_id = p.product_id
    WHERE wt.ticket_id IN (${idList})
  `;

  for (const row of rows) {
    try {
      const selected = JSON.parse(row.selected_products_json ?? "null") as Array<{
        name?: string;
        sku?: string;
        product_name?: string;
        product_sku?: string;
      }>;
      if (Array.isArray(selected) && selected[0]) {
        row.product_name =
          selected[0].product_name || selected[0].name || row.product_name;
        row.product_sku =
          selected[0].product_sku || selected[0].sku || row.product_sku;
      }
    } catch {
      /* ignore */
    }
  }

  return rows;
}

/** Port of tickets.php bulk_forward_shipment */
export async function bulkForwardShipments(
  ticketIds: number[],
  assignedBy: string,
): Promise<{ success: true; results: BulkForwardResultItem[] }> {
  const uniqueIds = [...new Set(ticketIds.filter((id) => id > 0))];
  const tickets = await getBulkTicketData(uniqueIds);
  const results: BulkForwardResultItem[] = [];

  for (const td of tickets) {
    const parsed = parseCustomerAddress(td.customer_address || "");
    if (!parsed.city.trim() || !parsed.state.trim() || !parsed.pincode.trim()) {
      results.push({
        ticket_id: td.ticket_id,
        ticket_number: td.ticket_number,
        success: false,
        error: `Could not parse address: ${td.customer_address || "(empty)"}`,
      });
      continue;
    }

    const shipwayResult = await createForwardShipment({
      order_id: `${td.order_number || td.ticket_number}P`,
      ticket_number: td.ticket_number,
      product_name: td.product_name || "Warranty Product",
      product_sku: td.product_sku || "PRODUCT",
      product_price: Number(td.order_value ?? 0),
      order_total: Number(td.order_value ?? 0),
      quantity: 1,
      customer_name: `${td.first_name ?? ""} ${td.last_name ?? ""}`.trim(),
      customer_email: td.customer_email || "",
      customer_phone: td.customer_phone || "",
      customer_address: td.customer_address || "",
      customer_city: parsed.city,
      customer_state: parsed.state,
      customer_zipcode: parsed.pincode,
    });

    if (!shipwayResult.success) {
      results.push({
        ticket_id: td.ticket_id,
        ticket_number: td.ticket_number,
        success: false,
        error: shipwayResult.error || "Shipway API error",
      });
      continue;
    }

    const awb = shipwayResult.awb_number || "";
    const courier = shipwayResult.courier_name || "Shipway";
    const labelUrl = shipwayResult.shipping_url || "";
    let dbError = "";

    if (awb) {
      const assignResult = await assignAwbToTicket({
        ticketId: td.ticket_id,
        awbNumber: awb,
        courierPartner: courier,
        shipmentType: "forward",
        assignedBy,
      });
      if (!assignResult.success) {
        dbError = `Shipway AWB created (${awb}) but DB save failed: ${assignResult.error}`;
      }
    }

    results.push({
      ticket_id: td.ticket_id,
      ticket_number: td.ticket_number,
      order_number: td.order_number,
      product_name: td.product_name,
      success: !dbError,
      awb_number: awb,
      courier_name: courier,
      label_url: labelUrl,
      replacement_ean: td.replacement_ean,
      replacement_location: td.replacement_location,
      error: dbError || null,
    });
  }

  // Include missing ticket IDs not found in DB
  const found = new Set(tickets.map((t) => t.ticket_id));
  for (const id of uniqueIds) {
    if (!found.has(id)) {
      results.push({
        ticket_id: id,
        ticket_number: String(id),
        success: false,
        error: "Ticket not found",
      });
    }
  }

  return { success: true, results };
}

export type PackerHandoverRow = {
  ticket_id: number;
  ticket_number: string;
  order_number: string | null;
  ticket_type: string | null;
  forward_awb: string | null;
  awb_created_at: Date | string | null;
  awb_created_by: string | null;
  replacement_ean: string | null;
  replacement_location: string | null;
  handed_over_to: string | null;
  handed_over_at: Date | string | null;
};

/** Port of AdminController::getTodaysForwardAwbOrders */
export async function getTodaysForwardAwbOrders(input: {
  awbFilter?: string;
  dateFrom?: string | null;
  dateTo?: string | null;
}): Promise<PackerHandoverRow[]> {
  const awbFilter = (input.awbFilter ?? "").trim();
  const dateFrom = input.dateFrom?.trim() || null;
  const dateTo = input.dateTo?.trim() || null;
  const dateMin = dateFrom ? `${dateFrom} 00:00:00` : null;
  const dateMax = dateTo ? `${dateTo} 23:59:59` : null;
  const awbLike = awbFilter ? `%${awbFilter}%` : null;

  // Use raw SQL matching PHP subquery structure
  const rows = await prisma.$queryRawUnsafe<PackerHandoverRow[]>(
    `
    SELECT
      ticket_id,
      ticket_number,
      order_number,
      ticket_type,
      forward_awb,
      awb_created_at,
      awb_created_by,
      replacement_ean,
      replacement_location,
      handed_over_to,
      handed_over_at
    FROM (
      SELECT
        wt.ticket_id,
        wt.ticket_number,
        COALESCE(wt.claim_number, o.order_number) AS order_number,
        tt.type_name AS ticket_type,
        COALESCE(
          (SELECT s_fwd.awb_number FROM shipments s_fwd
           WHERE s_fwd.ticket_id = wt.ticket_id AND s_fwd.shipment_type = 'forward'
           ORDER BY s_fwd.created_at ASC LIMIT 1),
          wt.awb_number
        ) AS forward_awb,
        COALESCE(
          (SELECT MIN(s_fwd.created_at) FROM shipments s_fwd
           WHERE s_fwd.ticket_id = wt.ticket_id AND s_fwd.shipment_type = 'forward'),
          wt.updated_at
        ) AS awb_created_at,
        (
          SELECT tsh.changed_by FROM ticket_status_history tsh
          WHERE tsh.ticket_id = wt.ticket_id
            AND tsh.change_reason = 'AWB Assignment'
          ORDER BY tsh.changed_at ASC LIMIT 1
        ) AS awb_created_by,
        wt.replacement_ean,
        wt.replacement_location,
        ph.handed_over_to,
        ph.handed_over_at
      FROM warranty_tickets wt
      JOIN orders o ON wt.order_id = o.order_id
      JOIN ticket_types tt ON wt.ticket_type_id = tt.ticket_type_id
      LEFT JOIN (
        SELECT ticket_id, handed_over_to, handed_over_at
        FROM packer_handovers
        WHERE (ticket_id, handed_over_at) IN (
          SELECT ticket_id, MAX(handed_over_at)
          FROM packer_handovers
          GROUP BY ticket_id
        )
      ) ph ON ph.ticket_id = wt.ticket_id
      WHERE
        COALESCE(
          (SELECT s_fwd.awb_number FROM shipments s_fwd
           WHERE s_fwd.ticket_id = wt.ticket_id AND s_fwd.shipment_type = 'forward'
           ORDER BY s_fwd.created_at ASC LIMIT 1),
          wt.awb_number
        ) IS NOT NULL
        AND COALESCE(
          (SELECT s_fwd.awb_number FROM shipments s_fwd
           WHERE s_fwd.ticket_id = wt.ticket_id AND s_fwd.shipment_type = 'forward'
           ORDER BY s_fwd.created_at ASC LIMIT 1),
          wt.awb_number
        ) != ''
    ) AS sub
    WHERE 1=1
      ${dateMin ? "AND awb_created_at >= ?" : ""}
      ${dateMax ? "AND awb_created_at <= ?" : ""}
      ${awbLike ? "AND forward_awb LIKE ?" : ""}
    ORDER BY awb_created_at DESC
    `,
    ...[
      ...(dateMin ? [dateMin] : []),
      ...(dateMax ? [dateMax] : []),
      ...(awbLike ? [awbLike] : []),
    ],
  );

  return rows;
}

/** Port of AdminController::markHandoverToPacker */
export async function markHandoverToPacker(input: {
  ticketId: number;
  awbNumber: string;
  packerName: string;
  adminUser: string;
}) {
  const ticketId = Number(input.ticketId);
  const awb = input.awbNumber.trim();
  const packer = input.packerName.trim();
  if (!ticketId || !awb || !packer) {
    return { success: false as const, error: "Missing parameters" };
  }

  try {
    await prisma.$executeRaw`
      INSERT INTO packer_handovers (ticket_id, awb_number, handed_over_to, handed_over_at, handed_over_by)
      VALUES (${ticketId}, ${awb}, ${packer}, NOW(), ${input.adminUser})
    `;
    return { success: true as const };
  } catch (error) {
    console.error("[markHandoverToPacker]", error);
    return { success: false as const, error: "Database error" };
  }
}

/**
 * Port of lookupAwbStatusesByTicketIds + get_awb_status.php
 */
export async function lookupAwbStatusesByTicketIds(
  ticketIds: number[],
): Promise<
  Record<number, { forward: AwbStatusResult | null; reverse: AwbStatusResult | null }>
> {
  const uniqueIds = [...new Set(ticketIds.filter((id) => id > 0))];
  const results: Record<
    number,
    { forward: AwbStatusResult | null; reverse: AwbStatusResult | null }
  > = {};
  for (const id of uniqueIds) {
    results[id] = { forward: null, reverse: null };
  }
  if (uniqueIds.length === 0) return results;

  const idList = Prisma.join(uniqueIds);
  const shipmentRows = await prisma.$queryRaw<
    Array<{
      ticket_id: number;
      awb_number: string;
      shipment_type: string | null;
    }>
  >`
    SELECT ticket_id, awb_number, shipment_type
    FROM shipments
    WHERE ticket_id IN (${idList})
      AND awb_number IS NOT NULL AND awb_number != ''
  `;

  const ticketRows = await prisma.$queryRaw<
    Array<{
      ticket_id: number;
      awb_number: string | null;
      reverse_awb_number: string | null;
    }>
  >`
    SELECT ticket_id, awb_number, reverse_awb_number
    FROM warranty_tickets
    WHERE ticket_id IN (${idList})
  `;

  const ticketAwbMap: Record<
    number,
    { forward: string | null; reverse: string | null }
  > = {};

  for (const t of ticketRows) {
    ticketAwbMap[t.ticket_id] = {
      forward: t.awb_number?.trim() || null,
      reverse: t.reverse_awb_number?.trim() || null,
    };
  }

  for (const s of shipmentRows) {
    const tid = s.ticket_id;
    if (!ticketAwbMap[tid]) {
      ticketAwbMap[tid] = { forward: null, reverse: null };
    }
    const type = s.shipment_type === "reverse" ? "reverse" : "forward";
    ticketAwbMap[tid]![type] = s.awb_number.trim();
  }

  const allAwbs = [
    ...new Set(
      Object.values(ticketAwbMap)
        .flatMap((m) => [m.forward, m.reverse])
        .filter((a): a is string => Boolean(a)),
    ),
  ];

  const awbStatuses =
    allAwbs.length > 0 ? await lookupAwbStatusesFromExternal(allAwbs) : {};

  for (const tid of uniqueIds) {
    const mapping = ticketAwbMap[tid];
    if (!mapping) continue;
    results[tid] = {
      forward: mapping.forward ? awbStatuses[mapping.forward] ?? null : null,
      reverse: mapping.reverse ? awbStatuses[mapping.reverse] ?? null : null,
    };
  }

  return results;
}
