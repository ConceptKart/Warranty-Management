/**
 * Replacement EAN + ticket type change (ports ticket-details.php / AdminController).
 */

import { prisma } from "@/lib/db";
import { getInventoryProductByEan } from "@/lib/baselinker/inventory";

export type ReplacementProductInfo = {
  success: boolean;
  error?: string;
  ticket?: Record<string, unknown>;
  original_product?: {
    product_name: string;
    product_sku: string;
    ean: string;
  };
  replacement_product?: {
    product_id: number;
    product_name: string | null;
    product_sku: string | null;
    ean: string | null;
  } | null;
};

export async function getReplacementProductInfo(
  ticketId: number,
): Promise<ReplacementProductInfo> {
  if (!ticketId) {
    return { success: false, error: "Ticket ID is required" };
  }

  const rows = await prisma.$queryRaw<
    Array<{
      ticket_id: number;
      ticket_number: string;
      baselinker_order_id: string | null;
      replacement_product_id: number | null;
      replacement_ean: string | null;
      product_name: string | null;
      product_sku: string | null;
      ean: string | null;
    }>
  >`
    SELECT
      wt.ticket_id,
      wt.ticket_number,
      o.baselinker_order_id,
      wt.replacement_product_id,
      wt.replacement_ean,
      p.product_name,
      p.product_sku,
      p.ean
    FROM warranty_tickets wt
    JOIN orders o ON wt.order_id = o.order_id
    LEFT JOIN products p ON wt.product_id = p.product_id
    WHERE wt.ticket_id = ${ticketId}
    LIMIT 1
  `;

  const ticketData = rows[0];
  if (!ticketData) {
    return { success: false, error: "Ticket not found" };
  }

  let replacementProduct: ReplacementProductInfo["replacement_product"] = null;
  if (ticketData.replacement_product_id) {
    const rp = await prisma.$queryRaw<
      Array<{
        product_id: number;
        product_name: string | null;
        product_sku: string | null;
        ean: string | null;
      }>
    >`
      SELECT product_id, product_name, product_sku, ean
      FROM products
      WHERE product_id = ${ticketData.replacement_product_id}
      LIMIT 1
    `;
    replacementProduct = rp[0] ?? null;
  }

  return {
    success: true,
    ticket: ticketData as unknown as Record<string, unknown>,
    original_product: {
      product_name: ticketData.product_name ?? "",
      product_sku: ticketData.product_sku ?? "",
      ean: ticketData.ean ?? "",
    },
    replacement_product: replacementProduct,
  };
}

export async function fetchProductByEan(ean: string): Promise<{
  success: boolean;
  error?: string;
  source?: "database" | "baselinker";
  product?: {
    product_id: number | string | null;
    variant_id: number | string | null;
    name: string;
    sku: string;
    ean: string;
    baselinker_product_id?: number | string | null;
  };
  message?: string;
}> {
  const trimmed = ean.trim();
  if (!trimmed) {
    return { success: false, error: "EAN is required" };
  }

  const local = await prisma.$queryRaw<
    Array<{
      product_id: number;
      product_name: string | null;
      product_sku: string | null;
      ean: string | null;
    }>
  >`
    SELECT product_id, product_name, product_sku, ean
    FROM products
    WHERE ean = ${trimmed}
    LIMIT 1
  `;

  let blProduct: Awaited<ReturnType<typeof getInventoryProductByEan>> = null;
  try {
    blProduct = await getInventoryProductByEan(trimmed);
  } catch {
    // Local DB match can still succeed without BaseLinker
    blProduct = null;
  }

  if (local[0]) {
    const blProductId = blProduct?.product_id ?? null;
    return {
      success: true,
      source: "database",
      product: {
        product_id: blProductId ?? local[0].product_id,
        variant_id: blProduct?.variant_id ?? null,
        name: local[0].product_name ?? "",
        sku: local[0].product_sku ?? "",
        ean: local[0].ean ?? trimmed,
        baselinker_product_id: blProductId,
      },
      message: "Product found in local database",
    };
  }

  if (blProduct) {
    return {
      success: true,
      source: "baselinker",
      product: {
        product_id: blProduct.product_id,
        variant_id: blProduct.variant_id ?? null,
        name: blProduct.name,
        sku: blProduct.sku,
        ean: blProduct.ean,
      },
      message: "Product found in BaseLinker inventory",
    };
  }

  return {
    success: false,
    error: `Product with EAN ${trimmed} not found in BaseLinker inventory`,
  };
}

export async function saveReplacementEan(input: {
  ticketId: number;
  ean: string;
  productId?: number | null;
  variantId?: number | null;
  warehouseId?: number | null;
  locationName?: string | null;
}): Promise<{
  success: boolean;
  error?: string;
  message?: string;
  ean?: string;
  product_id?: number | null;
  variant_id?: number | null;
}> {
  const ticketId = input.ticketId;
  const ean = input.ean.trim();
  if (!ticketId) return { success: false, error: "Ticket ID is required" };
  if (!ean) return { success: false, error: "EAN is required" };

  const productId = input.productId ?? null;
  const variantId = input.variantId ?? null;
  const warehouseId = input.warehouseId ?? null;
  const locationName = (input.locationName ?? "").trim() || null;

  try {
    await prisma.$executeRaw`
      UPDATE warranty_tickets
      SET replacement_ean = ${ean},
          replacement_product_id = ${productId},
          replacement_variant_id = ${variantId},
          replacement_warehouse_id = ${warehouseId},
          replacement_location = ${locationName},
          updated_at = NOW()
      WHERE ticket_id = ${ticketId}
    `;
    return {
      success: true,
      message: "Replacement product saved successfully",
      ean,
      product_id: productId,
      variant_id: variantId,
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : "Failed to save replacement EAN",
    };
  }
}

export async function lookupTicketByReplacementEan(ean: string): Promise<{
  success: boolean;
  error?: string;
  ticket?: Record<string, unknown>;
}> {
  const trimmed = ean.trim();
  if (!trimmed) return { success: false, error: "EAN is required" };

  const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT
      wt.ticket_id,
      wt.ticket_number,
      wt.replacement_ean,
      wt.replacement_location,
      wt.awb_number AS forward_awb,
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
    WHERE wt.replacement_ean = ${trimmed}
    LIMIT 1
  `;

  if (rows[0]) {
    return { success: true, ticket: rows[0] };
  }
  return {
    success: false,
    error: "No ticket found with that Replacement EAN",
  };
}

export async function changeTicketType(
  ticketId: number,
  newTypeId: number,
  changedBy: string,
): Promise<{
  success: boolean;
  error?: string;
  new_type_name?: string;
  new_claim_number?: string | null;
}> {
  if (!ticketId || !newTypeId) {
    return { success: false, error: "ticket_id and new_type_id are required" };
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const tickets = await tx.$queryRaw<
        Array<{
          ticket_type_id: number;
          status_id: number;
          claim_number: string | null;
          current_type_code: string;
        }>
      >`
        SELECT wt.ticket_type_id, wt.status_id, wt.claim_number,
               tt.type_code AS current_type_code
        FROM warranty_tickets wt
        JOIN ticket_types tt ON tt.ticket_type_id = wt.ticket_type_id
        WHERE wt.ticket_id = ${ticketId}
        LIMIT 1
      `;

      const ticket = tickets[0];
      if (!ticket) {
        return { success: false, error: "Ticket not found" };
      }

      if (Number(ticket.ticket_type_id) === Number(newTypeId)) {
        return { success: false, error: "Ticket is already this type" };
      }

      const newTypes = await tx.$queryRaw<
        Array<{ type_code: string; type_name: string }>
      >`
        SELECT type_code, type_name
        FROM ticket_types
        WHERE ticket_type_id = ${newTypeId} AND is_active = 1
        LIMIT 1
      `;
      const newType = newTypes[0];
      if (!newType) {
        return { success: false, error: "Invalid ticket type" };
      }

      const statusRows = await tx.$queryRaw<Array<{ status_id: number }>>`
        SELECT status_id FROM ticket_statuses
        WHERE ticket_type_id = ${newTypeId} AND is_active = 1
        ORDER BY sort_order ASC LIMIT 1
      `;
      const newStatusId = statusRows[0]?.status_id;
      if (!newStatusId) {
        return {
          success: false,
          error: "No statuses found for new ticket type",
        };
      }

      let newClaimNumber = ticket.claim_number;
      if (newClaimNumber) {
        const lastChar = newClaimNumber.slice(-1).toUpperCase();
        if (lastChar === "W" && newType.type_code === "replacement") {
          newClaimNumber = `${newClaimNumber.slice(0, -1)}R`;
        } else if (lastChar === "R" && newType.type_code === "warranty") {
          newClaimNumber = `${newClaimNumber.slice(0, -1)}W`;
        }
      }

      await tx.$executeRaw`
        UPDATE warranty_tickets
        SET ticket_type_id = ${newTypeId},
            status_id = ${newStatusId},
            claim_number = ${newClaimNumber},
            updated_at = NOW()
        WHERE ticket_id = ${ticketId}
      `;

      const note = `Ticket type changed from ${capitalize(ticket.current_type_code)} to ${capitalize(newType.type_code)}`;
      await tx.$executeRaw`
        INSERT INTO ticket_status_history
          (ticket_id, old_status_id, new_status_id, changed_by, change_reason, notes, changed_at)
        VALUES (
          ${ticketId},
          ${ticket.status_id},
          ${newStatusId},
          ${changedBy},
          ${"Type change"},
          ${note},
          NOW()
        )
      `;

      return {
        success: true,
        new_type_name: newType.type_name,
        new_claim_number: newClaimNumber,
      };
    });
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : "Failed to change ticket type",
    };
  }
}

function capitalize(s: string) {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}
