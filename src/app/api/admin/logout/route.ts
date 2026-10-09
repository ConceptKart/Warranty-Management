import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/get-session";

export const runtime = "nodejs";

export async function POST() {
  const session = await getSession();
  session.destroy();
  return NextResponse.json({ success: true });
}
