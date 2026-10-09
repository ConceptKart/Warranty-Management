import { NextResponse } from "next/server";
import { getPortalSession } from "@/lib/portal/get-session";
import { validateSelectedProductsWarranty } from "@/lib/portal/validate-selected-products-warranty";

export const runtime = "nodejs";

type SelectedLine = {
  product_id?: string | number;
  name?: string;
  sku?: string;
};

export async function POST(request: Request) {
  try {
    const session = await getPortalSession();
    if (!session.orderData) {
      return NextResponse.json(
        {
          success: false,
          error: "Session expired. Please verify your order again.",
        },
        { status: 400 },
      );
    }

    const body = (await request.json()) as {
      issue_type_id?: string;
      selected_product?: string;
      selected_products_json?: string;
      selected_ean_issue?: {
        issue?: string;
        troubleshoot_steps?: string;
        category_name?: string;
      } | null;
    };

    const issueTypeId = String(body.issue_type_id ?? "").trim();
    const selectedProduct = String(body.selected_product ?? "").trim();
    const selectedProductsJson = String(
      body.selected_products_json ?? "",
    ).trim();

    if (!issueTypeId) {
      return NextResponse.json(
        { success: false, error: "Please select an issue type" },
        { status: 400 },
      );
    }
    if (!selectedProductsJson && !selectedProduct) {
      return NextResponse.json(
        { success: false, error: "Please select a product" },
        { status: 400 },
      );
    }

    const orderData = session.orderData;
    const isAmazon = Boolean(
      orderData.is_amazon_order || session.platform === "amazon",
    );
    const isReplacement =
      orderData.claim_type === "replacement" ||
      Boolean(orderData.replacement?.is_eligible);

    let selectedLines: SelectedLine[] = [];
    if (selectedProductsJson) {
      try {
        const parsed = JSON.parse(selectedProductsJson) as unknown;
        if (Array.isArray(parsed)) {
          selectedLines = parsed as SelectedLine[];
        }
      } catch {
        selectedLines = [];
      }
    }

    const sessionProducts = orderData.products ?? [];
    const gatedProducts =
      selectedLines.length > 0
        ? selectedLines.map((line) => {
            const sku = String(line.sku ?? "").trim();
            const pid = String(line.product_id ?? "").trim();
            const match =
              sessionProducts.find(
                (p) =>
                  String(p.sku ?? "").trim() === sku &&
                  String(p.product_id) === pid,
              ) ??
              sessionProducts.find(
                (p) => String(p.sku ?? "").trim() === sku,
              ) ??
              sessionProducts.find((p) => String(p.product_id) === pid);
            return match ?? line;
          })
        : sessionProducts.filter(
            (p) => String(p.product_id) === selectedProduct,
          );

    const gate = validateSelectedProductsWarranty({
      products: gatedProducts,
      isAmazon,
      isReplacement,
    });
    if (!gate.ok) {
      return NextResponse.json(
        { success: false, error: gate.message },
        { status: 400 },
      );
    }

    session.selectedIssueId = issueTypeId;
    session.selectedProduct = selectedProduct;
    session.selectedProductsJson = selectedProductsJson;

    // Store only the chosen issue (full list blows past cookie size limits)
    if (
      issueTypeId.startsWith("ean_category_") &&
      body.selected_ean_issue?.issue
    ) {
      session.selectedEanIssue = {
        issue: String(body.selected_ean_issue.issue),
        troubleshoot_steps: String(
          body.selected_ean_issue.troubleshoot_steps ?? "",
        ),
        category_name: body.selected_ean_issue.category_name
          ? String(body.selected_ean_issue.category_name)
          : undefined,
      };
    } else {
      session.selectedEanIssue = undefined;
    }

    await session.save();

    const redirect =
      issueTypeId === "not_listed" ? "/claim" : "/troubleshoot";

    return NextResponse.json({ success: true, redirect });
  } catch (error) {
    console.error("[api/portal/issue]", error);
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Unable to continue. Please try again.",
      },
      { status: 500 },
    );
  }
}
