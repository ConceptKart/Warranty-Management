import { prisma } from "@/lib/db";
import { queryExternalShipway } from "@/lib/db-external-shipway";

export type ShopifyClassification = {
  type: "warranty" | "replacement" | "blocked";
  awb: string | null;
  status?: string;
  updated_at?: string;
  reason?: string;
  /** Whole days since Shipway DELIVERED updated_at */
  days_since_delivery?: number;
  /** Days left in the 10-day replacement window (0–10) */
  days_remaining?: number;
};

function daysSince(from: Date, to: Date) {
  const ms = to.getTime() - from.getTime();
  return Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24)));
}

/**
 * Port of WarrantyController::lookupShopifyOrderClassification
 */
export async function lookupShopifyOrderClassification(
  shopifyOrderId: string,
): Promise<ShopifyClassification> {
  const bareId = shopifyOrderId.replace(/^#/, "");
  const hashedId = `#${bareId}`;

  let awb = "";
  try {
    const rows = await prisma.$queryRaw<Array<{ awb_number: string | null }>>`
      SELECT awb_number FROM shopify_orders
      WHERE (shopify_order_id = ${shopifyOrderId}
          OR shopify_order_id = ${bareId}
          OR shopify_order_id = ${hashedId})
        AND awb_number IS NOT NULL AND awb_number != ''
      LIMIT 1
    `;
    awb = (rows[0]?.awb_number ?? "").trim();
  } catch (error) {
    console.error("lookupShopifyOrderClassification local AWB:", error);
    return { type: "warranty", awb: null, reason: "local_db_error" };
  }

  if (!awb) {
    return { type: "warranty", awb: null, reason: "no_awb" };
  }

  try {
    const extRows = await queryExternalShipway<
      Array<{ shipment_status: string | null; updated_at: Date | string | null }>
    >(
      "SELECT shipment_status, updated_at FROM orders WHERE awb_number = ? LIMIT 1",
      [awb],
    );
    const extRecord = extRows[0];

    if (!extRecord) {
      return { type: "warranty", awb, reason: "awb_not_in_external_db" };
    }

    const rawStatus = extRecord.shipment_status ?? "";
    const updatedAt = extRecord.updated_at;
    const normalized = rawStatus.trim().toUpperCase();

    if (normalized !== "DELIVERED") {
      return {
        type: "blocked",
        awb,
        status: rawStatus,
        reason: "not_delivered",
      };
    }

    if (updatedAt) {
      const delivered = new Date(updatedAt);
      const now = new Date();
      const since = daysSince(delivered, now);
      const cutoff = new Date(delivered);
      cutoff.setDate(cutoff.getDate() + 10);

      if (now <= cutoff) {
        return {
          type: "replacement",
          awb,
          status: rawStatus,
          updated_at: String(updatedAt),
          days_since_delivery: since,
          days_remaining: Math.max(0, 10 - since),
        };
      }

      return {
        type: "warranty",
        awb,
        status: rawStatus,
        updated_at: String(updatedAt),
        days_since_delivery: since,
        days_remaining: 0,
      };
    }

    return {
      type: "warranty",
      awb,
      status: rawStatus,
    };
  } catch (error) {
    console.error("lookupShopifyOrderClassification external DB:", error);
    return { type: "warranty", awb, reason: "external_db_error" };
  }
}
