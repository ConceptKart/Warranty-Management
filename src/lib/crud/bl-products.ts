import { prisma } from "@/lib/db";
import {
  asNumber,
  asString,
  serializeRow,
  serializeRows,
  sqlNullableString,
} from "@/lib/crud/http";

/**
 * Live Hostinger bl_products has product_id, inventory_id, parent_id, etc.
 * Local schema.sql is slimmer — queries tolerate missing optional columns
 * by selecting core fields first and expanding when present.
 */
const SELECT_FULL = `
  id, product_id, parent_id, sku, ean, category_id, category_name,
  product_name, is_variant, inventory_id, synced_at, warranty
`;

const SELECT_SLIM = `
  id, sku, ean, category_id, category_name, product_name, warranty,
  created_at, updated_at
`;

let useFullColumns: boolean | null = null;

async function detectColumns(): Promise<boolean> {
  if (useFullColumns != null) return useFullColumns;
  try {
    await prisma.$queryRawUnsafe(`SELECT product_id, inventory_id FROM bl_products LIMIT 1`);
    useFullColumns = true;
  } catch {
    useFullColumns = false;
  }
  return useFullColumns;
}

function selectSql(full: boolean) {
  return full ? SELECT_FULL : SELECT_SLIM;
}

export async function listBlProducts(
  page: number,
  limit: number,
  offset: number,
) {
  const full = await detectColumns();
  const [countRows, rows] = await Promise.all([
    prisma.$queryRaw<[{ c: bigint }]>`SELECT COUNT(*) AS c FROM bl_products`,
    prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT ${selectSql(full)} FROM bl_products
       ORDER BY id DESC LIMIT ? OFFSET ?`,
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

export async function getBlProductById(id: number) {
  const full = await detectColumns();
  const rows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
    `SELECT ${selectSql(full)} FROM bl_products WHERE id = ? LIMIT 1`,
    id,
  );
  return rows[0] ? serializeRow(rows[0]) : null;
}

export async function createBlProduct(body: Record<string, unknown>) {
  const full = await detectColumns();
  const productId = asNumber(body.product_id);
  const inventoryId = asNumber(body.inventory_id);

  if (full && (!productId || !inventoryId)) {
    return { error: "product_id and inventory_id are required." };
  }
  if (!full) {
    const sku = asString(body.sku)?.trim();
    if (!sku && !asString(body.product_name)?.trim()) {
      return { error: "sku or product_name is required." };
    }
  }

  if (full) {
    await prisma.$executeRaw`
      INSERT INTO bl_products (
        product_id, parent_id, sku, ean, category_id, category_name,
        product_name, is_variant, inventory_id, synced_at, warranty
      ) VALUES (
        ${productId},
        ${asNumber(body.parent_id) ?? 0},
        ${sqlNullableString(body.sku)},
        ${sqlNullableString(body.ean)},
        ${asNumber(body.category_id)},
        ${sqlNullableString(body.category_name)},
        ${sqlNullableString(body.product_name)},
        ${body.is_variant ? 1 : 0},
        ${inventoryId},
        NOW(),
        ${sqlNullableString(body.warranty)}
      )
    `;
    const created = await prisma.$queryRaw<Array<{ id: number }>>`
      SELECT id FROM bl_products
      WHERE product_id = ${productId} AND inventory_id = ${inventoryId}
      ORDER BY id DESC LIMIT 1
    `;
    const id = created[0]?.id;
    return { data: id ? await getBlProductById(id) : null };
  }

  await prisma.$executeRaw`
    INSERT INTO bl_products (
      sku, product_name, ean, warranty, category_id, category_name, created_at
    ) VALUES (
      ${sqlNullableString(body.sku)},
      ${sqlNullableString(body.product_name)},
      ${sqlNullableString(body.ean)},
      ${sqlNullableString(body.warranty)},
      ${asNumber(body.category_id)},
      ${sqlNullableString(body.category_name)},
      NOW()
    )
  `;
  const created = await prisma.$queryRaw<Array<{ id: number }>>`
    SELECT id FROM bl_products ORDER BY id DESC LIMIT 1
  `;
  const id = created[0]?.id;
  return { data: id ? await getBlProductById(id) : null };
}

export async function updateBlProduct(body: Record<string, unknown>) {
  const id = asNumber(body.id);
  if (!id) return { error: "id is required." };
  const existing = await getBlProductById(id);
  if (!existing) return { error: "Product not found." };

  const full = await detectColumns();
  if (full) {
    await prisma.$executeRaw`
      UPDATE bl_products SET
        product_id = COALESCE(${asNumber(body.product_id)}, product_id),
        parent_id = COALESCE(${asNumber(body.parent_id)}, parent_id),
        sku = COALESCE(${sqlNullableString(body.sku)}, sku),
        ean = COALESCE(${sqlNullableString(body.ean)}, ean),
        category_id = COALESCE(${asNumber(body.category_id)}, category_id),
        category_name = COALESCE(${sqlNullableString(body.category_name)}, category_name),
        product_name = COALESCE(${sqlNullableString(body.product_name)}, product_name),
        is_variant = COALESCE(${
          body.is_variant === undefined ? null : body.is_variant ? 1 : 0
        }, is_variant),
        inventory_id = COALESCE(${asNumber(body.inventory_id)}, inventory_id),
        warranty = COALESCE(${sqlNullableString(body.warranty)}, warranty),
        synced_at = NOW()
      WHERE id = ${id}
    `;
  } else {
    await prisma.$executeRaw`
      UPDATE bl_products SET
        sku = COALESCE(${sqlNullableString(body.sku)}, sku),
        ean = COALESCE(${sqlNullableString(body.ean)}, ean),
        category_id = COALESCE(${asNumber(body.category_id)}, category_id),
        category_name = COALESCE(${sqlNullableString(body.category_name)}, category_name),
        product_name = COALESCE(${sqlNullableString(body.product_name)}, product_name),
        warranty = COALESCE(${sqlNullableString(body.warranty)}, warranty),
        updated_at = NOW()
      WHERE id = ${id}
    `;
  }
  return { data: await getBlProductById(id) };
}

export async function deleteBlProduct(id: number) {
  if (!id) return { error: "id is required." };
  const existing = await getBlProductById(id);
  if (!existing) return { error: "Product not found." };
  await prisma.$executeRaw`DELETE FROM bl_products WHERE id = ${id}`;
  return { data: { deleted: true, id } };
}
