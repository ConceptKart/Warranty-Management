import { redirect } from "next/navigation";
import { PortalShell } from "@/components/portal/portal-shell";
import { IssueSelectionForm } from "@/components/portal/issue-selection-form";
import { getPortalSession } from "@/lib/portal/get-session";

function platformLabel(platform: string) {
  if (platform === "amazon") return "Amazon";
  if (platform === "flipkart") return "Flipkart";
  if (platform === "website") return "conceptkart.com";
  return platform || "Website";
}

function formatOrderDate(unix: number) {
  return new Date(unix * 1000).toLocaleDateString("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric",
  });
}

export default async function IssueSelectionPage() {
  const session = await getPortalSession();
  if (!session.orderData) {
    redirect("/");
  }

  const orderData = session.orderData;
  const orderId = String(
    orderData.order.external_order_id || orderData.order.order_id,
  );
  const customer = orderData.customer;
  const isAmazon = Boolean(
    orderData.is_amazon_order || session.platform === "amazon",
  );

  return (
    <PortalShell activeStep="issue">
      <div className="card">
        <h2>Order Verification Successful</h2>

        <div className="order-summary">
          <h3>Order Details</h3>
          <div className="order-info">
            <div className="info-row">
              <span className="label">Order Number:</span>
              <span className="value">{orderId}</span>
            </div>
            <div className="info-row">
              <span className="label">Order Date:</span>
              <span className="value">
                {formatOrderDate(orderData.order.date_add)}
              </span>
            </div>
            <div className="info-row">
              <span className="label">Platform:</span>
              <span className="value">
                {platformLabel(session.platform ?? "website")}
              </span>
            </div>
            {customer.name ? (
              <div className="info-row">
                <span className="label">Customer Name:</span>
                <span className="value">{customer.name}</span>
              </div>
            ) : null}
            {customer.email ? (
              <div className="info-row">
                <span className="label">Customer Email:</span>
                <span className="value">{customer.email}</span>
              </div>
            ) : null}
            {customer.phone ? (
              <div className="info-row">
                <span className="label">Customer Phone:</span>
                <span className="value">{customer.phone}</span>
              </div>
            ) : null}
          </div>

          <div className="warranty-status">
            {isAmazon ? (
              <div className="warranty-notice">
                <small>
                  Select a product below to view its warranty status.
                </small>
              </div>
            ) : orderData.claim_type === "replacement" ||
              orderData.replacement?.is_eligible ? (
              <>
                <div className="status-badge status-valid">
                  ✓ 10-Day Replacement Window (
                  {orderData.replacement.days_remaining} days remaining)
                </div>
                <div className="replacement-priority-notice">
                  <small>
                    <strong>Note:</strong> You are within the 10-day replacement
                    period. Product-specific warranty will be shown after
                    selecting a product.
                  </small>
                </div>
              </>
            ) : (
              <>
                {orderData.replacement?.days_since_delivery != null &&
                orderData.replacement.days_since_delivery > 10 ? (
                  <div className="status-badge status-info">
                    ℹ 10-Day Replacement Window Expired (
                    {orderData.replacement.days_since_delivery} days since
                    delivery)
                  </div>
                ) : null}
                <div className="warranty-notice">
                  <small>
                    <strong>Note:</strong> Each product may have different
                    warranty periods. Select a product below to see its specific
                    warranty status.
                  </small>
                </div>
              </>
            )}
          </div>
        </div>

        <IssueSelectionForm
          products={orderData.products}
          isAmazon={isAmazon}
          isReplacement={
            orderData.claim_type === "replacement" ||
            Boolean(orderData.replacement?.is_eligible)
          }
        />
      </div>
    </PortalShell>
  );
}
