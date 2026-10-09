import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/get-session";
import { getUnitReplaceStock, replaceUnit } from "@/lib/admin/unit-replace";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: Request) {
  const session = await getSession();
  if (!session.adminUser) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as {
    action?: string;
    product_id?: number | string;
    variant_id?: number | string | null;
    warehouse_id?: number | string;
    location_name?: string;
    order_id?: string;
    ticket_id?: string | number;
    ticket_number?: string;
  };

  const action = body.action ?? "";
  const toNum = (v: unknown) => {
    if (v === null || v === undefined || v === "" || v === "null" || v === "0") {
      return null;
    }
    const n = Number(v);
    return Number.isFinite(n) && n !== 0 ? n : null;
  };

  if (action === "get_stock") {
    const productId = Number(body.product_id) || 0;
    const variantId = toNum(body.variant_id);
    const result = await getUnitReplaceStock(productId, variantId);
    return NextResponse.json(result, { status: result.success ? 200 : 400 });
  }

  if (action === "replace_unit") {
    const result = await replaceUnit({
      productId: Number(body.product_id) || 0,
      variantId: toNum(body.variant_id),
      warehouseId: Number(body.warehouse_id) || 0,
      locationName: String(body.location_name ?? ""),
      orderId: body.order_id ? String(body.order_id) : undefined,
      ticketId: body.ticket_id,
      ticketNumber: body.ticket_number,
    });
    return NextResponse.json(result, { status: result.success ? 200 : 400 });
  }

  return NextResponse.json(
    { success: false, error: "Unknown action" },
    { status: 400 },
  );
}
