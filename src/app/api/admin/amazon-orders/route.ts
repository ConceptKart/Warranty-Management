import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/get-session";
import {
  insertAmazonOrder,
  searchAmazonOrders,
  syncAmazonDayAndSearch,
} from "@/lib/admin/amazon-orders";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session.adminUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const q = request.nextUrl.searchParams.get("q") ?? "";
  try {
    const result = await searchAmazonOrders(q);
    return NextResponse.json(result);
  } catch (error) {
    console.error("[admin/amazon-orders GET]", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Search failed" },
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
    amazon_order_id?: string;
    sku?: string;
    order_date?: string;
  };

  if (body.action === "sync_day") {
    try {
      const result = await syncAmazonDayAndSearch({
        query: String(body.q ?? ""),
        date: String(body.date ?? ""),
      });
      return NextResponse.json({
        success: true,
        ...result,
        message: result.found
          ? `Synced ${result.sync.rows_upserted} row(s) from BaseLinker — order found.`
          : `Synced ${result.sync.rows_upserted} row(s) from BaseLinker, but this order was not in that day. Try another date or use manual insert.`,
      });
    } catch (error) {
      console.error("[admin/amazon-orders sync_day]", error);
      return NextResponse.json(
        {
          success: false,
          message:
            error instanceof Error ? error.message : "Amazon sync failed",
        },
        { status: 500 },
      );
    }
  }

  // Default: manual insert (PHP amazon-order-search.php)
  const result = await insertAmazonOrder({
    amazon_order_id: String(body.amazon_order_id ?? ""),
    sku: String(body.sku ?? ""),
    order_date: String(body.order_date ?? ""),
  });

  return NextResponse.json(result, { status: result.success ? 200 : 400 });
}
