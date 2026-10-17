import { NextResponse } from "next/server";
import { requireAdminPermission } from "@/lib/auth/require-permission";
import { updateCustomerInfo } from "@/lib/admin/ticket-details";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = await requireAdminPermission("edit_tickets", request);
  if (!auth.ok) return auth.response;

  const body = (await request.json()) as {
    ticket_id?: number;
    phone?: string;
    address?: string;
  };

  const ticketId = Number(body.ticket_id);
  const phone = String(body.phone ?? "").trim();
  const address = String(body.address ?? "").trim();

  if (!ticketId) {
    return NextResponse.json(
      { success: false, error: "ticket_id is required" },
      { status: 400 },
    );
  }
  if (!phone || !address) {
    return NextResponse.json(
      { success: false, error: "Phone and address are required" },
      { status: 400 },
    );
  }

  const result = await updateCustomerInfo(ticketId, phone, address);
  return NextResponse.json(result, { status: result.success ? 200 : 400 });
}
