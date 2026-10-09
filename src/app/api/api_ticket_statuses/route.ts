import type { NextRequest } from "next/server";
import { requireCrudAccessFromRequest } from "@/lib/crud/auth";
import {
  fail,
  idFromRequest,
  okList,
  okOne,
  readJsonBody,
} from "@/lib/crud/http";
import * as statuses from "@/lib/crud/ticket-statuses";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const auth = await requireCrudAccessFromRequest(request, [
    "view_all_tickets",
    "manage_statuses",
  ]);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const id = idFromRequest(url, null);
  try {
    if (id != null) {
      const row = await statuses.getTicketStatusById(id);
      if (!row) return fail("Record not found.", 404);
      return okOne(row);
    }
    return okList(await statuses.listTicketStatuses());
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Server error", 500);
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireCrudAccessFromRequest(request, "manage_statuses");
  if (!auth.ok) return auth.response;
  const body = await readJsonBody(request);
  if (body === null) return fail("Invalid JSON body.");

  // PHP treated empty POST as list; if no create fields, return list
  if (!body.status_name && !body.status_code) {
    return okList(await statuses.listTicketStatuses());
  }

  const result = await statuses.createTicketStatus(body);
  if (result.error) return fail(result.error);
  return okOne(result.data);
}

export async function PUT(request: NextRequest) {
  const auth = await requireCrudAccessFromRequest(request, "manage_statuses");
  if (!auth.ok) return auth.response;
  const body = await readJsonBody(request);
  if (body === null) return fail("Invalid JSON body.");

  if (!body.status_id && !body.id && !body.status_name) {
    return okList(await statuses.listTicketStatuses());
  }

  const result = await statuses.updateTicketStatus(body);
  if (result.error) return fail(result.error);
  return okOne(result.data);
}

export async function DELETE(request: NextRequest) {
  const auth = await requireCrudAccessFromRequest(request, "manage_statuses");
  if (!auth.ok) return auth.response;
  const url = new URL(request.url);
  const body = await readJsonBody(request);
  const id = idFromRequest(url, body);
  if (id == null) {
    // PHP returned list when DELETE had no id
    return okList(await statuses.listTicketStatuses());
  }
  const result = await statuses.deleteTicketStatus(id);
  if (result.error) return fail(result.error);
  return okOne(result.data);
}
