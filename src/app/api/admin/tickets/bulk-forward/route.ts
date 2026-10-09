import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/get-session";
import { bulkForwardShipments } from "@/lib/admin/logistics-ops";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const session = await getSession();
  if (!session.adminUser) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as { ticket_ids?: number[] };
  const ticketIds = Array.isArray(body.ticket_ids)
    ? body.ticket_ids.map(Number).filter((id) => id > 0)
    : [];

  if (ticketIds.length === 0) {
    return NextResponse.json(
      { success: false, error: "No ticket IDs provided" },
      { status: 400 },
    );
  }

  const result = await bulkForwardShipments(
    ticketIds,
    session.adminUser.username,
  );
  return NextResponse.json(result);
}
