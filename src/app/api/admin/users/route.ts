import { NextResponse } from "next/server";
import { createUser, deleteUser, updateUser } from "@/lib/admin/users";
import { requireAdminPermission } from "@/lib/auth/require-permission";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = await requireAdminPermission("manage_users");
  if (!auth.ok) return auth.response;

  const body = (await request.json()) as {
    action?: string;
    username?: string;
    password?: string;
    full_name?: string;
    email?: string;
    role?: string;
    user_id?: number;
    is_active?: boolean;
    new_password?: string;
  };

  const action = body.action ?? "";

  if (action === "create") {
    const result = await createUser({
      username: body.username ?? "",
      password: body.password ?? "",
      full_name: body.full_name ?? "",
      email: body.email ?? "",
      role: body.role ?? "support",
    });
    return NextResponse.json(result, { status: result.success ? 200 : 400 });
  }

  if (action === "update") {
    const result = await updateUser({
      user_id: Number(body.user_id),
      full_name: body.full_name ?? "",
      email: body.email ?? "",
      role: body.role ?? "support",
      is_active: Boolean(body.is_active),
      new_password: body.new_password ?? "",
    });
    return NextResponse.json(result, { status: result.success ? 200 : 400 });
  }

  if (action === "delete") {
    const result = await deleteUser(
      Number(body.user_id),
      auth.session.adminUser!.userId,
    );
    return NextResponse.json(result, { status: result.success ? 200 : 400 });
  }

  return NextResponse.json(
    { success: false, error: "Unknown action" },
    { status: 400 },
  );
}
