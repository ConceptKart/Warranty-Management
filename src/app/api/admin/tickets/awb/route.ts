import { NextResponse } from "next/server";
import { requireAdminPermission } from "@/lib/auth/require-permission";
import {
  assignAwbToTicket,
  createShipwayShipmentAndAssign,
} from "@/lib/admin/ticket-details";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = await requireAdminPermission("assign_awb");
  if (!auth.ok) return auth.response;
  const { user } = auth;                                        
  const body = (await request.json()) as {
    ticket_id?: number;
    shipment_mode?: string;
    awb_number?: string;
    courier_partner?: string;
    shipment_type?: "forward" | "reverse";
    customer_address?: string;
    customer_city?: string;
    customer_state?: string;
    customer_zipcode?: string;
  };

  const ticketId = Number(body.ticket_id);
  if (!ticketId) {
    return NextResponse.json(
      { success: false, error: "ticket_id is required" },
      { status: 400 },
    );
  }

  const mode = String(body.shipment_mode ?? "").trim();

  // Shipway create modes
  if (mode === "return" || mode === "forward") {
    const result = await createShipwayShipmentAndAssign({
      ticketId,
      mode,
      assignedBy: user.username,
      customerAddress: String(body.customer_address ?? ""),
      customerCity: String(body.customer_city ?? ""),
      customerState: String(body.customer_state ?? ""),
      customerZipcode: String(body.customer_zipcode ?? ""),
    });
    return NextResponse.json(result, { status: result.success ? 200 : 400 });
  }

  // Manual modes (PHP: manual / manual_forward / manual_reverse)
  const shipmentType: "forward" | "reverse" =
    mode === "manual_reverse" || body.shipment_type === "reverse"
      ? "reverse"
      : "forward";

  const result = await assignAwbToTicket({
    ticketId,
    awbNumber: String(body.awb_number ?? ""),
    courierPartner: String(body.courier_partner ?? ""),
    shipmentType,
    assignedBy: user.username,
  });

  return NextResponse.json(result, { status: result.success ? 200 : 400 });
}
