import { prisma } from "@/lib/db";
import { lookupAwbStatusesFromExternal } from "@/lib/admin/external-shipment-sync";
import { getShipmentTracking, updateShipmentStatus } from "@/lib/admin/shipments";

export type StatusCount = {
  shipment_status: string;
  count: number;
};

export type ApiStatRow = {
  date: string;
  total_calls: number;
  successful_calls: number;
  failed_calls: number;
  avg_response_time: number | null;
};

export type PendingShipment = {
  awb_number: string;
  shipment_id: number;
  courier_partner: string;
  shipment_status: string | null;
};

/** Port of ShipwayService::validateAWBNumber */
export function validateAwbNumber(awbNumber: string): boolean {
  if (!awbNumber || typeof awbNumber !== "string") return false;
  let awb = awbNumber.trim().replace(/^#/, "");
  if (awb.length < 3 || awb.length > 30) return false;
  if (!/^[A-Za-z0-9\-_#.]+$/.test(awb)) return false;

  const courierPatterns: Record<string, RegExp> = {
    BD: /^BD\d{10}$/,
    DT: /^DT\d{10}$/,
    DL: /^DL\d{10}$/,
    EC: /^EC\d{10}$/,
    SW: /^SW\d{10}$/,
  };
  const prefix = awb.slice(0, 2).toUpperCase();
  if (courierPatterns[prefix]) {
    return courierPatterns[prefix]!.test(awb);
  }
  if (/^\d+$/.test(awb)) {
    return awb.length >= 6 && awb.length <= 25;
  }
  if (/^[A-Za-z0-9]+$/.test(awb)) {
    return awb.length >= 6 && awb.length <= 25;
  }
  return true;
}

/** Port of ShipwayService::getTrackingStats */
export async function getTrackingStats() {
  try {
    const [shipmentStatus, cacheRows] = await Promise.all([
      prisma.$queryRaw<StatusCount[]>`
        SELECT shipment_status, COUNT(*) AS count
        FROM shipments
        WHERE shipment_status IS NOT NULL AND shipment_status != ''
        GROUP BY shipment_status
        ORDER BY count DESC
      `,
      prisma.$queryRaw<
        Array<{ total_cached: bigint | number; active_cache: bigint | number }>
      >`
        SELECT
          COUNT(*) AS total_cached,
          SUM(CASE WHEN expires_at > NOW() THEN 1 ELSE 0 END) AS active_cache
        FROM shipway_tracking_cache
      `,
    ]);

    return {
      shipment_status: shipmentStatus.map((r) => ({
        shipment_status: r.shipment_status,
        count: Number(r.count),
      })),
      cache_stats: {
        total_cached: Number(cacheRows[0]?.total_cached ?? 0),
        active_cache: Number(cacheRows[0]?.active_cache ?? 0),
      },
    };
  } catch (error) {
    console.error("[getTrackingStats]", error);
    return {
      shipment_status: [] as Array<{ shipment_status: string; count: number }>,
      cache_stats: { total_cached: 0, active_cache: 0 },
    };
  }
}

/** Port of ShipwayService::getApiStats */
export async function getApiStats(days = 7): Promise<ApiStatRow[]> {
  const safeDays = Math.min(90, Math.max(1, Math.floor(days)));
  try {
    const rows = await prisma.$queryRawUnsafe<
      Array<{
        date: Date | string;
        total_calls: bigint | number;
        successful_calls: bigint | number;
        failed_calls: bigint | number;
        avg_response_time: number | null;
      }>
    >(
      `
      SELECT
        DATE(created_at) AS date,
        COUNT(*) AS total_calls,
        SUM(CASE WHEN is_success = 1 THEN 1 ELSE 0 END) AS successful_calls,
        SUM(CASE WHEN is_success = 0 THEN 1 ELSE 0 END) AS failed_calls,
        AVG(response_time_ms) AS avg_response_time
      FROM shipway_api_logs
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
      GROUP BY DATE(created_at)
      ORDER BY date DESC
      `,
      safeDays,
    );

    return rows.map((r) => ({
      date:
        r.date instanceof Date
          ? r.date.toISOString().slice(0, 10)
          : String(r.date).slice(0, 10),
      total_calls: Number(r.total_calls),
      successful_calls: Number(r.successful_calls),
      failed_calls: Number(r.failed_calls),
      avg_response_time:
        r.avg_response_time == null ? null : Number(r.avg_response_time),
    }));
  } catch (error) {
    console.error("[getApiStats]", error);
    return [];
  }
}

/** Port of ShipwayService::getShipmentsForUpdate */
export async function getShipmentsForUpdate(
  limit = 20,
): Promise<PendingShipment[]> {
  try {
    return await prisma.$queryRaw<PendingShipment[]>`
      SELECT s.awb_number, s.shipment_id, s.courier_partner, s.shipment_status
      FROM shipments s
      LEFT JOIN shipway_tracking_cache c ON s.awb_number = c.awb_number
      WHERE s.shipment_status NOT IN ('delivered', 'returned', 'cancelled')
        AND (c.expires_at IS NULL OR c.expires_at < NOW())
      ORDER BY s.updated_at ASC
      LIMIT ${limit}
    `;
  } catch (error) {
    console.error("[getShipmentsForUpdate]", error);
    return [];
  }
}

async function readTrackingCache(awb: string) {
  try {
    const rows = await prisma.$queryRaw<
      Array<{ tracking_data: string | null; expires_at: Date | string | null }>
    >`
      SELECT tracking_data, expires_at
      FROM shipway_tracking_cache
      WHERE awb_number = ${awb}
        AND (expires_at IS NULL OR expires_at > NOW())
      LIMIT 1
    `;
    const row = rows[0];
    if (!row?.tracking_data) return null;
    try {
      return JSON.parse(row.tracking_data) as unknown;
    } catch {
      return row.tracking_data;
    }
  } catch {
    return null;
  }
}

async function writeTrackingCache(
  awb: string,
  data: unknown,
  shipmentType: "forward" | "reverse" = "forward",
  externalStatus?: string | null,
  mappedStatus?: string | null,
) {
  try {
    const payload = JSON.stringify(data);
    await prisma.$executeRaw`
      INSERT INTO shipway_tracking_cache (
        awb_number, shipment_type, external_status, mapped_status,
        tracking_data, expires_at, last_synced_at, created_at, updated_at
      ) VALUES (
        ${awb}, ${shipmentType}, ${externalStatus ?? null}, ${mappedStatus ?? null},
        ${payload}, DATE_ADD(NOW(), INTERVAL 6 HOUR), NOW(), NOW(), NOW()
      )
      ON DUPLICATE KEY UPDATE
        external_status = VALUES(external_status),
        mapped_status = VALUES(mapped_status),
        tracking_data = VALUES(tracking_data),
        expires_at = VALUES(expires_at),
        last_synced_at = NOW(),
        updated_at = NOW()
    `;
  } catch (error) {
    console.error("[writeTrackingCache]", error);
  }
}

/**
 * Practical port of fetchTrackingStatus:
 * cache → external Shipway DB → local shipment_tracking fallback.
 * Also syncs mapped status onto the shipments row when possible.
 */
export async function fetchTrackingStatus(awbNumber: string) {
  const awb = awbNumber.trim().replace(/^#/, "");
  if (!validateAwbNumber(awb)) {
    return {
      success: false as const,
      error: "Invalid AWB number format",
      data: null,
    };
  }

  const cached = await readTrackingCache(awb);
  if (cached) {
    return {
      success: true as const,
      data: cached,
      cached: true,
      source: "database_cache",
    };
  }

  const external = await lookupAwbStatusesFromExternal([awb]);
  const status = external[awb];

  if (status && status.display_status !== "N/A") {
    const data = {
      awb_number: awb,
      display_status: status.display_status,
      mapped_status: status.mapped_status,
      type: status.type,
      courier: status.courier,
      last_updated: status.last_updated,
      raw_status: status.raw_status,
      needs_action: status.needs_action,
    };

    await writeTrackingCache(
      awb,
      data,
      status.type === "reverse" ? "reverse" : "forward",
      status.display_status,
      status.mapped_status,
    );

    if (status.mapped_status) {
      await updateShipmentStatus({
        awbNumber: awb,
        statusCode: status.mapped_status,
        statusMessage: status.display_status,
        courierStatus: status.courier ?? undefined,
        remarks: "Synced from external Shipway DB",
      }).catch(() => null);
    }

    return {
      success: true as const,
      data,
      cached: false,
      source: "external_db",
    };
  }

  const local = await getShipmentTracking(awb);
  if (local.success) {
    const data = {
      awb_number: awb,
      shipment: local.shipment,
      history: local.history,
      display_status: local.shipment.shipment_status,
      source: "local_db",
    };
    return {
      success: true as const,
      data,
      cached: false,
      source: "local_fallback",
    };
  }

  return {
    success: false as const,
    error: "No tracking data found for this AWB",
    data: null,
  };
}

/** Port of getShipmentHistory (local DB; optional live refresh) */
export async function getShipmentHistory(awbNumber: string) {
  const awb = awbNumber.trim().replace(/^#/, "");
  if (!validateAwbNumber(awb)) {
    return {
      success: false as const,
      error: "Invalid AWB number format",
      data: null,
    };
  }

  const local = await getShipmentTracking(awb);
  if (!local.success) {
    return { success: false as const, error: local.error, data: null };
  }

  const apiResponse = await fetchTrackingStatus(awb);

  return {
    success: true as const,
    data: {
      shipment_info: local.shipment,
      tracking_history: local.history,
      api_data: apiResponse.success ? apiResponse.data : null,
      last_updated: new Date().toISOString().slice(0, 19).replace("T", " "),
    },
  };
}

/** Port of bulkUpdateShipments */
export async function bulkUpdateShipments(awbNumbers: string[]) {
  const results = {
    total: awbNumbers.length,
    success: 0,
    failed: 0,
    errors: [] as string[],
  };

  for (const raw of awbNumbers) {
    const awb = String(raw ?? "").trim();
    try {
      const response = await fetchTrackingStatus(awb);
      if (response.success) {
        results.success++;
      } else {
        results.failed++;
        results.errors.push(`AWB ${awb}: ${response.error ?? "Unknown error"}`);
      }
      await new Promise((r) => setTimeout(r, 80));
    } catch (error) {
      results.failed++;
      results.errors.push(
        `AWB ${awb}: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  return results;
}

export async function getTrackingPageData() {
  const [trackingStats, apiStats, shipmentsForUpdate] = await Promise.all([
    getTrackingStats(),
    getApiStats(7),
    getShipmentsForUpdate(20),
  ]);
  return { trackingStats, apiStats, shipmentsForUpdate };
}
