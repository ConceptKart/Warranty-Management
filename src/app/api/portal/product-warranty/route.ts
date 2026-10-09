import { NextRequest, NextResponse } from "next/server";
import { getProductWarrantyBySku } from "@/lib/portal/product-warranty";

export const runtime = "nodejs";

/** Port of public/api/product_warranty.php */
export async function GET(request: NextRequest) {
  const sku = request.nextUrl.searchParams.get("sku") ?? "";
  const result = await getProductWarrantyBySku({ sku });
  return NextResponse.json(result, {
    status: result.success ? 200 : 400,
  });
}
