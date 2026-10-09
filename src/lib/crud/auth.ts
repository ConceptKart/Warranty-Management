import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/get-session";
import {
  hasAnyPermission,
  hasPermission,
  type AdminPermission,
} from "@/lib/auth/permissions";
import { fail } from "@/lib/crud/http";

type CrudAuthOk = { ok: true; role: string };
type CrudAuthFail = { ok: false; response: NextResponse };

/**
 * Hostinger `api_*` endpoints are open; Next protects them with admin session
 * (same roles as the admin panel). Optional `x-crud-api-key` / `CRUD_API_KEY`
 * allows Postman-style access without a browser cookie.
 */
export async function requireCrudAccess(
  permission: AdminPermission | readonly AdminPermission[],
): Promise<CrudAuthOk | CrudAuthFail> {
  const session = await getSession();
  if (!session.adminUser) {
    return {
      ok: false,
      response: fail("Unauthorized — admin login or CRUD_API_KEY required", 401),
    };
  }

  const role = session.adminUser.role;
  const allowed = Array.isArray(permission)
    ? hasAnyPermission(role, permission as readonly AdminPermission[])
    : hasPermission(role, permission as AdminPermission);

  if (!allowed) {
    return {
      ok: false,
      response: fail("You do not have permission for this action", 403),
    };
  }

  return { ok: true, role };
}

export async function requireCrudAccessFromRequest(
  request: Request,
  permission: AdminPermission | readonly AdminPermission[],
): Promise<CrudAuthOk | CrudAuthFail> {
  const apiKey = process.env.CRUD_API_KEY?.trim();
  if (apiKey) {
    const header =
      request.headers.get("x-crud-api-key") ??
      request.headers.get("x-api-key") ??
      "";
    if (header && header === apiKey) {
      return { ok: true, role: "admin" };
    }
  }
  return requireCrudAccess(permission);
}
