import { NextResponse } from "next/server";
import { requireAdminPermission } from "@/lib/auth/require-permission";
import { updateTicketStatus } from "@/lib/admin/ticket-details";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = await requireAdminPermission("manage_statuses");
  if (!auth.ok) return auth.response;
  const { user } = auth;

  const body = (await request.json()) as {
    ticket_id?: number;
    status_id?: number;
    reason?: string;
    notes?: string;
  };

  const ticketId = Number(body.ticket_id);
  const statusId = Number(body.status_id);

  if (!ticketId || !statusId) {
    return NextResponse.json(
      { success: false, error: "ticket_id and status_id are required" },
      { status: 400 },
    );
  }

  const result = await updateTicketStatus(
    ticketId,
    statusId,
    user.username,
    body.reason ?? "",
    body.notes ?? "",
  );

  return NextResponse.json(result, { status: result.success ? 200 : 400 });
}
