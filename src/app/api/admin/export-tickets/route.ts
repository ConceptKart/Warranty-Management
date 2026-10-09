import { NextRequest, NextResponse } from "next/server";
import { requireAdminPermission } from "@/lib/auth/require-permission";
import {
  getFilterOptions,
  getTickets,
  resolveTicketFilters,
  ticketsToCsvRows,
  type TicketFilters,
} from "@/lib/admin/tickets";

export const runtime = "nodejs";

/**
 * Ticket CSV export (stable path).
 * Prefer this over /api/admin/tickets/export — nested tickets API routes
 * can intermittently 404 under Next.js Turbopack in dev.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdminPermission("export_data");
  if (!auth.ok) return auth.response;

  try {
    const sp = request.nextUrl.searchParams;
    const raw: TicketFilters = {
      search: sp.get("search") ?? "",
      status: sp.get("status") ?? "",
      priority: sp.get("priority") ?? "",
      ticket_type: sp.get("ticket_type") ?? "",
      platform: sp.get("platform") ?? "",
      date_from: sp.get("date_from") ?? "",
      date_to: sp.get("date_to") ?? "",
      request_date_from: sp.get("request_date_from") ?? "",
      request_date_to: sp.get("request_date_to") ?? "",
      request_date_sort: sp.get("request_date_sort") ?? "",
      handled_by: sp.get("handled_by") ?? "",
      filter: sp.get("filter") ?? "",
      status_name: sp.get("status_name") ?? "",
    };

    const options = await getFilterOptions();
    const { filters } = resolveTicketFilters(raw, options);
    // Do not sync Shipway/AWB on export — that path can send status emails
    // and the SMTP host rate-limits AUTH ("too many AUTH commands").
    const result = await getTickets(filters, 1, 10000, { syncAwb: false });
    const csv = ticketsToCsvRows(result.tickets);
    const filename = `warranty_tickets_${new Date()
      .toISOString()
      .replace(/[:.]/g, "-")
      .slice(0, 19)}.csv`;

    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to export tickets";
    console.error("[export-tickets]", message);
    return NextResponse.json(
      {
        success: false,
        error: message,
      },
      { status: 500 },
    );
  }
}
