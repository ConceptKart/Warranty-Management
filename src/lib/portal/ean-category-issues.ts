import { prisma } from "@/lib/db";

export type EanIssue = {
  issue: string;
  troubleshoot_steps: string;
  category_id?: number | null;
  category_name?: string;
};

export type EanIssuesResult = {
  success: true;
  fallback?: boolean;
  ean?: number;
  category_id: number | null;
  category_name: string | null;
  issues: EanIssue[];
  message?: string;
};

async function getAllTroubleshootingIssues(): Promise<EanIssue[]> {
  // Mirrors public/api/ean_category_issues.php::getAllTroubleshootingIssues
  const rows = await prisma.$queryRaw<
    Array<{
      issue: string;
      troubleshoot_steps: string | null;
      category_id: number | null;
      category_name: string | null;
    }>
  >`
    SELECT tg.issue, tg.troubleshoot_steps, tg.category_id,
           COALESCE(bp.category_name, CONCAT('Category ', tg.category_id)) AS category_name
    FROM troubleshooting_guide tg
    LEFT JOIN bl_products bp ON tg.category_id = bp.category_id
    GROUP BY tg.category_id, tg.issue, tg.troubleshoot_steps, bp.category_name
    ORDER BY category_name, tg.issue
  `;

  return rows.map((r) => ({
    issue: r.issue,
    troubleshoot_steps: r.troubleshoot_steps ?? "",
    category_id: r.category_id,
    category_name: r.category_name ?? undefined,
  }));
}

/** Port of public/api/ean_category_issues.php */
export async function fetchEanCategoryIssues(
  sku: string,
): Promise<EanIssuesResult> {
  const trimmedSku = sku.trim();
  if (!trimmedSku) {
    return {
      success: true,
      fallback: true,
      category_id: null,
      category_name: "All Categories",
      issues: await getAllTroubleshootingIssues(),
      message: "Showing all troubleshooting categories",
    };
  }

  let ean: number | null = null;

  const shopifyEan = await prisma.$queryRaw<Array<{ ean: number | null }>>`
    SELECT ean FROM shopify_orders
    WHERE sku = ${trimmedSku} AND ean IS NOT NULL AND ean > 0
    LIMIT 1
  `;
  if (shopifyEan[0]?.ean) {
    ean = Number(shopifyEan[0].ean);
  } else {
    const amazonEan = await prisma.$queryRaw<Array<{ ean: number | null }>>`
      SELECT ean FROM amazon_order_details
      WHERE sku = ${trimmedSku} AND ean IS NOT NULL AND ean > 0
      LIMIT 1
    `;
    if (amazonEan[0]?.ean) ean = Number(amazonEan[0].ean);
  }

  if (!ean) {
    return {
      success: true,
      fallback: true,
      category_id: null,
      category_name: "All Categories",
      issues: await getAllTroubleshootingIssues(),
      message: "Showing all troubleshooting categories",
    };
  }

  const product = await prisma.$queryRaw<
    Array<{ category_id: number | null; category_name: string | null }>
  >`
    SELECT category_id, category_name FROM bl_products
    WHERE ean = ${ean} AND category_id > 0
    LIMIT 1
  `;
  const categoryId = product[0]?.category_id
    ? Number(product[0].category_id)
    : null;
  const categoryName = product[0]?.category_name ?? null;

  let issues: EanIssue[] = [];
  if (categoryId) {
    const guide = await prisma.$queryRaw<
      Array<{ issue: string; troubleshoot_steps: string | null }>
    >`
      SELECT issue, troubleshoot_steps FROM troubleshooting_guide
      WHERE category_id = ${categoryId}
      ORDER BY issue
    `;
    issues = guide.map((g) => ({
      issue: g.issue,
      troubleshoot_steps: g.troubleshoot_steps ?? "",
      category_id: categoryId,
      category_name: categoryName ?? undefined,
    }));
  }

  if (issues.length === 0) {
    return {
      success: true,
      fallback: true,
      ean,
      category_id: categoryId,
      category_name: categoryName || "Unknown Category",
      issues: await getAllTroubleshootingIssues(),
      message:
        "No specific issues found for this category. Showing all categories.",
    };
  }

  return {
    success: true,
    ean,
    category_id: categoryId,
    category_name: categoryName,
    issues,
  };
}
