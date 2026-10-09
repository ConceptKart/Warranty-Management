import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/get-session";
import { refreshTicketTracking } from "@/lib/admin/shipment-tracking";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const session = await getSession();
  if (!session.adminUser) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as { ticket_id?: number };
  const ticketId = Number(body.ticket_id);

  if (!ticketId) {
    return NextResponse.json(
      { success: false, error: "ticket_id is required" },
      { status: 400 },
    );
  }

  const result = await refreshTicketTracking(ticketId);
  return NextResponse.json(result, { status: result.success ? 200 : 400 });
}
