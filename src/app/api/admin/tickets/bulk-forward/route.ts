import { NextResponse } from "next/server";
import { requireAdminPermission } from "@/lib/auth/require-permission";
import { bulkForwardShipments } from "@/lib/admin/logistics-ops";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = await requireAdminPermission("assign_awb");
  if (!auth.ok) return auth.response;
  const { user } = auth;

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

  const result = await bulkForwardShipments(ticketIds, user.username);
  return NextResponse.json(result);
}
