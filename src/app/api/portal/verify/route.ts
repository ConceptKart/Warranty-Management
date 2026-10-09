import { NextResponse } from "next/server";
import { getPortalSession } from "@/lib/portal/get-session";
import { validateOrderInput, verifyOrder } from "@/lib/portal/verify-order";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = (await request.json()) as {
    order_number?: string;
    platform?: string;
  };

  const orderNumber = String(body.order_number ?? "").trim();
  const platform = String(body.platform ?? "").trim();

  const errors = validateOrderInput(orderNumber, platform);
  if (errors.length > 0) {
    return NextResponse.json(
      { success: false, error: errors[0], errors },
      { status: 400 },
    );
  }

  const result = await verifyOrder(orderNumber, platform);
  if (!result.success) {
    return NextResponse.json(result, { status: 400 });
  }

  const session = await getPortalSession();
  session.orderData = result;
  session.platform = platform.toLowerCase();
  session.selectedIssueId = undefined;
  session.selectedProduct = undefined;
  session.selectedProductsJson = undefined;
  session.selectedEanIssue = undefined;
  session.ticketNumber = undefined;
  await session.save();

  return NextResponse.json({ success: true, redirect: "/issue" });
}
