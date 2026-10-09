import { NextResponse } from "next/server";
import { fetchEanCategoryIssues } from "@/lib/portal/ean-category-issues";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const sku = String(searchParams.get("sku") ?? "").trim();

  if (!sku) {
    return NextResponse.json(
      { success: false, error: "sku parameter is required" },
      { status: 400 },
    );
  }

  try {
    const result = await fetchEanCategoryIssues(sku);
    return NextResponse.json(result);
  } catch (error) {
    console.error("[ean-issues]", error);
    return NextResponse.json(
      { success: false, error: "Unable to load issues for this product" },
      { status: 500 },
    );
  }
}
