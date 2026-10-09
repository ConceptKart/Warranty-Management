import { NextResponse } from "next/server";
import { requireAdminPermission } from "@/lib/auth/require-permission";
import { changeTicketType } from "@/lib/admin/replacement-ean";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = await requireAdminPermission("edit_tickets");
  if (!auth.ok) return auth.response;
  const { user } = auth;

  const body = (await request.json()) as {
    ticket_id?: number;
    new_type_id?: number;
  };

  const ticketId = Number(body.ticket_id);
  const newTypeId = Number(body.new_type_id);

  if (!ticketId || !newTypeId) {
    return NextResponse.json(
      { success: false, error: "ticket_id and new_type_id are required" },
      { status: 400 },
    );
  }

  const result = await changeTicketType(
    ticketId,
    newTypeId,
    user.username,
  );

  return NextResponse.json(result, { status: result.success ? 200 : 400 });
}
