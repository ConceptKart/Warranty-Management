import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/get-session";
import { lookupTicketByReplacementEan } from "@/lib/admin/replacement-ean";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const session = await getSession();
  if (!session.adminUser) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as { ean?: string };
  const result = await lookupTicketByReplacementEan(String(body.ean ?? ""));
  return NextResponse.json(result, { status: result.success ? 200 : 400 });
}
