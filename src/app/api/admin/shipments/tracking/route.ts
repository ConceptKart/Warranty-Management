import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/get-session";
import { getShipmentTracking } from "@/lib/admin/shipments";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session.adminUser) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 },
    );
  }

  const { searchParams } = new URL(request.url);
  const awb = searchParams.get("awb") ?? "";
  const result = await getShipmentTracking(awb);
  return NextResponse.json(result, { status: result.success ? 200 : 404 });
}
