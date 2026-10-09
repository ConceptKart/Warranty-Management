import { NextResponse } from "next/server";
import { requireAdminPermission } from "@/lib/auth/require-permission";
import {
  getTodaysForwardAwbOrders,
  markHandoverToPacker,
} from "@/lib/admin/logistics-ops";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = await requireAdminPermission("update_pack_status");
  if (!auth.ok) return auth.response;
  const { user } = auth;

  const body = (await request.json()) as {
    action?: string;
    awb_filter?: string;
    date_from?: string;
    date_to?: string;
    ticket_id?: number;
    awb_number?: string;
    packer_name?: string;
  };

  const action = String(body.action ?? "").trim();

  if (action === "list" || action === "get_todays_forward_awb") {
    const orders = await getTodaysForwardAwbOrders({
      awbFilter: body.awb_filter,
      dateFrom: body.date_from,
      dateTo: body.date_to,
    });
    return NextResponse.json({
      success: true,
      orders,
      debug: {
        awb_filter: body.awb_filter ?? "",
        date_from: body.date_from ?? null,
        date_to: body.date_to ?? null,
        count: orders.length,
      },
    });
  }

  if (action === "mark" || action === "mark_handover") {
    const result = await markHandoverToPacker({
      ticketId: Number(body.ticket_id),
      awbNumber: String(body.awb_number ?? ""),
      packerName: String(body.packer_name ?? ""),
      adminUser: user.username,
    });
    return NextResponse.json(result, { status: result.success ? 200 : 400 });
  }

  return NextResponse.json(
    { success: false, error: "Invalid action" },
    { status: 400 },
  );
}
