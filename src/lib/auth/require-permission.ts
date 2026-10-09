import { NextResponse } from "next/server";
import type { IronSession } from "iron-session";
import { getSession } from "@/lib/auth/get-session";
import type { AdminSessionUser, SessionData } from "@/lib/auth/session";
import {
  hasAnyPermission,
  hasPermission,
  type AdminPermission,
} from "@/lib/auth/permissions";

type AuthOk = {
  ok: true;
  session: IronSession<SessionData>;
  user: AdminSessionUser;
  role: string;
};

type AuthFail = {
  ok: false;
  response: NextResponse;
};

export async function requireAdminPermission(
  permission: AdminPermission | readonly AdminPermission[],
): Promise<AuthOk | AuthFail> {
  const session = await getSession();
  if (!session.adminUser) {
    return {
      ok: false,
      response: NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 },
      ),
    };
  }

  const user = session.adminUser;
  const role = user.role;
  const allowed = Array.isArray(permission)
    ? hasAnyPermission(role, permission)
    : hasPermission(role, permission);

  if (!allowed) {
    return {
      ok: false,
      response: NextResponse.json(
        { success: false, error: "You do not have permission for this action" },
        { status: 403 },
      ),
    };
  }

  return { ok: true, session, user, role };
}
