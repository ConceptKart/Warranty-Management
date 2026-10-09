import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import type { AdminSessionUser } from "@/lib/auth/session";

export type AuthResult =
  | { success: true; user: AdminSessionUser }
  | { success: false; error: string };

/**
 * Mirrors AdminController::authenticate() against admin_users.
 * PHP password_hash ($2y$) is compatible with bcryptjs.compare.
 */
export async function authenticateAdmin(
  username: string,
  password: string,
): Promise<AuthResult> {
  const trimmedUsername = username.trim();

  if (!trimmedUsername || !password) {
    return { success: false, error: "Please enter both username and password" };
  }

  const row = await prisma.adminUser.findFirst({
    where: { username: trimmedUsername },
    select: {
      userId: true,
      username: true,
      passwordHash: true,
      fullName: true,
      role: true,
      isActive: true,
    },
  });

  if (!row || !row.isActive) {
    return { success: false, error: "Invalid username or password" };
  }

  const valid = await bcrypt.compare(password, row.passwordHash);
  if (!valid) {
    return { success: false, error: "Invalid username or password" };
  }

  await prisma.adminUser.update({
    where: { userId: row.userId },
    data: { lastLogin: new Date() },
  });

  return {
    success: true,
    user: {
      userId: row.userId,
      username: row.username,
      role: row.role,
      name: row.fullName,
    },
  };
}
