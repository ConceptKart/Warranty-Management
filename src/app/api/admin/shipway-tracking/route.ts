import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/get-session";
import {
  bulkUpdateShipments,
  fetchTrackingStatus,
  getShipmentHistory,
  validateAwbNumber,
} from "@/lib/admin/shipway-tracking";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const session = await getSession();
  if (!session.adminUser) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 },
    );
  }

  const body = (await request.json()) as {
    action?: string;
    awb_number?: string;
    awb_numbers?: string[];
  };

  const action = String(body.action ?? "").trim();

  if (action === "validate_awb") {
    const awb = String(body.awb_number ?? "");
    return NextResponse.json({
      success: true,
      valid: validateAwbNumber(awb),
      awb_number: awb.trim(),
    });
  }

  if (action === "fetch_tracking") {
    const result = await fetchTrackingStatus(String(body.awb_number ?? ""));
    return NextResponse.json(result, { status: result.success ? 200 : 400 });
  }

  if (action === "get_shipment_history") {
    const result = await getShipmentHistory(String(body.awb_number ?? ""));
    return NextResponse.json(result, { status: result.success ? 200 : 400 });
  }

  if (action === "bulk_update") {
    const awbs = Array.isArray(body.awb_numbers)
      ? body.awb_numbers.map(String).filter(Boolean)
      : [];
    if (awbs.length === 0) {
      return NextResponse.json(
        { success: false, error: "No AWB numbers provided" },
        { status: 400 },
      );
    }
    const data = await bulkUpdateShipments(awbs);
    return NextResponse.json({ success: true, data });
  }

  return NextResponse.json(
    { success: false, error: "Invalid action" },
    { status: 400 },
  );
}
