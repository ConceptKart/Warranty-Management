import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { ALLOWED_ROLES } from "@/lib/admin/users";
import {
  asNumber,
  asString,
  serializeRow,
  serializeRows,
  sqlNullableString,
} from "@/lib/crud/http";

export async function listUsers() {
  const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT user_id, username, full_name, email, role, is_active,
           created_at, updated_at, last_login
    FROM admin_users
    ORDER BY user_id DESC
  `;
  return {
    total: rows.length,
    data: serializeRows(rows),
  };
}

export async function getUserById(id: number) {
  const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT user_id, username, full_name, email, role, is_active,
           created_at, updated_at, last_login
    FROM admin_users
    WHERE user_id = ${id}
    LIMIT 1
  `;
  return rows[0] ? serializeRow(rows[0]) : null;
}

export async function createUser(body: Record<string, unknown>) {
  const username = asString(body.username)?.trim();
  const password = asString(body.password);
  const fullName = asString(body.full_name)?.trim();
  if (!username || !password || !fullName) {
    return { error: "username, password, and full_name are required." };
  }

  const role = (asString(body.role)?.trim() || "support").toLowerCase();
  if (!ALLOWED_ROLES.includes(role as (typeof ALLOWED_ROLES)[number])) {
    return { error: `Invalid role. Allowed: ${ALLOWED_ROLES.join(", ")}` };
  }

  const hash = await bcrypt.hash(password, 10);
  try {
    await prisma.$executeRaw`
      INSERT INTO admin_users (
        username, password_hash, full_name, email, role, is_active, created_at
      ) VALUES (
        ${username},
        ${hash},
        ${fullName},
        ${sqlNullableString(body.email) ?? ""},
        ${role},
        1,
        NOW()
      )
    `;
  } catch {
    return { error: "Username already exists or insert failed." };
  }

  const created = await prisma.$queryRaw<Array<{ user_id: number }>>`
    SELECT user_id FROM admin_users WHERE username = ${username} LIMIT 1
  `;
  const id = created[0]?.user_id;
  return { data: id ? await getUserById(id) : null };
}

export async function updateUser(body: Record<string, unknown>) {
  const id = asNumber(body.user_id ?? body.id);
  if (!id) return { error: "user_id is required." };
  const existing = await getUserById(id);
  if (!existing) return { error: "User not found." };

  const fullName =
    asString(body.full_name)?.trim() ?? String(existing.full_name ?? "");
  const email =
    asString(body.email)?.trim() ?? String(existing.email ?? "");
  const role = (
    asString(body.role)?.trim() ||
    String(existing.role ?? "support")
  ).toLowerCase();

  if (!ALLOWED_ROLES.includes(role as (typeof ALLOWED_ROLES)[number])) {
    return { error: `Invalid role. Allowed: ${ALLOWED_ROLES.join(", ")}` };
  }

  const isActive =
    body.is_active === undefined
      ? null
      : body.is_active === false || body.is_active === 0 || body.is_active === "0"
        ? 0
        : 1;

  const newPassword = asString(body.password ?? body.new_password);
  if (newPassword) {
    const hash = await bcrypt.hash(newPassword, 10);
    await prisma.$executeRaw`
      UPDATE admin_users SET
        full_name = ${fullName},
        email = ${email},
        role = ${role},
        is_active = COALESCE(${isActive}, is_active),
        password_hash = ${hash},
        updated_at = NOW()
      WHERE user_id = ${id}
    `;
  } else {
    await prisma.$executeRaw`
      UPDATE admin_users SET
        full_name = ${fullName},
        email = ${email},
        role = ${role},
        is_active = COALESCE(${isActive}, is_active),
        updated_at = NOW()
      WHERE user_id = ${id}
    `;
  }

  return { data: await getUserById(id) };
}

export async function deleteUser(id: number) {
  if (!id) return { error: "user_id is required." };
  const existing = await getUserById(id);
  if (!existing) return { error: "User not found." };
  await prisma.$executeRaw`DELETE FROM admin_users WHERE user_id = ${id}`;
  return { data: { deleted: true, user_id: id } };
}
