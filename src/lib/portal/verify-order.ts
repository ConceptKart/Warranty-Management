import { prisma } from "@/lib/db";
import { lookupBlProductsWarranty } from "@/lib/portal/product-warranty";
import { lookupShopifyOrderClassification } from "@/lib/portal/shopify-classification";
import type { PortalOrderData } from "@/lib/portal/session";

type VerifyResult =
  | PortalOrderData
  | { success: false; error: string };

function daysBetween(from: Date, to: Date) {
  const ms = to.getTime() - from.getTime();
  return Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24)));
}

function startOfDayIst(date: Date) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = fmt.format(date); // YYYY-MM-DD
  return new Date(`${parts}T00:00:00+05:30`);
}

function addMonths(date: Date, months: number) {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

function addYears(date: Date, years: number) {
  const d = new Date(date);
  d.setFullYear(d.getFullYear() + years);
  return d;
}

/**
 * Line-item selection key. Many Shopify/Amazon rows store product_id as 0 or
 * reuse the same catalog id — that made one checkbox select every row.
 */
function uniqueLineProductId(
  productId: unknown,
  sku: string,
  index: number,
  fallbackPrefix: string,
): string {
  const raw = productId == null ? "" : String(productId).trim();
  const skuPart = (sku || "item").trim() || "item";
  if (raw && raw !== "0") {
    return `${raw}__${skuPart}__${index}`;
  }
  return `${fallbackPrefix}__${skuPart}__${index}`;
}

export function validateOrderInput(orderNumber: string, platform: string) {
  const errors: string[] = [];
  if (!orderNumber.trim()) errors.push("Order Number is required");
  if (!platform.trim()) errors.push("Platform selection is required");
  const allowed = ["amazon", "flipkart", "website"];
  if (platform && !allowed.includes(platform.toLowerCase())) {
    errors.push("Invalid platform selected");
  }
  return errors;
}

export async function verifyOrder(
  orderNumber: string,
  platform: string,
): Promise<VerifyResult> {
  const normalized = platform.toLowerCase().trim();
  const orderId = orderNumber.trim();

  if (normalized === "amazon") return verifyAmazonOrder(orderId);
  if (normalized === "website") return verifyShopifyOrder(orderId);

  return {
    success: false,
    error: "Platform not supported. Please select a valid platform.",
  };
}

async function verifyAmazonOrder(amazonOrderId: string): Promise<VerifyResult> {
  try {
    const countRows = await prisma.$queryRaw<Array<{ c: bigint }>>`
      SELECT COUNT(*) AS c FROM amazon_order_details WHERE amazon_order_id = ${amazonOrderId}
    `;
    if (Number(countRows[0]?.c ?? 0) === 0) {
      return {
        success: false,
        error: "Amazon order not found. Please check your order ID.",
      };
    }

    type DetailRow = {
      id: number;
      amazon_order_id: string | null;
      sku: string | null;
      amazon_title: string | null;
      order_date: Date;
      aod_product_id: number | null;
      aod_variant_id: number | null;
      v_warranty: number | null;
      p_warranty: number | null;
    };

    const details = await prisma.$queryRaw<DetailRow[]>`
      SELECT
        aod.id, aod.amazon_order_id, aod.sku, aod.amazon_title, aod.order_date,
        aod.product_id AS aod_product_id,
        aod.variant_id AS aod_variant_id,
        asm_v.warranty_given AS v_warranty,
        asm_p.warranty_given AS p_warranty
      FROM amazon_order_details aod
      LEFT JOIN amazon_sku_mapping asm_v
        ON aod.variant_id IS NOT NULL
        AND aod.variant_id != 0
        AND CONVERT(asm_v.variant_id USING utf8mb4) COLLATE utf8mb4_unicode_ci
          = CONVERT(CAST(aod.variant_id AS CHAR) USING utf8mb4) COLLATE utf8mb4_unicode_ci
      LEFT JOIN amazon_sku_mapping asm_p
        ON aod.product_id IS NOT NULL
        AND aod.product_id != 0
        AND CONVERT(asm_p.product_id USING utf8mb4) COLLATE utf8mb4_unicode_ci
          = CONVERT(CAST(aod.product_id AS CHAR) USING utf8mb4) COLLATE utf8mb4_unicode_ci
        AND (
          asm_p.variant_id IS NULL
          OR CONVERT(asm_p.variant_id USING utf8mb4) COLLATE utf8mb4_unicode_ci IN ('0', '')
        )
      WHERE aod.amazon_order_id = ${amazonOrderId}
    `;

    const currentDate = startOfDayIst(new Date());
    const products: PortalOrderData["products"] = [];
    let orderDate: Date | null = null;
    let overallWarrantyExpiry: string | null = null;
    let overallDaysRemaining = 0;

    for (const detail of details) {
      const sku = detail.sku ?? "";
      const useVariant =
        detail.aod_variant_id != null && Number(detail.aod_variant_id) !== 0;
      let warrantyMonths = Number(
        useVariant ? (detail.v_warranty ?? 0) : (detail.p_warranty ?? 0),
      );
      const productOrderDate = detail.order_date
        ? new Date(detail.order_date)
        : null;

      if (!orderDate && productOrderDate) {
        orderDate = productOrderDate;
        const orderDay = startOfDayIst(productOrderDate);
        if (currentDate >= addYears(orderDay, 1)) {
          return {
            success: false,
            error:
              "Warranty on products from this order has expired. Orders older than 1 year are no longer eligible for warranty claims.",
          };
        }
      }

      // Fallback: bl_products.warranty when amazon_sku_mapping has no period
      if (warrantyMonths <= 0 && sku) {
        const bl = await lookupBlProductsWarranty(sku);
        if (bl && bl.warranty_months > 0) {
          warrantyMonths = bl.warranty_months;
        }
      }

      let warrantyValid = false;
      let warrantyExpiry: string | null = null;
      let daysRemaining = 0;
      let warrantyStatus = "no_info";

      if (warrantyMonths > 0 && productOrderDate) {
        const orderDay = startOfDayIst(productOrderDate);
        const expiry = addMonths(orderDay, warrantyMonths);
        warrantyValid = currentDate <= expiry;
        warrantyExpiry = expiry.toISOString().slice(0, 10);
        if (warrantyValid) {
          warrantyStatus = "active";
          daysRemaining = daysBetween(currentDate, expiry);
          if (
            !overallWarrantyExpiry ||
            warrantyExpiry > overallWarrantyExpiry
          ) {
            overallWarrantyExpiry = warrantyExpiry;
            overallDaysRemaining = daysRemaining;
          }
        } else {
          warrantyStatus = "expired_by_date";
        }
      }

      products.push({
        product_id: uniqueLineProductId(
          detail.aod_product_id,
          sku,
          products.length,
          `amazon_${detail.id}`,
        ),
        name: detail.amazon_title || sku || `Amazon Product`,
        sku,
        quantity: 1,
        variant_id: detail.aod_variant_id ?? undefined,
        warranty_months: warrantyMonths,
        warranty_valid: warrantyValid,
        warranty_expiry: warrantyExpiry,
        warranty_days_remaining: daysRemaining,
        warranty_status: warrantyStatus,
      });
    }

    if (products.length === 0) {
      products.push({
        product_id: `amazon_${amazonOrderId}`,
        name: `Amazon Product (Order: ${amazonOrderId})`,
        sku: "",
        quantity: 1,
        warranty_months: 0,
        warranty_valid: true,
        warranty_expiry: null,
        warranty_days_remaining: 0,
        warranty_status: "no_info",
      });
    }

    const orderTimestamp = orderDate ? Math.floor(orderDate.getTime() / 1000) : Math.floor(Date.now() / 1000);

    return {
      success: true,
      order: {
        order_id: amazonOrderId,
        date_add: orderTimestamp,
        external_order_id: amazonOrderId,
        order_status_name: "Amazon Order",
      },
      products,
      customer: {
        email: "",
        phone: "",
        name: "",
        billing_address: {
          address: "",
          city: "",
          state: "",
          zipcode: "",
          country: "",
        },
        shipping_address: {
          address: "",
          city: "",
          state: "",
          zipcode: "",
          country: "",
        },
      },
      warranty: {
        is_valid: true,
        expiry_date: overallWarrantyExpiry ?? new Date().toISOString().slice(0, 10),
        days_remaining: overallDaysRemaining,
      },
      replacement: {
        is_eligible: false,
        expiry_date: null,
        days_remaining: 0,
      },
      is_amazon_order: true,
      claim_type: "warranty",
    };
  } catch (error) {
    console.error("verifyAmazonOrder:", error);
    return {
      success: false,
      error: "Unable to verify Amazon order. Please try again later.",
    };
  }
}

async function classifyShopifyOrder(shopifyOrderId: string) {
  return lookupShopifyOrderClassification(shopifyOrderId);
}

async function verifyShopifyOrder(shopifyOrderIdRaw: string): Promise<VerifyResult> {
  try {
    const shopifyOrderId = shopifyOrderIdRaw.trim();
    const bareId = shopifyOrderId.replace(/^#/, "");
    const hashedId = `#${bareId}`;

    const countRows = await prisma.$queryRaw<Array<{ c: bigint }>>`
      SELECT COUNT(*) AS c FROM shopify_orders
      WHERE shopify_order_id = ${shopifyOrderId}
         OR shopify_order_id = ${bareId}
         OR shopify_order_id = ${hashedId}
    `;
    if (Number(countRows[0]?.c ?? 0) === 0) {
      return {
        success: false,
        error: "Order not found. Please check your order number and try again.",
      };
    }

    type ItemRow = {
      shopify_order_id: string;
      order_date: Date;
      product_id: bigint | number;
      variant_id: bigint | number;
      sku: string | null;
      qty: number;
      customer_name: string;
      phone_number: string | null;
      email: string | null;
      customer_address: string;
      city: string;
      state: string;
      pincode: string;
      v_warranty: number | null;
      p_warranty: number | null;
    };

    const orderItems = await prisma.$queryRaw<ItemRow[]>`
      SELECT so.shopify_order_id, so.order_date, so.product_id, so.variant_id, so.sku, so.qty,
             so.customer_name, so.phone_number, so.email, so.customer_address, so.city, so.state, so.pincode,
             asm_v.warranty_given AS v_warranty,
             asm_p.warranty_given AS p_warranty
      FROM shopify_orders so
      LEFT JOIN amazon_sku_mapping asm_v
        ON so.variant_id IS NOT NULL
        AND so.variant_id != 0
        AND CONVERT(asm_v.variant_id USING utf8mb4) COLLATE utf8mb4_unicode_ci
          = CONVERT(CAST(so.variant_id AS CHAR) USING utf8mb4) COLLATE utf8mb4_unicode_ci
      LEFT JOIN amazon_sku_mapping asm_p
        ON so.product_id IS NOT NULL
        AND so.product_id != 0
        AND CONVERT(asm_p.product_id USING utf8mb4) COLLATE utf8mb4_unicode_ci
          = CONVERT(CAST(so.product_id AS CHAR) USING utf8mb4) COLLATE utf8mb4_unicode_ci
        AND (
          asm_p.variant_id IS NULL
          OR CONVERT(asm_p.variant_id USING utf8mb4) COLLATE utf8mb4_unicode_ci IN ('0', '')
        )
      WHERE so.shopify_order_id = ${shopifyOrderId}
         OR so.shopify_order_id = ${bareId}
         OR so.shopify_order_id = ${hashedId}
    `;

    if (orderItems.length === 0) {
      return {
        success: false,
        error: "Order details not found. Please check your order number.",
      };
    }

    let customerName = "";
    let customerEmail = "";
    let customerPhone = "";
    let customerAddress = "";
    let customerCity = "";
    let customerState = "";
    let customerPincode = "";

    for (const item of orderItems) {
      if (!customerName && item.customer_name?.trim())
        customerName = item.customer_name.trim();
      if (!customerEmail && item.email?.trim())
        customerEmail = item.email.trim();
      if (!customerPhone && item.phone_number?.trim())
        customerPhone = item.phone_number.trim();
      if (!customerAddress && item.customer_address?.trim())
        customerAddress = item.customer_address.trim();
      if (!customerCity && item.city?.trim()) customerCity = item.city.trim();
      if (!customerState && item.state?.trim())
        customerState = item.state.trim();
      if (!customerPincode && item.pincode?.trim())
        customerPincode = item.pincode.trim();
    }

    const currentDate = startOfDayIst(new Date());
    const products: PortalOrderData["products"] = [];
    let orderDate: Date | null = null;
    let overallWarrantyExpiry: string | null = null;
    let overallDaysRemaining = 0;

    for (const item of orderItems) {
      const sku = item.sku ?? "";
      const useVariant =
        item.variant_id != null && Number(item.variant_id) !== 0;
      let warrantyMonths = Number(
        useVariant ? (item.v_warranty ?? 0) : (item.p_warranty ?? 0),
      );
      const productOrderDate = item.order_date
        ? new Date(item.order_date)
        : null;

      if (!orderDate && productOrderDate) {
        orderDate = productOrderDate;
        const orderDay = startOfDayIst(productOrderDate);
        if (currentDate >= addYears(orderDay, 1)) {
          return {
            success: false,
            error:
              "Warranty on products from this order has expired. Orders older than 1 year are no longer eligible for warranty claims.",
          };
        }
      }

      // Website/PHP: when amazon_sku_mapping missing, use bl_products.warranty
      if (warrantyMonths <= 0 && sku) {
        const bl = await lookupBlProductsWarranty(sku);
        if (bl && bl.warranty_months > 0) {
          warrantyMonths = bl.warranty_months;
        }
      }

      let warrantyValid = false;
      let warrantyExpiry: string | null = null;
      let daysRemaining = 0;
      let warrantyStatus = "no_info";

      if (warrantyMonths > 0 && productOrderDate) {
        const orderDay = startOfDayIst(productOrderDate);
        const expiry = addMonths(orderDay, warrantyMonths);
        warrantyValid = currentDate <= expiry;
        warrantyExpiry = expiry.toISOString().slice(0, 10);
        if (warrantyValid) {
          warrantyStatus = "active";
          daysRemaining = daysBetween(currentDate, expiry);
          if (
            !overallWarrantyExpiry ||
            warrantyExpiry > overallWarrantyExpiry
          ) {
            overallWarrantyExpiry = warrantyExpiry;
            overallDaysRemaining = daysRemaining;
          }
        } else {
          warrantyStatus = "expired_by_date";
        }
      }

      products.push({
        product_id: uniqueLineProductId(
          item.product_id,
          sku,
          products.length,
          `shopify_${sku || "item"}`,
        ),
        name: sku || "Shopify Product",
        sku,
        quantity: Number(item.qty ?? 1),
        variant_id:
          item.variant_id != null ? String(item.variant_id) : undefined,
        warranty_months: warrantyMonths,
        warranty_valid: warrantyValid,
        warranty_expiry: warrantyExpiry,
        warranty_days_remaining: daysRemaining,
        warranty_status: warrantyStatus,
      });
    }

    const classification = await classifyShopifyOrder(shopifyOrderId);
    if (classification.type === "blocked") {
      return {
        success: false,
        error: `Your order is currently in transit (shipment status: ${classification.status ?? "unknown"}). Please raise a warranty/replacement request only after the order has been delivered.`,
      };
    }

    const orderTimestamp = orderDate
      ? Math.floor(orderDate.getTime() / 1000)
      : Math.floor(Date.now() / 1000);

    return {
      success: true,
      order: {
        order_id: shopifyOrderId,
        date_add: orderTimestamp,
        external_order_id: shopifyOrderId,
        order_status_name: "Shopify Order",
      },
      products,
      customer: {
        email: customerEmail,
        phone: customerPhone,
        name: customerName,
        billing_address: {
          address: customerAddress,
          city: customerCity,
          state: customerState,
          zipcode: customerPincode,
          country: "India",
        },
        shipping_address: {
          address: customerAddress,
          city: customerCity,
          state: customerState,
          zipcode: customerPincode,
          country: "India",
        },
      },
      warranty: {
        is_valid: true,
        expiry_date:
          overallWarrantyExpiry ?? new Date().toISOString().slice(0, 10),
        days_remaining: overallDaysRemaining,
      },
      replacement: {
        is_eligible: classification.type === "replacement",
        expiry_date: null,
        days_remaining:
          classification.type === "replacement"
            ? (classification.days_remaining ?? 0)
            : 0,
        days_since_delivery: classification.days_since_delivery ?? null,
      },
      is_shopify_order: true,
      claim_type: classification.type === "replacement" ? "replacement" : "warranty",
    };
  } catch (error) {
    console.error("verifyShopifyOrder:", error);
    return {
      success: false,
      error: "Unable to verify order. Please try again later.",
    };
  }
}
