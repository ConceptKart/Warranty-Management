import { NextResponse } from "next/server";
import { requireAdminPermission } from "@/lib/auth/require-permission";
import { updateStatusFromShipway } from "@/lib/admin/shipway-status-sync";

export const runtime = "nodejs";

/** Port of tickets.php action=update_local_status */
export async function POST(request: Request) {
  const auth = await requireAdminPermission("manage_statuses");
  if (!auth.ok) return auth.response;
  const { user } = auth;

  const body = (await request.json()) as {
    ticket_id?: number;
    mapped_status?: string;
    awb_type?: string;
  };

  const ticketId = Number(body.ticket_id);
  const mappedStatus = String(body.mapped_status ?? "").trim();
  const awbType =
    body.awb_type === "reverse" ? ("reverse" as const) : ("forward" as const);

  if (!ticketId || !mappedStatus) {
    return NextResponse.json(
      { success: false, error: "Missing parameters" },
      { status: 400 },
    );
  }

  const result = await updateStatusFromShipway(
    ticketId,
    mappedStatus,
    awbType,
    user.username,
  );

  return NextResponse.json(result, { status: result.success ? 200 : 400 });
}
