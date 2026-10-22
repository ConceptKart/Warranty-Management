import { queryExternalShipway } from "@/lib/db-external-shipway";
import { fetchShipwayLiveAwbStatus } from "@/lib/admin/shipway-tracker";
import { nowIstSql } from "@/lib/datetime/ist";

export type AwbStatusResult = {
  display_status: string;
  mapped_status: string | null;
  type: "forward" | "reverse" | null;
  courier: string | null;
  last_updated: string | null;
  needs_action: boolean;
  raw_status: string | null;
  locked?: boolean;
};

const FORWARD_MAPPINGS: Record<string, string> = {
  DELIVERED: "delivered",
  "AWB ASSIGNED": "awb_assigned_forward",
  "IN TRANSIT": "in_transit",
  "OUT FOR DELIVERY": "out_for_delivery",
  UNDELIVERED: "undelivered",
  "OUT FOR PICKUP": "out_for_pickup",
  "PICKUP EXCEPTION": "pickup_exception",
  "CUSTOMER NOT AVAILABLE": "undelivered",
  "ENTRY RESTRICTED AREA": "undelivered",
  "PICKUP GENERATED": "pickup_generated",
  DELAYED: "delayed",
  "CUSTOMER REFUSED - OTP VERIFIED": "undelivered",
  "REACHED AT DESTINATION HUB": "reached_at_destination_hub",
};

const REVERSE_MAPPINGS: Record<string, string> = {
  "RETURN DELIVERED": "return_delivered",
  "RETURN CANCELLED": "return_cancelled",
  "RETURN IN TRANSIT": "return_in_transit",
  "RETURN OUT FOR PICKUP": "return_out_for_pickup",
  "RETURN PICKUP GENERATED": "return_pickup_generated",
  "AWB ASSIGNED": "awb_assigned_return",
  "PICKUP SCHEDULED": "return_pickup_generated",
  RPSH: "return_in_transit",
  ROOD: "return_out_for_pickup",
  RINT: "return_in_transit",
  RTD: "return_delivered",
  RTO: "return_in_transit",
  RPUP: "return_in_transit",
  RPOD: "return_out_for_pickup",
};

const REVERSE_COURIER_CODES = new Set([
  "RPSH",
  "ROOD",
  "RINT",
  "RTD",
  "RTO",
  "RPUP",
  "RPOD",
]);

const KNOWN_FORWARD = new Set(Object.keys(FORWARD_MAPPINGS));
const KNOWN_REVERSE = new Set([
  "RETURN DELIVERED",
  "RETURN CANCELLED",
  "RETURN IN TRANSIT",
  "RETURN OUT FOR PICKUP",
  "RETURN PICKUP GENERATED",
  "AWB ASSIGNED",
  "PICKUP SCHEDULED",
  "RINT",
  "RTD",
  "RTO",
  "RPUP",
  "RPOD",
]);
const NEGLECTED_REVERSE = new Set(["RPSH", "ROOD"]);

export function looksLikeReverseStatus(status: string | null | undefined) {
  const normalized = (status ?? "").trim().toUpperCase();
  if (!normalized) return false;
  return (
    normalized.startsWith("RETURN") ||
    REVERSE_COURIER_CODES.has(normalized) ||
    NEGLECTED_REVERSE.has(normalized)
  );
}

export function mapForwardStatus(status: string | null | undefined) {
  if (!status?.trim()) return "awb_assigned_forward";
  const normalized = status.trim().toUpperCase();
  return FORWARD_MAPPINGS[normalized] ?? "awb_assigned_forward";
}

export function mapReverseStatus(
  trackingStatus: string | null | undefined,
  rmaStatus: string | null | undefined,
) {
  if (!trackingStatus?.trim()) {
    const rmaLower = (rmaStatus ?? "").trim().toLowerCase();
    if (rmaLower === "return cancelled" || rmaLower === "cancelled") {
      return "return_cancelled";
    }
    if (rmaLower === "rejected") return "rejected";
    return "pending";
  }
  const normalized = trackingStatus.trim().toUpperCase();
  return REVERSE_MAPPINGS[normalized] ?? "pending";
}

type ForwardRow = {
  awb_number: string;
  shipment_status: string | null;
  courier_name: string | null;
  updated_at: Date | string | null;
};
type ReverseRow = {
  tracking_number: string;
  tracking_status: string | null;
  carrier: string | null;
  state_updated_at: Date | string | null;
  status: string | null;
};

function classifyFromRecords(
  forwardRecord?: ForwardRow,
  reverseRecord?: ReverseRow,
  expectedType?: "forward" | "reverse",
): AwbStatusResult {
  const ordersStatus = forwardRecord?.shipment_status ?? "";
  const useReverse =
    expectedType === "reverse" ||
    Boolean(reverseRecord) ||
    looksLikeReverseStatus(ordersStatus);

  if (useReverse) {
    const externalStatus =
      reverseRecord?.tracking_status?.trim() &&
      reverseRecord.tracking_status.trim().toUpperCase() !== "NULL"
        ? reverseRecord.tracking_status
        : ordersStatus;
    const normalized = externalStatus?.trim().toUpperCase() ?? "";
    const rmaStatus = reverseRecord?.status ?? null;
    let displayStatus = "N/A";
    let needsAction = false;
    let mappedStatus: string | null = null;

    if (!externalStatus?.trim() || normalized === "NULL") {
      displayStatus = "N/A";
    } else if (NEGLECTED_REVERSE.has(normalized)) {
      displayStatus = "N/A";
      needsAction = true;
    } else if (KNOWN_REVERSE.has(normalized) || normalized.startsWith("RETURN")) {
      displayStatus = normalized;
      mappedStatus = mapReverseStatus(externalStatus, rmaStatus);
      if (!REVERSE_MAPPINGS[normalized] && normalized.startsWith("RETURN")) {
        mappedStatus = "return_in_transit";
      }
    } else {
      displayStatus = normalized;
      mappedStatus = mapReverseStatus(externalStatus, rmaStatus);
      needsAction = mappedStatus === "pending";
    }

    return {
      display_status: displayStatus,
      mapped_status: mappedStatus,
      type: "reverse",
      courier: reverseRecord?.carrier ?? forwardRecord?.courier_name ?? "",
      last_updated: reverseRecord?.state_updated_at
        ? String(reverseRecord.state_updated_at)
        : forwardRecord?.updated_at
          ? String(forwardRecord.updated_at)
          : null,
      needs_action: needsAction,
      raw_status: externalStatus,
    };
  }

  if (forwardRecord) {
    const externalStatus = forwardRecord.shipment_status ?? "";
    const normalized = externalStatus.trim().toUpperCase();
    let displayStatus = "N/A";
    let needsAction = false;
    let mappedStatus: string | null = null;

    if (!externalStatus.trim()) {
      displayStatus = "N/A";
    } else if (KNOWN_FORWARD.has(normalized)) {
      displayStatus = normalized;
      mappedStatus = mapForwardStatus(externalStatus);
    } else {
      displayStatus = normalized;
      mappedStatus = mapForwardStatus(externalStatus);
      needsAction = true;
    }

    return {
      display_status: displayStatus,
      mapped_status: mappedStatus,
      type: "forward",
      courier: forwardRecord.courier_name ?? "",
      last_updated: forwardRecord.updated_at
        ? String(forwardRecord.updated_at)
        : null,
      needs_action: needsAction,
      raw_status: externalStatus,
    };
  }

  return {
    display_status: "N/A",
    mapped_status: null,
    type: null,
    courier: null,
    last_updated: null,
    needs_action: false,
    raw_status: null,
  };
}

async function persistLookup(
  awb: string,
  result: AwbStatusResult,
  syncLocalFromLookup: ((
    awb: string,
    type: "forward" | "reverse",
    externalStatus: string,
    mappedStatus: string,
    updatedAt: string | null,
  ) => Promise<unknown>) | null,
) {
  if (!syncLocalFromLookup || !result.mapped_status || !result.type) return;
  await syncLocalFromLookup(
    awb,
    result.type,
    result.raw_status ?? "",
    result.mapped_status,
    result.last_updated ?? (result.type === "reverse" ? nowSqlFallback() : null),
  );
}

/**
 * Port of ExternalShipmentSyncService::lookupAwbStatusesFromExternal.
 * When persist=true (default), also runs syncLocalFromLookup like PHP.
 * Replica miss / N/A falls back to live Shipway API (same source as the dashboard).
 */
export async function lookupAwbStatusesFromExternal(
  awbNumbers: string[],
  options?: {
    persist?: boolean;
    expectedTypes?: Record<string, "forward" | "reverse">;
  },
): Promise<Record<string, AwbStatusResult>> {
  const persist = options?.persist !== false;
  const expectedTypes = options?.expectedTypes ?? {};
  const unique = [...new Set(awbNumbers.map((a) => a.trim()).filter(Boolean))];
  const results: Record<string, AwbStatusResult> = {};
  if (unique.length === 0) return results;

  const placeholders = unique.map(() => "?").join(",");

  let forwardData: Record<string, ForwardRow> = {};
  let reverseData: Record<string, ReverseRow> = {};

  try {
    const forwardRows = await queryExternalShipway<ForwardRow[]>(
      `SELECT awb_number, shipment_status, courier_name, updated_at
       FROM orders WHERE awb_number IN (${placeholders})`,
      unique,
    );
    forwardData = Object.fromEntries(
      forwardRows.map((row) => [row.awb_number, row]),
    );
  } catch (error) {
    console.error("lookupAwbStatusesFromExternal forward:", error);
  }

  try {
    const reverseRows = await queryExternalShipway<ReverseRow[]>(
      `SELECT tracking_number, tracking_status, carrier, state_updated_at, status
       FROM shipway_return_orders WHERE tracking_number IN (${placeholders})`,
      unique,
    );
    reverseData = Object.fromEntries(
      reverseRows.map((row) => [row.tracking_number, row]),
    );
  } catch (error) {
    console.error("lookupAwbStatusesFromExternal reverse:", error);
  }

  const { syncLocalFromLookup } = persist
    ? await import("@/lib/admin/external-shipment-sync-service")
    : { syncLocalFromLookup: null };

  for (const awb of unique) {
    const result = classifyFromRecords(
      forwardData[awb],
      reverseData[awb],
      expectedTypes[awb],
    );
    results[awb] = result;
    if (persist) await persistLookup(awb, result, syncLocalFromLookup);
  }

  const missing = unique.filter(
    (awb) => (results[awb]?.display_status ?? "N/A") === "N/A",
  );
  for (const awb of missing) {
    try {
      const live = await fetchShipwayLiveAwbStatus(awb);
      if (!live?.status) continue;
      const expected = expectedTypes[awb];
      const liveResult =
        expected === "reverse" || looksLikeReverseStatus(live.status)
          ? classifyFromRecords(
              undefined,
              {
                tracking_number: awb,
                tracking_status: live.status,
                carrier: live.courier,
                state_updated_at: null,
                status: null,
              },
              expected,
            )
          : classifyFromRecords(
              {
                awb_number: awb,
                shipment_status: live.status,
                courier_name: live.courier,
                updated_at: null,
              },
              undefined,
              expected,
            );
      if (liveResult.display_status === "N/A") continue;
      results[awb] = liveResult;
      if (persist) await persistLookup(awb, liveResult, syncLocalFromLookup);
    } catch (error) {
      console.error("lookupAwbStatusesFromExternal Shipway API:", error);
    }
  }

  return results;
}

function nowSqlFallback() {
  return nowIstSql();
}
