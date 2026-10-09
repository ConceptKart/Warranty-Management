import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/get-session";

export const runtime = "nodejs";

export async function GET() {
  const session = await getSession();

  if (!session.adminUser) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }

  return NextResponse.json({
    authenticated: true,
    user: session.adminUser,
  });
}
