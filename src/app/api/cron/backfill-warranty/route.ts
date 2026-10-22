import { NextResponse } from "next/server";
import {
  authorizeCron,
  parseCronDryRun,
  parseCronLimit,
} from "@/lib/cron/baselinker-client";
import { backfillProductWarranties } from "@/lib/cron/backfill-warranty";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Fill empty bl_products.warranty from BaseLinker extra_field_1281.
 * GET/POST /api/cron/backfill-warranty?limit=200&dry_run=1
 */
async function handle(request: Request) {
  const auth = authorizeCron(request);
  if (!auth.ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const limit = parseCronLimit(searchParams.get("limit"), 200, 1000);
  const dryRun = parseCronDryRun(searchParams.get("dry_run"));

  try {
    const results = await backfillProductWarranties({
      limit,
      dryRun,
    });
    return NextResponse.json({
      success: true,
      results,
      warn: "warn" in auth ? auth.warn : undefined,
    });
  } catch (error) {
    console.error("[cron/backfill-warranty]", error);
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error ? error.message : "Warranty backfill failed",
      },
      { status: 500 },
    );
  }
}

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}
