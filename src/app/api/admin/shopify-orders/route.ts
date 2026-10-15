import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/get-session";
import {
  importShopifyOrderByShopId,
  searchShopifyOrders,
  syncShopifyDayAndSearch,
} from "@/lib/admin/shopify-orders";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session.adminUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const q = request.nextUrl.searchParams.get("q") ?? "";
  try {
    const result = await searchShopifyOrders(q);
    return NextResponse.json(result);
  } catch (error) {
    console.error("[admin/shopify-orders GET]", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Search failed",
      },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session.adminUser) {
    return NextResponse.json(
      { success: false, message: "Unauthorized" },
      { status: 401 },
    );
  }

  const body = (await request.json()) as {
    action?: string;
    q?: string;
    date?: string;
    shop_order_id?: string;
  };

  if (body.action === "import_order") {
    try {
      const result = await importShopifyOrderByShopId(
        String(body.shop_order_id ?? ""),
      );
      return NextResponse.json(result, {
        status: result.success ? 200 : 400,
      });
    } catch (error) {
      console.error("[admin/shopify-orders import_order]", error);
      return NextResponse.json(
        {
          success: false,
          message:
            error instanceof Error ? error.message : "Shopify import failed",
          inserted: 0,
          skipped: 0,
          shopify_order_id: null,
          rows: [],
        },
        { status: 500 },
      );
    }
  }

  if (body.action !== "sync_day") {
    return NextResponse.json(
      { success: false, message: "Unknown action" },
      { status: 400 },
    );
  }

  try {
    const result = await syncShopifyDayAndSearch({
      query: String(body.q ?? ""),
      date: String(body.date ?? ""),
    });

    return NextResponse.json({
      success: true,
      ...result,
      message: result.found
        ? `Synced ${result.sync.rows_upserted} row(s) from BaseLinker — order found.`
        : `Synced ${result.sync.rows_upserted} row(s) from BaseLinker, but this order was not in that day. Try another date.`,
    });
  } catch (error) {
    console.error("[admin/shopify-orders POST]", error);
    return NextResponse.json(
      {
        success: false,
        message:
          error instanceof Error ? error.message : "Shopify sync failed",
      },
      { status: 500 },
    );
  }
}
