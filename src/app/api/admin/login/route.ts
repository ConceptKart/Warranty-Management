import { NextResponse } from "next/server";
import { authenticateAdmin } from "@/lib/auth/authenticate";
import { getSession } from "@/lib/auth/get-session";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      username?: string;
      password?: string;
    };

    const result = await authenticateAdmin(
      body.username ?? "",
      body.password ?? "",
    );

    if (!result.success) {
      return NextResponse.json({ success: false, error: result.error }, { status: 401 });
    }

    const session = await getSession();
    session.adminUser = result.user;
    session.loginAt = Date.now();
    await session.save();

    return NextResponse.json({
      success: true,
      user: result.user,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Login failed";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
