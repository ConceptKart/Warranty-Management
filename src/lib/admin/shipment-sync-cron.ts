import { prisma } from "@/lib/db";
import { queryExternalShipway } from "@/lib/db-external-shipway";
import {
  syncActiveShipmentsFromExternal,
  syncAllChanged,
  syncFullReconciliation,
} from "@/lib/admin/external-shipment-sync-service";
import { getTrackingStats } from "@/lib/admin/shipway-tracking";

/**
 * HTTP port of cron/sync_shipments.php modes.
 * --active → syncActiveShipmentsFromExternal (external DB non-terminal)
 * default/changed → syncAllChanged (watermark incremental)
 * --full → syncFullReconciliation
 */

export async function syncActiveShipments(limit = 50) {
  // limit kept for API compat; PHP uses config batch_size
  void limit;
  return syncActiveShipmentsFromExternal();
}

export { syncAllChanged, syncFullReconciliation };

/** Port of ExternalShipmentSyncService::testConnections (subset) */
export async function testSyncConnections() {
  const local: {
    success: boolean;
    message: string;
    missing_tables?: string[];
  } = { success: false, message: "" };
  const external: {
    success: boolean;
    message: string;
    orders_count?: number;
    return_orders_count?: number;
  } = { success: false, message: "" };

  try {
    const required = [
      "shipments",
      "shipment_tracking",
      "shipway_tracking_cache",
      "shipway_webhook_logs",
    ];
    const missing: string[] = [];
    for (const table of required) {
      const rows = await prisma.$queryRawUnsafe<Array<{ c: number }>>(
        `SELECT COUNT(*) AS c FROM information_schema.tables
         WHERE table_schema = DATABASE() AND table_name = ?`,
        table,
      );
      if (Number(rows[0]?.c ?? 0) === 0) missing.push(table);
    }
    if (missing.length) {
      local.success = false;
      local.message = "Local DB connected but missing tables";
      local.missing_tables = missing;
    } else {
      local.success = true;
      local.message = "Local DB OK";
    }
  } catch (error) {
    local.success = false;
    local.message =
      error instanceof Error ? error.message : "Local DB connection failed";
  }

  try {
    const orders = await queryExternalShipway<{ c: number }[]>(
      "SELECT COUNT(*) AS c FROM orders WHERE awb_number IS NOT NULL AND awb_number != ''",
    );
    const returns = await queryExternalShipway<{ c: number }[]>(
      "SELECT COUNT(*) AS c FROM shipway_return_orders WHERE tracking_number IS NOT NULL AND tracking_number != ''",
    );
    external.success = true;
    external.message = "External Shipway DB OK";
    external.orders_count = Number(orders[0]?.c ?? 0);
    external.return_orders_count = Number(returns[0]?.c ?? 0);
  } catch (error) {
    external.success = false;
    external.message =
      error instanceof Error
        ? error.message
        : "External Shipway DB connection failed";
  }

  return { local, external };
}

/** Lightweight stats for cron --stats */
export async function getCronSyncStats() {
  const trackingStats = await getTrackingStats();

  let recentWebhooks: Array<{
    awb_number: string;
    processed: number | boolean | null;
    processing_error: string | null;
    created_at: Date | string | null;
  }> = [];

  try {
    recentWebhooks = await prisma.$queryRaw`
      SELECT awb_number, processed, processing_error, created_at
      FROM shipway_webhook_logs
      ORDER BY created_at DESC
      LIMIT 10
    `;
  } catch {
    recentWebhooks = [];
  }

  return {
    tracking_stats: trackingStats,
    recent_webhooks: recentWebhooks,
  };
}
