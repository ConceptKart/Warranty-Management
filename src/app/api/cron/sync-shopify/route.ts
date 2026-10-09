import { NextResponse } from "next/server";
import { authorizeCron } from "@/lib/cron/baselinker-client";
import { syncShopifyOrders } from "@/lib/cron/shopify-sync";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * HTTP port of cron/baselinker_sync.php
 * GET/POST /api/cron/sync-shopify?date=YYYY-MM-DD&dry_run=1
 */
async function handle(request: Request) {
  const auth = authorizeCron(request);
  if (!auth.ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date");
  const dryRun =
    searchParams.get("dry_run") === "1" ||
    searchParams.get("dry_run") === "true";

  try {
    const results = await syncShopifyOrders({ date, dryRun });
    return NextResponse.json({
      success: results.rows_errored === 0,
      results,
      warn: "warn" in auth ? auth.warn : undefined,
    });
  } catch (error) {
    console.error("[cron/sync-shopify]", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Shopify sync failed",
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

