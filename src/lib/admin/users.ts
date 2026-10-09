import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";

export const ALLOWED_ROLES = [
  "admin",
  "manager",
  "support",
  "operations",
  "packer",
] as const;

export type AdminRole = (typeof ALLOWED_ROLES)[number];

export type AdminUserRow = {
  user_id: number;
  username: string;
  full_name: string;
  email: string;
  role: string;
  is_active: boolean;
  created_at: Date | null;
  last_login: Date | null;
};

export async function getAllUsers(): Promise<AdminUserRow[]> {
  const rows = await prisma.adminUser.findMany({
    select: {
      userId: true,
      username: true,
      fullName: true,
      email: true,
      role: true,
      isActive: true,
      createdAt: true,
      lastLogin: true,
    },
    orderBy: [{ role: "asc" }, { fullName: "asc" }],
  });

  return rows.map((row) => ({
    user_id: row.userId,
    username: row.username,
    full_name: row.fullName,
    email: row.email ?? "",
    role: row.role,
    is_active: row.isActive,
    created_at: row.createdAt,
    last_login: row.lastLogin,
  }));
}

export async function createUser(input: {
  username: string;
  password: string;
  full_name: string;
  email: string;
  role: string;
}): Promise<{ success: true; user_id: number } | { success: false; error: string }> {
  const username = input.username.trim();
  const fullName = input.full_name.trim();
  const email = input.email.trim();
  const role = input.role;
  const password = input.password;

  if (!ALLOWED_ROLES.includes(role as AdminRole)) {
    return { success: false, error: "Invalid role" };
  }
  if (!username || !/^[a-zA-Z0-9_]+$/.test(username)) {
    return {
      success: false,
      error: "Username must be letters, numbers, or underscore only",
    };
  }
  if (!fullName) {
    return { success: false, error: "Full name is required" };
  }
  if (password.length < 6) {
    return { success: false, error: "Password must be at least 6 characters" };
  }

  try {
    const passwordHash = await bcrypt.hash(password, 10);
    const created = await prisma.adminUser.create({
      data: {
        username,
        passwordHash,
        fullName,
        email: email || "",
        role,
      },
      select: { userId: true },
    });
    return { success: true, user_id: created.userId };
  } catch (error: unknown) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String((error as { code: string }).code)
        : "";
    if (code === "P2002") {
      return { success: false, error: "Username already exists" };
    }
    console.error("createUser:", error);
    return { success: false, error: "Failed to create user" };
  }
}

export async function updateUser(input: {
  user_id: number;
  full_name: string;
  email: string;
  role: string;
  is_active: boolean;
  new_password?: string;
}): Promise<{ success: true } | { success: false; error: string }> {
  const userId = Number(input.user_id);
  const fullName = input.full_name.trim();
  const email = input.email.trim();
  const role = input.role;
  const newPassword = input.new_password ?? "";

  if (!userId) {
    return { success: false, error: "Invalid user" };
  }
  if (!ALLOWED_ROLES.includes(role as AdminRole)) {
    return { success: false, error: "Invalid role" };
  }
  if (!fullName) {
    return { success: false, error: "Full name is required" };
  }
  if (newPassword !== "" && newPassword.length < 6) {
    return { success: false, error: "Password must be at least 6 characters" };
  }

  try {
    const data: {
      fullName: string;
      email: string;
      role: string;
      isActive: boolean;
      passwordHash?: string;
    } = {
      fullName,
      email: email || "",
      role,
      isActive: Boolean(input.is_active),
    };

    if (newPassword !== "") {
      data.passwordHash = await bcrypt.hash(newPassword, 10);
    }

    await prisma.adminUser.update({
      where: { userId },
      data,
    });
    return { success: true };
  } catch (error) {
    console.error("updateUser:", error);
    return { success: false, error: "Failed to update user" };
  }
}

export async function deleteUser(
  userId: number,
  currentUserId: number,
): Promise<{ success: true } | { success: false; error: string }> {
  if (Number(userId) === Number(currentUserId)) {
    return { success: false, error: "Cannot delete your own account" };
  }

  try {
    await prisma.adminUser.delete({ where: { userId: Number(userId) } });
    return { success: true };
  } catch (error) {
    console.error("deleteUser:", error);
    return { success: false, error: "Failed to delete user" };
  }
}
