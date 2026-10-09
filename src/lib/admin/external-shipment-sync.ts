import { queryExternalShipway } from "@/lib/db-external-shipway";

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
};

const KNOWN_FORWARD = new Set(Object.keys(FORWARD_MAPPINGS));
const KNOWN_REVERSE = new Set([
  "RETURN DELIVERED",
  "RETURN CANCELLED",
  "RETURN IN TRANSIT",
  "RETURN OUT FOR PICKUP",
  "RETURN PICKUP GENERATED",
  "AWB ASSIGNED",
  "PICKUP SCHEDULED",
]);
const NEGLECTED_REVERSE = new Set(["RPSH", "ROOD"]);

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

/**
 * Port of ExternalShipmentSyncService::lookupAwbStatusesFromExternal.
 * When persist=true (default), also runs syncLocalFromLookup like PHP.
 */
export async function lookupAwbStatusesFromExternal(
  awbNumbers: string[],
  options?: { persist?: boolean },
): Promise<Record<string, AwbStatusResult>> {
  const persist = options?.persist !== false;
  const unique = [...new Set(awbNumbers.map((a) => a.trim()).filter(Boolean))];
  const results: Record<string, AwbStatusResult> = {};
  if (unique.length === 0) return results;

  const placeholders = unique.map(() => "?").join(",");

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
    if (forwardData[awb]) {
      const record = forwardData[awb]!;
      const externalStatus = record.shipment_status ?? "";
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
        displayStatus = "N/A";
        needsAction = true;
      }

      results[awb] = {
        display_status: displayStatus,
        mapped_status: mappedStatus,
        type: "forward",
        courier: record.courier_name ?? "",
        last_updated: record.updated_at ? String(record.updated_at) : null,
        needs_action: needsAction,
        raw_status: externalStatus,
      };

      if (persist && mappedStatus && syncLocalFromLookup) {
        await syncLocalFromLookup(
          awb,
          "forward",
          externalStatus,
          mappedStatus,
          record.updated_at ? String(record.updated_at) : null,
        );
      }
    } else if (reverseData[awb]) {
      const record = reverseData[awb]!;
      const externalStatus = record.tracking_status;
      const normalized = externalStatus?.trim().toUpperCase() ?? "";
      const rmaStatus = record.status;
      let displayStatus = "N/A";
      let needsAction = false;
      let mappedStatus: string | null = null;

      if (!externalStatus?.trim() || normalized === "NULL") {
        displayStatus = "N/A";
      } else if (NEGLECTED_REVERSE.has(normalized)) {
        displayStatus = "N/A";
        needsAction = true;
      } else if (KNOWN_REVERSE.has(normalized)) {
        displayStatus = normalized;
        mappedStatus = mapReverseStatus(externalStatus, rmaStatus);
      } else {
        displayStatus = "N/A";
        needsAction = true;
      }

      results[awb] = {
        display_status: displayStatus,
        mapped_status: mappedStatus,
        type: "reverse",
        courier: record.carrier ?? "",
        last_updated: record.state_updated_at
          ? String(record.state_updated_at)
          : null,
        needs_action: needsAction,
        raw_status: externalStatus,
      };

      if (persist && mappedStatus && syncLocalFromLookup) {
        await syncLocalFromLookup(
          awb,
          "reverse",
          externalStatus ?? "",
          mappedStatus,
          record.state_updated_at
            ? String(record.state_updated_at)
            : nowSqlFallback(),
        );
      }
    } else {
      results[awb] = {
        display_status: "N/A",
        mapped_status: null,
        type: null,
        courier: null,
        last_updated: null,
        needs_action: false,
        raw_status: null,
      };
    }
  }

  return results;
}

function nowSqlFallback() {
  return new Date().toISOString().slice(0, 19).replace("T", " ");
}
