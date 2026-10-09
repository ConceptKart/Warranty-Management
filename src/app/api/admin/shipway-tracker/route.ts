import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/get-session";
import { trackShipwayNumber } from "@/lib/admin/shipway-tracker";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  const session = await getSession();
  if (!session.adminUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as { number?: string };
  const number = String(body.number ?? "").trim();
  if (!number) {
    return NextResponse.json(
      { error: "Please enter a number to track" },
      { status: 400 },
    );
  }

  try {
    const results = await trackShipwayNumber(number);
    return NextResponse.json(results);
  } catch (error) {
    console.error("[admin/shipway-tracker]", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Shipway lookup failed",
      },
      { status: 500 },
    );
  }
}
