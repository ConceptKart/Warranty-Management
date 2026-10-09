import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/get-session";
import { updateTicketPriority } from "@/lib/admin/ticket-details";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const session = await getSession();
  if (!session.adminUser) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as {
    ticket_id?: number;
    priority?: string;
  };

  const ticketId = Number(body.ticket_id);
  const priority = body.priority ?? "";

  if (!ticketId) {
    return NextResponse.json(
      { success: false, error: "ticket_id is required" },
      { status: 400 },
    );
  }

  const result = await updateTicketPriority(ticketId, priority);
  return NextResponse.json(result, { status: result.success ? 200 : 400 });
}
