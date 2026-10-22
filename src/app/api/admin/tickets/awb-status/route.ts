import { NextResponse } from "next/server";
import { requireAdminPermission } from "@/lib/auth/require-permission";
import { lookupAwbStatusesByTicketIds } from "@/lib/admin/logistics-ops";
import { applyShipwayStatusUpdatesFromLookup } from "@/lib/admin/shipway-status-sync";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: Request) {
  const auth = await requireAdminPermission([
    "assign_awb",
    "view_shipment_info",
    "manage_shipments",
  ]);
  if (!auth.ok) return auth.response;
  const { user } = auth;

  const body = (await request.json()) as { ticket_ids?: number[] };
  const ticketIds = Array.isArray(body.ticket_ids)
    ? body.ticket_ids.map(Number).filter((id) => id > 0)
    : [];

  if (ticketIds.length === 0) {
    return NextResponse.json(
      { success: false, error: "No valid ticket IDs provided." },
      { status: 400 },
    );
  }

  try {
    const data = await lookupAwbStatusesByTicketIds(ticketIds);
    const statusUpdates = await applyShipwayStatusUpdatesFromLookup(
      data,
      user.username,
    );
    return NextResponse.json({ success: true, data, status_updates: statusUpdates });
  } catch (error) {
    console.error("[awb-status]", error);
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to lookup AWB statuses",
      },
      { status: 500 },
    );
  }
}
