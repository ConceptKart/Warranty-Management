import { NextResponse } from "next/server";
import {
  getCronSyncStats,
  syncActiveShipments,
  syncAllChanged,
  syncFullReconciliation,
  testSyncConnections,
} from "@/lib/admin/shipment-sync-cron";

export const runtime = "nodejs";
export const maxDuration = 300;

function authorize(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    return { ok: true as const, warn: "CRON_SECRET not set" };
  }
  const header =
    request.headers.get("x-cron-secret") ||
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (header !== secret) {
    return { ok: false as const };
  }
  return { ok: true as const };
}

/**
 * HTTP port of cron/sync_shipments.php
 * Modes: ?mode=changed|active|full|test|stats
 * Default: changed (matches PHP CLI default)
 *
 * Protect with header: x-cron-secret: $CRON_SECRET
 */
export async function GET(request: Request) {
  const auth = authorize(request);
  if (!auth.ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const mode = (searchParams.get("mode") || "changed").toLowerCase();
  const limit = Math.min(
    200,
    Math.max(1, Number(searchParams.get("limit") || "50")),
  );

  try {
    if (mode === "test") {
      const results = await testSyncConnections();
      return NextResponse.json({
        success: results.local.success && results.external.success,
        mode: "test",
        results,
        warn: "warn" in auth ? auth.warn : undefined,
      });
    }

    if (mode === "stats") {
      const stats = await getCronSyncStats();
      return NextResponse.json({
        success: true,
        mode: "stats",
        stats,
        warn: "warn" in auth ? auth.warn : undefined,
      });
    }

    if (mode === "active") {
      const results = await syncActiveShipments(limit);
      return NextResponse.json({
        success: results.errors.length === 0,
        mode: "active",
        results,
        warn: "warn" in auth ? auth.warn : undefined,
      });
    }

    if (mode === "full") {
      const results = await syncFullReconciliation();
      return NextResponse.json({
        success: results.errors.length === 0,
        mode: "full",
        results,
        warn: "warn" in auth ? auth.warn : undefined,
      });
    }

    // default: changed / incremental (PHP default)
    const results = await syncAllChanged();
    return NextResponse.json({
      success: results.errors.length === 0,
      mode: "changed",
      results,
      warn: "warn" in auth ? auth.warn : undefined,
    });
  } catch (error) {
    console.error("[cron/sync-shipments]", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Sync failed",
      },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  return GET(request);
}
