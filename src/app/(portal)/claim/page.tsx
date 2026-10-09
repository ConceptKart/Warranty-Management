import { redirect } from "next/navigation";
import { PortalShell } from "@/components/portal/portal-shell";
import { ClaimForm } from "@/components/portal/claim-form";
import { getPortalSession } from "@/lib/portal/get-session";
import { rehydrateShopifyCustomerIfBlank } from "@/lib/portal/rehydrate-shopify-customer";

export default async function ClaimPage() {
  const session = await getPortalSession();
  if (!session.orderData || !session.selectedIssueId) {
    redirect("/");
  }

  const hydrated = await rehydrateShopifyCustomerIfBlank(session.orderData);
  if (hydrated.updated) {
    session.orderData = hydrated.orderData;
    await session.save();
  }

  const orderData = hydrated.orderData;
  const selectedProducts: Array<{
    product_id: string | number;
    name: string;
    sku: string;
  }> = [];

  if (session.selectedProductsJson) {
    try {
      const parsed = JSON.parse(session.selectedProductsJson) as Array<{
        product_id?: string | number;
        name?: string;
        sku?: string;
      }>;
      for (const item of parsed) {
        const match =
          orderData.products.find(
            (p) =>
              item.sku &&
              p.sku &&
              String(p.sku) === String(item.sku),
          ) ??
          orderData.products.find(
            (p) => String(p.product_id) === String(item.product_id),
          );
        if (match) {
          selectedProducts.push({
            product_id: match.product_id,
            name: match.name,
            sku: match.sku,
          });
        } else if (item.name) {
          selectedProducts.push({
            product_id: item.product_id ?? "",
            name: item.name,
            sku: item.sku ?? "",
          });
        }
      }
    } catch {
      /* ignore */
    }
  }

  if (selectedProducts.length === 0 && session.selectedProduct) {
    const match = orderData.products.find(
      (p) => String(p.product_id) === String(session.selectedProduct),
    );
    if (match) {
      selectedProducts.push({
        product_id: match.product_id,
        name: match.name,
        sku: match.sku,
      });
    }
  }

  const isAmazon = Boolean(
    orderData.is_amazon_order || session.platform === "amazon",
  );
  const skippedTroubleshooting = session.selectedIssueId === "not_listed";

  return (
    <PortalShell activeStep="done">
      <div className="card">
        <h2>Submit Claim</h2>
        <ClaimForm
          platform={session.platform ?? "website"}
          orderId={String(
            orderData.order.external_order_id || orderData.order.order_id,
          )}
          orderDateUnix={orderData.order.date_add}
          customer={orderData.customer}
          selectedProducts={selectedProducts}
          isAmazon={isAmazon}
          isReplacement={
            orderData.claim_type === "replacement" ||
            Boolean(orderData.replacement?.is_eligible)
          }
          replacementDaysRemaining={orderData.replacement?.days_remaining ?? 0}
          backHref={skippedTroubleshooting ? "/issue" : "/troubleshoot"}
          skippedTroubleshooting={skippedTroubleshooting}
        />
      </div>
    </PortalShell>
  );
}
