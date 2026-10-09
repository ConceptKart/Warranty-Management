/**
 * Full port of ExternalShipmentSyncService core paths:
 * syncLocalFromLookup, processForward/Reverse, syncActive/Changed/Full.
 */

import { prisma } from "@/lib/db";
import { queryExternalShipway } from "@/lib/db-external-shipway";
import {
  mapForwardStatus,
  mapReverseStatus,
} from "@/lib/admin/external-shipment-sync";
import { updateTicketWorkflowStatusGuarded } from "@/lib/admin/shipway-status-sync";
import { sendForStatus } from "@/lib/email/email-service";

const BATCH_SIZE = Math.min(
  500,
  Math.max(1, Number(process.env.SHIPWAY_SYNC_BATCH_SIZE || "200") || 200),
);

/** mysql2 prepared statements often reject LIMIT/OFFSET placeholders on Hostinger. */
function safeLimit(n: number) {
  return Math.min(500, Math.max(1, Math.floor(Number(n) || 1)));
}

function safeOffset(n: number) {
  return Math.max(0, Math.floor(Number(n) || 0));
}

const FORWARD_TERMINAL = new Set(["delivered"]);
const REVERSE_TERMINAL = new Set(["return_delivered", "return_cancelled"]);

type SyncResults = {
  mode: string;
  started_at: string;
  completed_at?: string;
  forward_processed: number;
  forward_updated: number;
  forward_skipped: number;
  forward_errors: number;
  reverse_processed: number;
  reverse_updated: number;
  reverse_skipped: number;
  reverse_errors: number;
  errors: string[];
};

function nowSql() {
  return new Date().toISOString().slice(0, 19).replace("T", " ");
}

function emptyResults(mode: string): SyncResults {
  return {
    mode,
    started_at: nowSql(),
    forward_processed: 0,
    forward_updated: 0,
    forward_skipped: 0,
    forward_errors: 0,
    reverse_processed: 0,
    reverse_updated: 0,
    reverse_skipped: 0,
    reverse_errors: 0,
    errors: [],
  };
}

function isTerminalStatus(mappedStatus: string | null | undefined, type: string) {
  if (!mappedStatus) return false;
  return type === "reverse"
    ? REVERSE_TERMINAL.has(mappedStatus)
    : FORWARD_TERMINAL.has(mappedStatus);
}

const LOCK_KEY = "sync_running";
const LOCK_TTL_MINUTES = 2;

/** In-process lock — avoids overlapping syncs in the same Next.js server. */
let memoryLockHeld = false;

function formatSqlDateTime(value: string | Date | null | undefined): string | null {
  if (value == null) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())} ${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}`;
  }
  const s = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    return s.slice(0, 19).replace("T", " ");
  }
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) {
    return formatSqlDateTime(d);
  }
  return null;
}

/**
 * Prisma connection pooling breaks MySQL GET_LOCK (session-scoped).
 * Use a short-TTL row lock + in-memory lock. Stale locks auto-expire (hot reload safe).
 */
async function acquireLock(): Promise<boolean> {
  if (memoryLockHeld) return false;

  try {
    await prisma.$executeRawUnsafe(
      `INSERT INTO shipway_sync_state (sync_key, last_sync_value, updated_at)
       VALUES (?, '0', NOW())
       ON DUPLICATE KEY UPDATE sync_key = sync_key`,
      LOCK_KEY,
    );

    const affected = await prisma.$executeRawUnsafe(
      `UPDATE shipway_sync_state
       SET last_sync_value = '1', updated_at = NOW()
       WHERE sync_key = ?
         AND (
           last_sync_value IS NULL
           OR last_sync_value IN ('0', '')
           OR updated_at < DATE_SUB(NOW(), INTERVAL ${LOCK_TTL_MINUTES} MINUTE)
         )`,
      LOCK_KEY,
    );

    if (Number(affected) <= 0) {
      return false;
    }

    memoryLockHeld = true;
    return true;
  } catch (error) {
    console.error(
      "[acquireLock] falling back to unlocked sync:",
      error instanceof Error ? error.message : error,
    );
    memoryLockHeld = true;
    return true;
  }
}

async function releaseLock(): Promise<void> {
  memoryLockHeld = false;
  try {
    await prisma.$executeRawUnsafe(
      `UPDATE shipway_sync_state
       SET last_sync_value = '0', updated_at = NOW()
       WHERE sync_key = ?`,
      LOCK_KEY,
    );
  } catch (error) {
    console.error(
      "[releaseLock]",
      error instanceof Error ? error.message : error,
    );
  }
}

async function getWatermark(key: string): Promise<string> {
  try {
    const rows = await prisma.$queryRawUnsafe<
      Array<{ last_sync_value: string }>
    >("SELECT last_sync_value FROM shipway_sync_state WHERE sync_key = ?", key);
    const raw = rows[0]?.last_sync_value?.trim() || "";
    const formatted = formatSqlDateTime(raw);
    // Reject corrupted JS Date strings like "Sat Feb 21 2026 14:"
    if (formatted && /^\d{4}-\d{2}-\d{2} /.test(formatted)) {
      return formatted;
    }
    return "2020-01-01 00:00:00";
  } catch {
    return "2020-01-01 00:00:00";
  }
}

async function setWatermark(key: string, value: string): Promise<void> {
  try {
    await prisma.$executeRawUnsafe(
      `UPDATE shipway_sync_state
       SET last_sync_value = ?, updated_at = NOW()
       WHERE sync_key = ?`,
      value,
      key,
    );
  } catch (error) {
    console.error("[setWatermark]", key, error);
  }
}

async function logSyncActivity(
  awb: string | null,
  action: string,
  data: unknown,
  success: boolean,
  errorMsg: string | null,
): Promise<void> {
  try {
    await prisma.$executeRawUnsafe(
      `INSERT INTO shipway_activity_logs
         (awb_number, action, data, is_success, error_message)
       VALUES (?, ?, ?, ?, ?)`,
      awb,
      action,
      JSON.stringify(data ?? {}),
      success ? 1 : 0,
      errorMsg,
    );
  } catch {
    /* table may be missing on some dumps */
  }
}

async function updateTrackingCache(
  awb: string,
  type: "forward" | "reverse",
  extStatus: string | null,
  mappedStatus: string,
  extUpdatedAt: string | null,
): Promise<void> {
  const trackingJson = JSON.stringify({
    external_status: extStatus,
    mapped_status: mappedStatus,
    synced_at: nowSql(),
  });
  try {
    await prisma.$executeRawUnsafe(
      `INSERT INTO shipway_tracking_cache
         (awb_number, shipment_type, external_status, mapped_status,
          external_updated_at, last_synced_at, tracking_data, expires_at)
       VALUES (?, ?, ?, ?, ?, NOW(), ?, DATE_ADD(NOW(), INTERVAL 1 HOUR))
       ON DUPLICATE KEY UPDATE
         shipment_type = VALUES(shipment_type),
         external_status = VALUES(external_status),
         mapped_status = VALUES(mapped_status),
         external_updated_at = VALUES(external_updated_at),
         last_synced_at = NOW(),
         tracking_data = VALUES(tracking_data),
         expires_at = VALUES(expires_at)`,
      awb,
      type,
      extStatus,
      mappedStatus,
      extUpdatedAt,
      trackingJson,
    );
  } catch (error) {
    console.error("[updateTrackingCache]", awb, error);
  }
}

async function updateShipmentStatusOnly(awb: string, mappedStatus: string) {
  await prisma.$executeRaw`
    UPDATE shipments
    SET shipment_status = ${mappedStatus}, updated_at = NOW()
    WHERE awb_number = ${awb} AND shipment_status != ${mappedStatus}
  `;
}

async function updateTicketShipmentStatusOnly(
  ticketId: number,
  mappedStatus: string,
) {
  await prisma.$executeRaw`
    UPDATE warranty_tickets
    SET shipment_status = ${mappedStatus}
    WHERE ticket_id = ${ticketId} AND (shipment_status IS NULL OR shipment_status != ${mappedStatus})
  `;
}

async function insertTrackingHistory(
  shipmentId: number,
  mappedStatus: string,
  extStatus: string,
  timestamp: string,
  courierName: string,
  remarks: string,
) {
  const isDelivered =
    mappedStatus === "delivered" || mappedStatus === "return_delivered" ? 1 : 0;
  const isException =
    mappedStatus === "undelivered" || mappedStatus === "pickup_exception"
      ? 1
      : 0;
  try {
    await prisma.$executeRaw`
      INSERT INTO shipment_tracking (
        shipment_id, status_code, status_message, location, timestamp,
        courier_status, remarks, is_delivered, is_exception, created_at
      ) VALUES (
        ${shipmentId}, ${mappedStatus}, ${extStatus}, ${""}, ${timestamp},
        ${courierName}, ${remarks}, ${isDelivered}, ${isException}, NOW()
      )
    `;
  } catch (error) {
    console.error("[insertTrackingHistory]", shipmentId, error);
  }
}

async function insertTicketStatusHistory(
  ticketId: number,
  mappedStatus: string,
  awb: string,
  type: "forward" | "reverse",
  extStatus: string,
  extUpdatedAt: string | null,
) {
  try {
    const rows = await prisma.$queryRaw<
      Array<{
        old_status_id: number;
        new_status_id: number;
      }>
    >`
      SELECT wt.status_id AS old_status_id, ts.status_id AS new_status_id
      FROM warranty_tickets wt
      JOIN ticket_statuses ts
        ON ts.status_code = ${mappedStatus}
       AND ts.ticket_type_id = wt.ticket_type_id
      WHERE wt.ticket_id = ${ticketId}
      LIMIT 1
    `;
    const row = rows[0];
    if (!row?.new_status_id) return;
    if (Number(row.old_status_id) === Number(row.new_status_id)) return;

    let changedAt = extUpdatedAt || nowSql();
    if (mappedStatus === "return_delivered" && extUpdatedAt) {
      const d = new Date(extUpdatedAt);
      if (!Number.isNaN(d.getTime())) {
        d.setDate(d.getDate() - 1);
        changedAt = d.toISOString().slice(0, 19).replace("T", " ");
      }
    }

    const dedup = await prisma.$queryRaw<Array<{ c: number }>>`
      SELECT COUNT(*) AS c FROM ticket_status_history
      WHERE ticket_id = ${ticketId}
        AND new_status_id = ${row.new_status_id}
        AND shipment_status = ${mappedStatus}
        AND changed_at = ${changedAt}
    `;
    if (Number(dedup[0]?.c ?? 0) > 0) return;

    const label = type === "reverse" ? "Return Shipment" : "Forward Shipment";
    const notes = `${label} AWB: ${awb} | External: ${extStatus}`;

    await prisma.$executeRaw`
      INSERT INTO ticket_status_history (
        ticket_id, old_status_id, new_status_id, changed_by, change_reason,
        notes, shipment_status, changed_at
      ) VALUES (
        ${ticketId}, ${row.old_status_id}, ${row.new_status_id}, ${"system"},
        ${"Shipment Status Update"}, ${notes}, ${mappedStatus}, ${changedAt}
      )
    `;
  } catch (error) {
    console.error("[insertTicketStatusHistory]", ticketId, error);
  }
}

async function transitionToCaseCompleted(ticketId: number) {
  try {
    const already = await prisma.$queryRaw<Array<{ ticket_id: number }>>`
      SELECT wt.ticket_id
      FROM warranty_tickets wt
      JOIN ticket_statuses ts ON ts.status_id = wt.status_id
      WHERE wt.ticket_id = ${ticketId} AND ts.status_code = 'case_completed'
      LIMIT 1
    `;
    if (already[0]) return;

    await prisma.$executeRaw`
      INSERT INTO ticket_status_history (
        ticket_id, old_status_id, new_status_id, changed_by, change_reason,
        notes, shipment_status, changed_at
      )
      SELECT wt.ticket_id, wt.status_id, ts_cc.status_id, 'system',
             'Auto Case Completion',
             'Forward shipment delivered — ticket automatically transitioned to Case Completed',
             'case_completed', NOW()
      FROM warranty_tickets wt
      JOIN ticket_statuses ts_cc
        ON ts_cc.status_code = 'case_completed'
       AND ts_cc.ticket_type_id = wt.ticket_type_id
      WHERE wt.ticket_id = ${ticketId}
    `;

    await prisma.$executeRaw`
      UPDATE warranty_tickets wt
      JOIN ticket_statuses ts
        ON ts.status_code = 'case_completed'
       AND ts.ticket_type_id = wt.ticket_type_id
      SET wt.status_id = ts.status_id, wt.updated_at = NOW()
      WHERE wt.ticket_id = ${ticketId}
    `;
  } catch (error) {
    console.error("[transitionToCaseCompleted]", ticketId, error);
  }
}

async function sendStatusEmail(ticketId: number, mappedStatus: string) {
  try {
    await sendForStatus(ticketId, mappedStatus);
  } catch (error) {
    console.error("[sendStatusEmail]", ticketId, error);
  }
}

/**
 * Port of syncLocalFromLookup — called when AWB status is looked up.
 * Only mutates ticket workflow when shipment status actually changed.
 */
export async function syncLocalFromLookup(
  awb: string,
  type: "forward" | "reverse",
  extStatus: string,
  mappedStatus: string,
  extUpdatedAt: string | null,
): Promise<void> {
  if (!awb || !mappedStatus) return;

  try {
    await updateTrackingCache(awb, type, extStatus, mappedStatus, extUpdatedAt);

    const shipments = await prisma.$queryRaw<
      Array<{
        shipment_id: number;
        ticket_id: number;
        shipment_status: string | null;
      }>
    >`
      SELECT shipment_id, ticket_id, shipment_status
      FROM shipments WHERE awb_number = ${awb} LIMIT 1
    `;
    const localShipment = shipments[0];

    if (localShipment) {
      const ticketId = Number(localShipment.ticket_id);
      const oldStatus = localShipment.shipment_status;
      if (isTerminalStatus(oldStatus, type)) return;
      if (oldStatus === mappedStatus) return;

      await updateShipmentStatusOnly(awb, mappedStatus);
      await updateTicketShipmentStatusOnly(ticketId, mappedStatus);
      await insertTicketStatusHistory(
        ticketId,
        mappedStatus,
        awb,
        type,
        extStatus,
        extUpdatedAt,
      );
      await updateTicketWorkflowStatusGuarded(ticketId, mappedStatus);
      await sendStatusEmail(ticketId, mappedStatus);
      await logSyncActivity(
        awb,
        "status_lookup_sync",
        {
          old_status: oldStatus,
          new_status: mappedStatus,
          external_status: extStatus,
          type,
        },
        true,
        null,
      );
      if (mappedStatus === "delivered" && type === "forward") {
        await transitionToCaseCompleted(ticketId);
      }
      return;
    }

    // Fallback: warranty_tickets AWB columns
    const tickets = await prisma.$queryRaw<
      Array<{
        ticket_id: number;
        shipment_status: string | null;
      }>
    >`
      SELECT ticket_id, shipment_status
      FROM warranty_tickets
      WHERE awb_number = ${awb} OR reverse_awb_number = ${awb}
      LIMIT 1
    `;
    const ticketRow = tickets[0];
    if (!ticketRow) return;
    if (isTerminalStatus(ticketRow.shipment_status, type)) return;
    if (ticketRow.shipment_status === mappedStatus) return;

    const ticketId = Number(ticketRow.ticket_id);
    await updateTicketShipmentStatusOnly(ticketId, mappedStatus);
    await insertTicketStatusHistory(
      ticketId,
      mappedStatus,
      awb,
      type,
      extStatus,
      extUpdatedAt,
    );
    await sendStatusEmail(ticketId, mappedStatus);
    await logSyncActivity(
      awb,
      "status_lookup_sync_direct",
      {
        old_status: ticketRow.shipment_status,
        new_status: mappedStatus,
        external_status: extStatus,
        type,
      },
      true,
      null,
    );
    await updateTicketWorkflowStatusGuarded(ticketId, mappedStatus);
    if (mappedStatus === "delivered" && type === "forward") {
      await transitionToCaseCompleted(ticketId);
    }
  } catch (error) {
    console.error(
      `[syncLocalFromLookup] AWB ${awb}:`,
      error instanceof Error ? error.message : error,
    );
  }
}

type ForwardRecord = {
  awb_number: string;
  shipment_status?: string | null;
  updated_at?: string | Date | null;
  courier_name?: string | null;
};

type ReverseRecord = {
  tracking_number: string;
  tracking_status?: string | null;
  status?: string | null;
  state_updated_at?: string | Date | null;
  created_at?: string | Date | null;
  tracking_status_checked_at?: string | Date | null;
  carrier?: string | null;
};

async function processForwardRecord(
  record: ForwardRecord,
  mappedStatus: string,
): Promise<"updated" | "skipped_no_match" | "skipped_no_change" | "error"> {
  const awb = record.awb_number ?? "";
  const externalStatus = record.shipment_status ?? "";
  const externalUpdatedAt =
    formatSqlDateTime(record.updated_at) || nowSql();
  const courierName = record.courier_name ?? "";

  try {
    await updateTrackingCache(
      awb,
      "forward",
      externalStatus,
      mappedStatus,
      externalUpdatedAt,
    );

    const local = await prisma.$queryRaw<
      Array<{
        shipment_id: number;
        ticket_id: number;
        shipment_status: string | null;
      }>
    >`
      SELECT shipment_id, ticket_id, shipment_status
      FROM shipments WHERE awb_number = ${awb} LIMIT 1
    `;
    if (!local[0]) {
      await logSyncActivity(
        awb,
        "status_sync_forward",
        { action: "no_local_match", external_status: externalStatus },
        true,
        null,
      );
      return "skipped_no_match";
    }
    if (local[0].shipment_status === mappedStatus) return "skipped_no_change";

    const ticketId = Number(local[0].ticket_id);
    const oldStatus = local[0].shipment_status;
    await updateShipmentStatusOnly(awb, mappedStatus);
    await updateTicketShipmentStatusOnly(ticketId, mappedStatus);

    if (mappedStatus === "delivered" || mappedStatus === "undelivered") {
      await updateTicketWorkflowStatusGuarded(ticketId, mappedStatus);
      if (mappedStatus === "delivered") {
        await transitionToCaseCompleted(ticketId);
      }
    }

    await insertTrackingHistory(
      Number(local[0].shipment_id),
      mappedStatus,
      externalStatus,
      externalUpdatedAt,
      courierName,
      `Synced from external DB: ${externalStatus}`,
    );
    await logSyncActivity(
      awb,
      "status_sync_forward",
      {
        old_status: oldStatus,
        new_status: mappedStatus,
        external_status: externalStatus,
      },
      true,
      null,
    );
    return "updated";
  } catch (error) {
    const msg = error instanceof Error ? error.message : "error";
    await logSyncActivity(
      awb,
      "status_sync_error",
      { direction: "forward", external_status: externalStatus, error: msg },
      false,
      msg,
    );
    return "error";
  }
}

async function processReverseRecord(
  record: ReverseRecord,
  mappedStatus: string,
): Promise<"updated" | "skipped_no_match" | "skipped_no_change" | "error"> {
  const awb = record.tracking_number ?? "";
  const externalStatus = record.tracking_status ?? "";
  let externalUpdatedAt =
    formatSqlDateTime(record.state_updated_at) ||
    formatSqlDateTime(record.created_at) ||
    nowSql();

  if (
    String(record.tracking_status ?? "")
      .trim()
      .toUpperCase() === "RETURN DELIVERED" &&
    record.tracking_status_checked_at
  ) {
    const checked = formatSqlDateTime(record.tracking_status_checked_at);
    if (checked) {
      const d = new Date(checked.replace(" ", "T"));
      if (!Number.isNaN(d.getTime())) {
        d.setDate(d.getDate() - 1);
        externalUpdatedAt = formatSqlDateTime(d) || checked;
      }
    }
  }

  const courierName = record.carrier ?? "";

  try {
    await updateTrackingCache(
      awb,
      "reverse",
      externalStatus,
      mappedStatus,
      externalUpdatedAt,
    );

    const local = await prisma.$queryRaw<
      Array<{
        shipment_id: number;
        ticket_id: number;
        shipment_status: string | null;
      }>
    >`
      SELECT shipment_id, ticket_id, shipment_status
      FROM shipments WHERE awb_number = ${awb} LIMIT 1
    `;
    if (!local[0]) {
      await logSyncActivity(
        awb,
        "status_sync_reverse",
        { action: "no_local_match", external_status: externalStatus },
        true,
        null,
      );
      return "skipped_no_match";
    }
    if (local[0].shipment_status === mappedStatus) return "skipped_no_change";

    const ticketId = Number(local[0].ticket_id);
    const oldStatus = local[0].shipment_status;
    await updateShipmentStatusOnly(awb, mappedStatus);
    await updateTicketShipmentStatusOnly(ticketId, mappedStatus);

    if (
      mappedStatus === "return_delivered" ||
      mappedStatus === "return_cancelled"
    ) {
      await updateTicketWorkflowStatusGuarded(ticketId, mappedStatus);
    }

    await insertTrackingHistory(
      Number(local[0].shipment_id),
      mappedStatus,
      externalStatus || "NULL",
      externalUpdatedAt,
      courierName,
      `Synced from external DB: ${externalStatus || "NULL"}`,
    );
    await logSyncActivity(
      awb,
      "status_sync_reverse",
      {
        old_status: oldStatus,
        new_status: mappedStatus,
        external_status: externalStatus,
      },
      true,
      null,
    );
    return "updated";
  } catch (error) {
    const msg = error instanceof Error ? error.message : "error";
    await logSyncActivity(
      awb,
      "status_sync_error",
      { direction: "reverse", external_status: externalStatus, error: msg },
      false,
      msg,
    );
    return "error";
  }
}

function tally(
  results: SyncResults,
  direction: "forward" | "reverse",
  outcome: string,
) {
  if (direction === "forward") {
    results.forward_processed++;
    if (outcome === "updated") results.forward_updated++;
    else if (outcome === "error") results.forward_errors++;
    else results.forward_skipped++;
  } else {
    results.reverse_processed++;
    if (outcome === "updated") results.reverse_updated++;
    else if (outcome === "error") results.reverse_errors++;
    else results.reverse_skipped++;
  }
}

/** Port of syncActiveShipments — pull non-terminal from external DB */
export async function syncActiveShipmentsFromExternal(): Promise<SyncResults> {
  const results = emptyResults("active_only");
  if (!(await acquireLock())) {
    results.errors.push("Could not acquire sync lock — another sync may be running");
    results.completed_at = nowSql();
    return results;
  }

  try {
    const forwardOrders = await queryExternalShipway<ForwardRecord[]>(
      `SELECT * FROM orders
       WHERE awb_number IS NOT NULL AND awb_number != ''
         AND (shipment_status IS NULL OR shipment_status NOT IN ('DELIVERED'))
       ORDER BY updated_at ASC
       LIMIT ${safeLimit(BATCH_SIZE)}`,
    );
    for (const record of forwardOrders) {
      const mapped = mapForwardStatus(record.shipment_status ?? "");
      const outcome = await processForwardRecord(record, mapped);
      tally(results, "forward", outcome);
    }

    const reverseOrders = await queryExternalShipway<ReverseRecord[]>(
      `SELECT * FROM shipway_return_orders
       WHERE tracking_number IS NOT NULL AND tracking_number != ''
         AND (tracking_status IS NULL
              OR tracking_status NOT IN ('RETURN DELIVERED', 'RETURN CANCELLED'))
       ORDER BY COALESCE(state_updated_at, created_at) ASC
       LIMIT ${safeLimit(BATCH_SIZE)}`,
    );
    for (const record of reverseOrders) {
      const mapped = mapReverseStatus(
        record.tracking_status,
        record.status,
      );
      const outcome = await processReverseRecord(record, mapped);
      tally(results, "reverse", outcome);
    }

    await logSyncActivity(null, "status_sync_complete", results, true, null);
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Sync failed";
    results.errors.push(msg);
    await logSyncActivity(
      null,
      "status_sync_error",
      { mode: "active_only", error: msg },
      false,
      msg,
    );
  } finally {
    await releaseLock();
  }

  results.completed_at = nowSql();
  return results;
}

/** Port of syncAllChanged — watermark incremental */
export async function syncAllChanged(): Promise<SyncResults> {
  const results = emptyResults("incremental");
  if (!(await acquireLock())) {
    results.errors.push("Could not acquire sync lock — another sync may be running");
    results.completed_at = nowSql();
    return results;
  }

  try {
    const forwardWatermark = await getWatermark("forward_last_updated_at");
    const reverseWatermark = await getWatermark(
      "reverse_last_state_updated_at",
    );
    await logSyncActivity(
      null,
      "status_sync_start",
      {
        mode: "incremental",
        forward_watermark: forwardWatermark,
        reverse_watermark: reverseWatermark,
      },
      true,
      null,
    );

    let highestForward = forwardWatermark;
    const forwardOrders = await queryExternalShipway<ForwardRecord[]>(
      `SELECT * FROM orders
       WHERE updated_at > ? AND awb_number IS NOT NULL AND awb_number != ''
       ORDER BY updated_at ASC LIMIT ${safeLimit(BATCH_SIZE)}`,
      [forwardWatermark],
    );
    for (const record of forwardOrders) {
      const mapped = mapForwardStatus(record.shipment_status ?? "");
      const outcome = await processForwardRecord(record, mapped);
      tally(results, "forward", outcome);
      const ts = formatSqlDateTime(record.updated_at);
      if (ts && ts > highestForward) highestForward = ts;
    }
    if (highestForward !== forwardWatermark) {
      await setWatermark("forward_last_updated_at", highestForward);
    }

    let highestReverse = reverseWatermark;
    const reverseOrders = await queryExternalShipway<ReverseRecord[]>(
      `SELECT * FROM shipway_return_orders
       WHERE (state_updated_at > ? OR (state_updated_at IS NULL AND created_at > ?))
         AND tracking_number IS NOT NULL AND tracking_number != ''
       ORDER BY COALESCE(state_updated_at, created_at) ASC
       LIMIT ${safeLimit(BATCH_SIZE)}`,
      [reverseWatermark, reverseWatermark],
    );
    for (const record of reverseOrders) {
      const mapped = mapReverseStatus(
        record.tracking_status,
        record.status,
      );
      const outcome = await processReverseRecord(record, mapped);
      tally(results, "reverse", outcome);
      const ts =
        formatSqlDateTime(record.state_updated_at) ||
        formatSqlDateTime(record.created_at);
      if (ts && ts > highestReverse) highestReverse = ts;
    }
    if (highestReverse !== reverseWatermark) {
      await setWatermark("reverse_last_state_updated_at", highestReverse);
    }

    await logSyncActivity(null, "status_sync_complete", results, true, null);
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Sync failed";
    results.errors.push(msg);
    await logSyncActivity(
      null,
      "status_sync_error",
      { mode: "incremental", error: msg },
      false,
      msg,
    );
  } finally {
    await releaseLock();
  }

  results.completed_at = nowSql();
  return results;
}

/** Port of syncFullReconciliation — ignore watermarks, scan all */
export async function syncFullReconciliation(): Promise<SyncResults> {
  const results = emptyResults("full_reconciliation");
  if (!(await acquireLock())) {
    results.errors.push("Could not acquire sync lock — another sync may be running");
    results.completed_at = nowSql();
    return results;
  }

  try {
    await logSyncActivity(
      null,
      "status_sync_start",
      { mode: "full_reconciliation" },
      true,
      null,
    );

    let highestForward = "2000-01-01 00:00:00";
    let offset = 0;
    let batch: ForwardRecord[] = [];
    do {
      batch = await queryExternalShipway<ForwardRecord[]>(
        `SELECT * FROM orders
         WHERE awb_number IS NOT NULL AND awb_number != ''
         ORDER BY updated_at ASC
         LIMIT ${safeLimit(BATCH_SIZE)} OFFSET ${safeOffset(offset)}`,
      );
      for (const record of batch) {
        const mapped = mapForwardStatus(record.shipment_status ?? "");
        const outcome = await processForwardRecord(record, mapped);
        tally(results, "forward", outcome);
        const ts = formatSqlDateTime(record.updated_at);
        if (ts && ts > highestForward) highestForward = ts;
      }
      offset += BATCH_SIZE;
    } while (batch.length === BATCH_SIZE);

    let highestReverse = "2000-01-01 00:00:00";
    offset = 0;
    let revBatch: ReverseRecord[] = [];
    do {
      revBatch = await queryExternalShipway<ReverseRecord[]>(
        `SELECT * FROM shipway_return_orders
         WHERE tracking_number IS NOT NULL AND tracking_number != ''
         ORDER BY COALESCE(state_updated_at, created_at) ASC
         LIMIT ${safeLimit(BATCH_SIZE)} OFFSET ${safeOffset(offset)}`,
      );
      for (const record of revBatch) {
        const mapped = mapReverseStatus(
          record.tracking_status,
          record.status,
        );
        const outcome = await processReverseRecord(record, mapped);
        tally(results, "reverse", outcome);
        const ts =
          formatSqlDateTime(record.state_updated_at) ||
          formatSqlDateTime(record.created_at);
        if (ts && ts > highestReverse) highestReverse = ts;
      }
      offset += BATCH_SIZE;
    } while (revBatch.length === BATCH_SIZE);

    if (highestForward !== "2000-01-01 00:00:00") {
      await setWatermark("forward_last_updated_at", highestForward);
    }
    if (highestReverse !== "2000-01-01 00:00:00") {
      await setWatermark("reverse_last_state_updated_at", highestReverse);
    }

    await logSyncActivity(null, "status_sync_complete", results, true, null);
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Sync failed";
    results.errors.push(msg);
    await logSyncActivity(
      null,
      "status_sync_error",
      { mode: "full_reconciliation", error: msg },
      false,
      msg,
    );
  } finally {
    await releaseLock();
  }

  results.completed_at = nowSql();
  return results;
}
