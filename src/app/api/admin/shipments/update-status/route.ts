import { NextResponse } from "next/server";
import { requireAdminPermission } from "@/lib/auth/require-permission";
import { updateShipmentStatus } from "@/lib/admin/shipments";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = await requireAdminPermission("manage_shipments");
  if (!auth.ok) return auth.response;

  const body = (await request.json()) as {
    awb_number?: string;
    status_code?: string;
    status_message?: string;
    location?: string;
    remarks?: string;
    courier_status?: string;
  };

  const result = await updateShipmentStatus({
    awbNumber: String(body.awb_number ?? ""),
    statusCode: String(body.status_code ?? ""),
    statusMessage: String(body.status_message ?? ""),
    location: body.location,
    remarks: body.remarks,
    courierStatus: body.courier_status,
  });

  return NextResponse.json(result, { status: result.success ? 200 : 400 });
}
