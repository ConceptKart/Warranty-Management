import { NextResponse } from "next/server";
import { requireAdminPermission } from "@/lib/auth/require-permission";
import { assignShipmentAwb } from "@/lib/admin/shipments";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = await requireAdminPermission(["assign_awb", "manage_shipments"]);
  if (!auth.ok) return auth.response;

  const body = (await request.json()) as {
    ticket_id?: number;
    awb_number?: string;
    courier_partner?: string;
    shipment_type?: "forward" | "reverse";
  };

  const result = await assignShipmentAwb({
    ticketId: Number(body.ticket_id),
    awbNumber: String(body.awb_number ?? ""),
    courierPartner: String(body.courier_partner ?? ""),
    shipmentType: body.shipment_type === "reverse" ? "reverse" : "forward",
    assignedBy: session.adminUser.username,
  });

  return NextResponse.json(result, { status: result.success ? 200 : 400 });
}
