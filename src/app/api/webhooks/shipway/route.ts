import { NextResponse } from "next/server";
import {
  processShipwayWebhook,
  type ShipwayWebhookPayload,
} from "@/lib/admin/shipway-webhook";
import { nowIstSql } from "@/lib/datetime/ist";

export const runtime = "nodejs";

/** Port of webhook/shipway.php?test=1 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  if (searchParams.has("test")) {
    return NextResponse.json({
      success: true,
      message: "Webhook endpoint is working",
      timestamp: nowIstSql(),
      method: "GET",
    });
  }
  return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
}

/** Port of webhook/shipway.php POST handler */
export async function POST(request: Request) {
  const rawBody = await request.text();
  if (!rawBody.trim()) {
    return NextResponse.json({ error: "No data received" }, { status: 400 });
  }

  let payload: ShipwayWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as ShipwayWebhookPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON data" }, { status: 400 });
  }

  const result = await processShipwayWebhook(rawBody, payload);
  return NextResponse.json(result.body, { status: result.httpStatus });
}
