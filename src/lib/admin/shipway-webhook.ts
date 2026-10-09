import { prisma } from "@/lib/db";
import { updateShipmentStatus } from "@/lib/admin/shipments";

export type ShipwayWebhookPayload = {
  awb?: string;
  status?: string;
  location?: string;
  timestamp?: string;
  courier_status?: string;
  remarks?: string;
  status_message?: string;
};

function parseWebhookTimestamp(value: string | undefined): string | null {
  if (!value?.trim()) return null;
  const iso = DateTimeFromShipway(value.trim());
  if (iso) return iso;
  // Already MySQL-like datetime
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value.trim())) {
    return value.trim();
  }
  const d = new Date(value);
  if (!Number.isNaN(d.getTime())) {
    return d.toISOString().slice(0, 19).replace("T", " ");
  }
  return null;
}

function DateTimeFromShipway(value: string): string | null {
  // PHP: DateTime::createFromFormat('Y-m-d\TH:i:s\Z', ...)
  const m = value.match(
    /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})(?:\.\d+)?Z$/i,
  );
  if (!m) return null;
  return `${m[1]} ${m[2]}`;
}

/**
 * Port of webhook/shipway.php (without stored procedure).
 */
export async function processShipwayWebhook(
  rawBody: string,
  payload: ShipwayWebhookPayload,
) {
  const awbNumber = String(payload.awb ?? "").trim();
  const status = String(payload.status ?? "").trim();

  if (!awbNumber || !status) {
    return {
      httpStatus: 400 as const,
      body: { error: "Missing required field: awb/status" },
    };
  }

  const location = String(payload.location ?? "");
  const courierStatus = String(payload.courier_status ?? status);
  const remarks = String(payload.remarks ?? "");
  const statusMessage =
    String(payload.status_message ?? "").trim() ||
    `Status updated to ${status}`;
  const timestamp = parseWebhookTimestamp(payload.timestamp);

  let webhookLogId: number | null = null;

  try {
    await prisma.$executeRaw`
      INSERT INTO shipway_webhook_logs (
        awb_number, webhook_data, processed, created_at
      ) VALUES (
        ${awbNumber}, ${rawBody}, 0, NOW()
      )
    `;

    const logRows = await prisma.$queryRaw<Array<{ id: bigint | number }>>`
      SELECT LAST_INSERT_ID() AS id
    `;
    webhookLogId = Number(logRows[0]?.id ?? 0) || null;

    const shipments = await prisma.$queryRaw<
      Array<{ shipment_id: number }>
    >`
      SELECT shipment_id FROM shipments
      WHERE awb_number = ${awbNumber}
      LIMIT 1
    `;
    const shipment = shipments[0];

    if (!shipment) {
      if (webhookLogId) {
        await prisma.$executeRaw`
          UPDATE shipway_webhook_logs
          SET processing_error = ${"AWB number not found in shipments table"},
              processed_at = NOW()
          WHERE webhook_id = ${webhookLogId}
        `;
      }
      return {
        httpStatus: 404 as const,
        body: { error: "AWB number not found" },
      };
    }

    const update = await updateShipmentStatus({
      awbNumber,
      statusCode: status,
      statusMessage,
      location,
      remarks: remarks || "Shipway webhook update",
      courierStatus,
      timestamp,
    });

    if (!update.success) {
      if (webhookLogId) {
        await prisma.$executeRaw`
          UPDATE shipway_webhook_logs
          SET processing_error = ${update.message},
              processed_at = NOW()
          WHERE webhook_id = ${webhookLogId}
        `;
      }
      return {
        httpStatus: 500 as const,
        body: { error: update.message },
      };
    }

    if (webhookLogId) {
      await prisma.$executeRaw`
        UPDATE shipway_webhook_logs
        SET processed = 1,
            processed_at = NOW(),
            shipment_id = ${shipment.shipment_id}
        WHERE webhook_id = ${webhookLogId}
      `;
    }

    console.info(
      `[shipway-webhook] processed AWB=${awbNumber} status=${status}`,
    );

    return {
      httpStatus: 200 as const,
      body: {
        success: true,
        message: "Webhook processed successfully",
        awb: awbNumber,
        status,
      },
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Internal server error";
    console.error("[shipway-webhook]", error);

    if (webhookLogId) {
      try {
        await prisma.$executeRaw`
          UPDATE shipway_webhook_logs
          SET processing_error = ${message},
              processed_at = NOW()
          WHERE webhook_id = ${webhookLogId}
        `;
      } catch {
        /* ignore */
      }
    }

    return {
      httpStatus: 500 as const,
      body: { error: "Internal server error" },
    };
  }
}
