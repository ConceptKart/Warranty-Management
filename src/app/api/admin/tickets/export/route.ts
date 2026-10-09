import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

/** @deprecated Use /api/admin/export-tickets — kept as redirect for old links. */
export async function GET(request: NextRequest) {
  const url = request.nextUrl.clone();
  url.pathname = "/api/admin/export-tickets";
  return NextResponse.redirect(url, 308);
}
