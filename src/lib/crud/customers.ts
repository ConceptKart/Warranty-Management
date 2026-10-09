import { prisma } from "@/lib/db";
import {
  asNumber,
  asString,
  serializeRow,
  serializeRows,
  sqlNullableString,
} from "@/lib/crud/http";

export async function listCustomers(page: number, limit: number, offset: number) {
  const [countRows, rows] = await Promise.all([
    prisma.$queryRaw<[{ c: bigint }]>`SELECT COUNT(*) AS c FROM customers`,
    prisma.$queryRaw<Array<Record<string, unknown>>>`
      SELECT customer_id, baselinker_customer_id, email, first_name, last_name,
             phone, address, created_at, updated_at
      FROM customers
      ORDER BY customer_id DESC
      LIMIT ${limit} OFFSET ${offset}
    `,
  ]);
  return {
    totalRecords: Number(countRows[0]?.c ?? 0),
    data: serializeRows(rows),
    page,
    limit,
  };
}

export async function getCustomerById(id: number) {
  const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT customer_id, baselinker_customer_id, email, first_name, last_name,
           phone, address, created_at, updated_at
    FROM customers
    WHERE customer_id = ${id}
    LIMIT 1
  `;
  return rows[0] ? serializeRow(rows[0]) : null;
}

export async function createCustomer(body: Record<string, unknown>) {
  const email = asString(body.email)?.trim();
  if (!email) return { error: "email is required." };

  await prisma.$executeRaw`
    INSERT INTO customers (
      baselinker_customer_id, email, first_name, last_name, phone, address, created_at
    ) VALUES (
      ${sqlNullableString(body.baselinker_customer_id)},
      ${email},
      ${sqlNullableString(body.first_name)},
      ${sqlNullableString(body.last_name)},
      ${sqlNullableString(body.phone)},
      ${sqlNullableString(body.address)},
      NOW()
    )
  `;
  const created = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT customer_id, baselinker_customer_id, email, first_name, last_name,
           phone, address, created_at, updated_at
    FROM customers WHERE email = ${email} ORDER BY customer_id DESC LIMIT 1
  `;
  return { data: created[0] ? serializeRow(created[0]) : null };
}

export async function updateCustomer(body: Record<string, unknown>) {
  const id = asNumber(body.customer_id ?? body.id);
  if (!id) return { error: "customer_id is required." };

  const existing = await getCustomerById(id);
  if (!existing) return { error: "Customer not found." };

  const email = asString(body.email)?.trim() ?? String(existing.email ?? "");
  if (!email) return { error: "email is required." };

  await prisma.$executeRaw`
    UPDATE customers SET
      baselinker_customer_id = COALESCE(${sqlNullableString(body.baselinker_customer_id)}, baselinker_customer_id),
      email = ${email},
      first_name = COALESCE(${sqlNullableString(body.first_name)}, first_name),
      last_name = COALESCE(${sqlNullableString(body.last_name)}, last_name),
      phone = COALESCE(${sqlNullableString(body.phone)}, phone),
      address = COALESCE(${sqlNullableString(body.address)}, address),
      updated_at = NOW()
    WHERE customer_id = ${id}
  `;
  return { data: await getCustomerById(id) };
}

export async function deleteCustomer(id: number) {
  if (!id) return { error: "customer_id is required." };
  const existing = await getCustomerById(id);
  if (!existing) return { error: "Customer not found." };
  await prisma.$executeRaw`DELETE FROM customers WHERE customer_id = ${id}`;
  return { data: { deleted: true, customer_id: id } };
}
