import { prisma } from "@/lib/db";
import {
  asNumber,
  asString,
  serializeRow,
  serializeRows,
  sqlNullableString,
} from "@/lib/crud/http";

/** Writable columns for baseorders (Hostinger mirror of BaseLinker orders). */
const WRITABLE = [
  "order_id",
  "shop_order_id",
  "external_order_id",
  "order_source",
  "order_source_id",
  "order_source_info",
  "order_status_id",
  "order_page",
  "confirmed",
  "date_add",
  "date_confirmed",
  "date_in_status",
  "user_login",
  "phone",
  "email",
  "user_comments",
  "admin_comments",
  "currency",
  "payment_method",
  "payment_method_cod",
  "payment_done",
  "want_invoice",
  "delivery_method_id",
  "delivery_method",
  "delivery_price",
  "delivery_package_module",
  "delivery_package_nr",
  "delivery_fullname",
  "delivery_company",
  "delivery_address",
  "delivery_city",
  "delivery_state",
  "delivery_postcode",
  "delivery_country",
  "delivery_country_code",
  "delivery_point_id",
  "delivery_point_name",
  "delivery_point_address",
  "delivery_point_postcode",
  "delivery_point_city",
  "invoice_fullname",
  "invoice_company",
  "invoice_nip",
  "invoice_address",
  "invoice_city",
  "invoice_state",
  "invoice_postcode",
  "invoice_country",
  "invoice_country_code",
  "extra_field_1",
  "extra_field_2",
  "pick_state",
  "pack_state",
  "products",
] as const;

function tableExistsError(err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes("baseorders") && msg.includes("doesn't exist");
}

export async function listBaseorders(
  page: number,
  limit: number,
  offset: number,
): Promise<{
  totalRecords: number;
  data: Record<string, unknown>[];
  page: number;
  limit: number;
  error?: string;
}> {
  try {
    const [countRows, rows] = await Promise.all([
      prisma.$queryRaw<[{ c: bigint }]>`SELECT COUNT(*) AS c FROM baseorders`,
      prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
        `SELECT * FROM baseorders ORDER BY id DESC LIMIT ? OFFSET ?`,
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
  } catch (err) {
    if (tableExistsError(err)) {
      return {
        totalRecords: 0,
        data: [],
        page,
        limit,
        error:
          "baseorders table not found in this database. Import/sync the Hostinger baseorders mirror first.",
      };
    }
    throw err;
  }
}

export async function getBaseorderById(id: number) {
  try {
    const rows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT * FROM baseorders WHERE id = ? LIMIT 1`,
      id,
    );
    return rows[0] ? serializeRow(rows[0]) : null;
  } catch (err) {
    if (tableExistsError(err)) return null;
    throw err;
  }
}

export async function createBaseorder(body: Record<string, unknown>) {
  const orderId = asNumber(body.order_id);
  if (!orderId) return { error: "order_id is required." };

  const cols: string[] = ["order_id"];
  const vals: unknown[] = [orderId];

  for (const key of WRITABLE) {
    if (key === "order_id") continue;
    if (body[key] === undefined) continue;
    cols.push(key);
    if (key === "products" && body[key] != null && typeof body[key] !== "string") {
      vals.push(JSON.stringify(body[key]));
    } else {
      vals.push(body[key]);
    }
  }

  const placeholders = cols.map(() => "?").join(", ");
  try {
    await prisma.$executeRawUnsafe(
      `INSERT INTO baseorders (${cols.join(", ")}) VALUES (${placeholders})`,
      ...vals,
    );
    const created = await prisma.$queryRawUnsafe<Array<{ id: number }>>(
      `SELECT id FROM baseorders WHERE order_id = ? ORDER BY id DESC LIMIT 1`,
      orderId,
    );
    const id = created[0]?.id;
    return { data: id ? await getBaseorderById(id) : null };
  } catch (err) {
    if (tableExistsError(err)) {
      return {
        error:
          "baseorders table not found in this database. Import/sync the Hostinger baseorders mirror first.",
      };
    }
    const msg = err instanceof Error ? err.message : "Insert failed";
    return { error: msg };
  }
}

export async function updateBaseorder(body: Record<string, unknown>) {
  const id = asNumber(body.id);
  if (!id) return { error: "id is required." };

  const sets: string[] = [];
  const vals: unknown[] = [];
  for (const key of WRITABLE) {
    if (body[key] === undefined) continue;
    sets.push(`${key} = ?`);
    if (key === "products" && body[key] != null && typeof body[key] !== "string") {
      vals.push(JSON.stringify(body[key]));
    } else if (typeof body[key] === "string") {
      vals.push(sqlNullableString(body[key]));
    } else {
      vals.push(body[key]);
    }
  }
  if (!sets.length) return { error: "No fields to update." };

  vals.push(id);
  try {
    const existing = await getBaseorderById(id);
    if (!existing) return { error: "Baseorder not found." };
    await prisma.$executeRawUnsafe(
      `UPDATE baseorders SET ${sets.join(", ")} WHERE id = ?`,
      ...vals,
    );
    return { data: await getBaseorderById(id) };
  } catch (err) {
    if (tableExistsError(err)) {
      return {
        error:
          "baseorders table not found in this database. Import/sync the Hostinger baseorders mirror first.",
      };
    }
    throw err;
  }
}

export async function deleteBaseorder(id: number) {
  if (!id) return { error: "id is required." };
  try {
    const existing = await getBaseorderById(id);
    if (!existing) return { error: "Baseorder not found." };
    await prisma.$executeRaw`DELETE FROM baseorders WHERE id = ${id}`;
    return { data: { deleted: true, id } };
  } catch (err) {
    if (tableExistsError(err)) {
      return {
        error:
          "baseorders table not found in this database. Import/sync the Hostinger baseorders mirror first.",
      };
    }
    throw err;
  }
}

export async function getBaseorderByExternal(externalOrderId: string) {
  const ext = asString(externalOrderId)?.trim();
  if (!ext) return null;
  try {
    const rows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT * FROM baseorders
       WHERE external_order_id = ? OR shop_order_id = ? OR CAST(order_id AS CHAR) = ?
       ORDER BY id DESC LIMIT 1`,
      ext,
      ext,
      ext,
    );
    return rows[0] ? serializeRow(rows[0]) : null;
  } catch {
    return null;
  }
}
