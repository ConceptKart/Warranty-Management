import type { NextRequest } from "next/server";
import { requireCrudAccessFromRequest } from "@/lib/crud/auth";
import {
  fail,
  idFromRequest,
  okList,
  okOne,
  parsePageLimit,
  readJsonBody,
} from "@/lib/crud/http";
import type { AdminPermission } from "@/lib/auth/permissions";

type ListResult = {
  totalRecords?: number;
  total?: number;
  data: unknown;
  page?: number;
  limit?: number;
  error?: string;
};

type MutateResult = { data?: unknown; error?: string };

export type CrudHandlers = {
  readPerm: AdminPermission | readonly AdminPermission[];
  writePerm: AdminPermission | readonly AdminPermission[];
  deletePerm?: AdminPermission | readonly AdminPermission[];
  /** Default limit when listing (users list often returns all). */
  defaultLimit?: number;
  list: (args: {
    page: number;
    limit: number;
    offset: number;
    url: URL;
  }) => Promise<ListResult>;
  getById: (id: number, url: URL) => Promise<unknown | null>;
  /** Optional non-id lookup (e.g. awb, search already in list). */
  getExtra?: (url: URL) => Promise<unknown | null | undefined>;
  create: (body: Record<string, unknown>) => Promise<MutateResult>;
  update: (
    body: Record<string, unknown>,
    url: URL,
  ) => Promise<MutateResult>;
  remove: (id: number) => Promise<MutateResult>;
  /** If true, list response uses `total` instead of page meta (api_users style). */
  listAsTotal?: boolean;
  /** PHP-style message when DELETE has no id (e.g. "ticket_id is required."). */
  deleteIdMessage?: string;
};

export function makeCrudHandlers(h: CrudHandlers) {
  async function GET(request: NextRequest) {
    const auth = await requireCrudAccessFromRequest(request, h.readPerm);
    if (!auth.ok) return auth.response;

    const url = new URL(request.url);
    const { page, limit, offset } = parsePageLimit(
      url,
      h.defaultLimit ?? 20,
    );

    try {
      const id = idFromRequest(url, null);
      if (id != null) {
        const row = await h.getById(id, url);
        if (!row) return fail("Record not found.", 404);
        return okOne(row);
      }

      if (h.getExtra) {
        const extra = await h.getExtra(url);
        if (extra !== undefined) {
          if (extra === null) return fail("Record not found.", 404);
          return okOne(extra);
        }
      }

      const result = await h.list({ page, limit, offset, url });
      if (result.error) return fail(result.error, 500);

      if (h.listAsTotal) {
        return okList(result.data, {
          total: result.total ?? (Array.isArray(result.data) ? result.data.length : 0),
        });
      }

      return okList(result.data, {
        page: result.page ?? page,
        limit: result.limit ?? limit,
        totalRecords: result.totalRecords ?? 0,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Server error";
      return fail(msg, 500);
    }
  }

  async function POST(request: NextRequest) {
    const auth = await requireCrudAccessFromRequest(request, h.writePerm);
    if (!auth.ok) return auth.response;

    const body = await readJsonBody(request);
    if (body === null) return fail("Invalid JSON body.");

    try {
      const result = await h.create(body);
      if (result.error) return fail(result.error);
      return okOne(result.data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Server error";
      return fail(msg, 500);
    }
  }

  async function PUT(request: NextRequest) {
    const auth = await requireCrudAccessFromRequest(request, h.writePerm);
    if (!auth.ok) return auth.response;

    const body = await readJsonBody(request);
    if (body === null) return fail("Invalid JSON body.");
    const url = new URL(request.url);

    try {
      const result = await h.update(body, url);
      if (result.error) return fail(result.error);
      return okOne(result.data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Server error";
      return fail(msg, 500);
    }
  }

  async function DELETE(request: NextRequest) {
    const auth = await requireCrudAccessFromRequest(
      request,
      h.deletePerm ?? h.writePerm,
    );
    if (!auth.ok) return auth.response;

    const url = new URL(request.url);
    const body = await readJsonBody(request);
    const id = idFromRequest(url, body);

    if (id == null) {
      return fail(h.deleteIdMessage ?? "id is required.");
    }

    try {
      const result = await h.remove(id);
      if (result.error) return fail(result.error);
      return okOne(result.data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Server error";
      return fail(msg, 500);
    }
  }

  return { GET, POST, PUT, DELETE };
}
