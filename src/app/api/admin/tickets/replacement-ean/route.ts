import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/get-session";
import {
  fetchProductByEan,
  getReplacementProductInfo,
  saveReplacementEan,
} from "@/lib/admin/replacement-ean";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  const session = await getSession();
  if (!session.adminUser) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as {
    action?: string;
    ticket_id?: number;
    ean?: string;
    product_id?: number | string | null;
    variant_id?: number | string | null;
    warehouse_id?: number | string | null;
    location_name?: string | null;
  };

  const action = body.action ?? "";

  if (action === "get_replacement_product_info") {
    const result = await getReplacementProductInfo(Number(body.ticket_id));
    return NextResponse.json(result, { status: result.success ? 200 : 400 });
  }

  if (action === "fetch_product_by_ean") {
    const result = await fetchProductByEan(String(body.ean ?? ""));
    return NextResponse.json(result, { status: result.success ? 200 : 400 });
  }

  if (action === "save_replacement_ean") {
    const toNum = (v: unknown) => {
      if (v === null || v === undefined || v === "" || v === "null") return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };
    const result = await saveReplacementEan({
      ticketId: Number(body.ticket_id),
      ean: String(body.ean ?? ""),
      productId: toNum(body.product_id),
      variantId: toNum(body.variant_id),
      warehouseId: toNum(body.warehouse_id),
      locationName: body.location_name ?? null,
    });
    return NextResponse.json(result, { status: result.success ? 200 : 400 });
  }

  return NextResponse.json(
    { success: false, error: "Unknown action" },
    { status: 400 },
  );
}
