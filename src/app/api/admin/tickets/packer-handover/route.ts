import { NextResponse } from "next/server";
import { requireAdminPermission } from "@/lib/auth/require-permission";
import {
  getTodaysForwardAwbOrders,
  markHandoverToPacker,
} from "@/lib/admin/logistics-ops";

export const runtime = "nodejs";

export async function POST(request: Request) {
  // PHP tickets.php only requires a logged-in admin. Restricting this to
  // update_pack_status hid the list for support/manager/operations.
  const auth = await requireAdminPermission("view_all_tickets");
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
    try {
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
    } catch (error) {
      console.error("[packer-handover list]", error);
      return NextResponse.json(
        {
          success: false,
          orders: [],
          error:
            error instanceof Error
              ? error.message
              : "Failed to load packer handover orders",
        },
        { status: 500 },
      );
    }
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
