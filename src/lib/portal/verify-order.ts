import { prisma } from "@/lib/db";
import { importShopifyOrderDirect } from "@/lib/admin/shopify-orders";
import {
  lookupCatalogProductBySku,
  resolveProductWarranty,
} from "@/lib/portal/product-warranty";
import { lookupShopifyOrderClassification } from "@/lib/portal/shopify-classification";
import type { PortalOrderData } from "@/lib/portal/session";
import { fetchShopifyAdminOrder } from "@/lib/shopify/admin-client";

export function shopifyOrderIdVariants(raw: string) {
  const trimmed = raw.trim();
  const withoutClaim = trimmed.replace(/-[WRwr]$/, "");
  const digits = withoutClaim.replace(/#?CK/gi, "").replace(/\D/g, "");
  const bareCk = digits ? `CK${digits}` : withoutClaim.replace(/^#/, "");
  const hashedCk = digits ? `#CK${digits}` : bareCk ? `#${bareCk}` : "";
  return [
    ...new Set(
      [trimmed, withoutClaim, bareCk, hashedCk, digits].filter(Boolean),
    ),
  ];
}

function earliestDate(dates: Array<Date | string | null | undefined>) {
  let earliest: Date | null = null;
  for (const value of dates) {
    if (!value) continue;
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) continue;
    if (!earliest || d.getTime() < earliest.getTime()) earliest = d;
  }
  return earliest;
}

async function liveShopifyCreatedAt(orderId: string): Promise<Date | null> {
  try {
    const live = await fetchShopifyAdminOrder(orderId);
    if (!live?.created_at) return null;
    const d = new Date(live.created_at);
    return Number.isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}

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
        (
          SELECT asm_v.warranty_given
          FROM amazon_sku_mapping asm_v
          WHERE aod.variant_id IS NOT NULL
            AND aod.variant_id != 0
            AND asm_v.variant_id = CAST(aod.variant_id AS CHAR)
          LIMIT 1
        ) AS v_warranty,
        (
          SELECT asm_p.warranty_given
          FROM amazon_sku_mapping asm_p
          WHERE aod.product_id IS NOT NULL
            AND aod.product_id != 0
            AND asm_p.product_id = CAST(aod.product_id AS CHAR)
            AND (
              asm_p.variant_id IS NULL
              OR asm_p.variant_id = '0'
              OR asm_p.variant_id = ''
            )
          LIMIT 1
        ) AS p_warranty
      FROM amazon_order_details aod
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

      const resolved = await resolveProductWarranty({
        sku,
        mappingMonths: warrantyMonths,
        catalogProductId: detail.aod_product_id,
        catalogVariantId: detail.aod_variant_id,
      });
      warrantyMonths = resolved.months;

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
  order_ean: string | number | null;
  v_warranty: number | null;
  p_warranty: number | null;
};

async function loadShopifyOrderItems(ids: string[]) {
  const unique = [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
  if (unique.length === 0) return [];
  const a = unique[0]!;
  const b = unique[1] ?? a;
  const c = unique[2] ?? a;
  const d = unique[3] ?? a;
  const e = unique[4] ?? a;
  return prisma.$queryRaw<ItemRow[]>`
    SELECT so.shopify_order_id, so.order_date, so.product_id, so.variant_id, so.sku, so.qty,
           so.customer_name, so.phone_number, so.email, so.customer_address, so.city, so.state, so.pincode,
           so.ean AS order_ean,
           (
             SELECT asm_v.warranty_given
             FROM amazon_sku_mapping asm_v
             WHERE so.variant_id IS NOT NULL
               AND so.variant_id != 0
               AND asm_v.variant_id = CAST(so.variant_id AS CHAR)
             LIMIT 1
           ) AS v_warranty,
           (
             SELECT asm_p.warranty_given
             FROM amazon_sku_mapping asm_p
             WHERE so.product_id IS NOT NULL
               AND so.product_id != 0
               AND asm_p.product_id = CAST(so.product_id AS CHAR)
               AND (
                 asm_p.variant_id IS NULL
                 OR asm_p.variant_id = '0'
                 OR asm_p.variant_id = ''
               )
             LIMIT 1
           ) AS p_warranty
    FROM shopify_orders so
    WHERE so.shopify_order_id IN (${a}, ${b}, ${c}, ${d}, ${e})
  `;
}

async function verifyShopifyOrder(shopifyOrderIdRaw: string): Promise<VerifyResult> {
  try {
    const shopifyOrderId = shopifyOrderIdRaw.trim();
    const lookupIds = shopifyOrderIdVariants(shopifyOrderId);
    const hashedId =
      lookupIds.find((id) => id.startsWith("#CK")) ||
      lookupIds.find((id) => id.startsWith("#")) ||
      shopifyOrderId;

    let orderItems = await loadShopifyOrderItems(lookupIds);
    if (orderItems.length === 0) {
      // Nightly BaseLinker cron only pulls yesterday and skips orders
      // that are not in BaseLinker yet (common for COD / same-day).
      try {
        const imported = await importShopifyOrderDirect(shopifyOrderId);
        if (imported.shopify_order_id) {
          lookupIds.push(imported.shopify_order_id);
        }
      } catch (error) {
        console.error("verifyShopifyOrder live import:", error);
      }
      orderItems = await loadShopifyOrderItems([...new Set(lookupIds)]);
    }

    if (orderItems.length === 0) {
      return {
        success: false,
        error: "Order not found. Please check your order number and try again.",
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
    let orderDate = earliestDate(orderItems.map((item) => item.order_date));
    const liveCreated = await liveShopifyCreatedAt(hashedId);
    if (
      liveCreated &&
      (!orderDate || liveCreated.getTime() < orderDate.getTime())
    ) {
      orderDate = liveCreated;
    }
    let overallWarrantyExpiry: string | null = null;
    let overallDaysRemaining = 0;

    for (const item of orderItems) {
      const sku = item.sku ?? "";
      const useVariant =
        item.variant_id != null && Number(item.variant_id) !== 0;
      let warrantyMonths = Number(
        useVariant ? (item.v_warranty ?? 0) : (item.p_warranty ?? 0),
      );
      const productOrderDate =
        orderDate ?? (item.order_date ? new Date(item.order_date) : null);

      if (productOrderDate && currentDate >= addYears(startOfDayIst(productOrderDate), 1)) {
        return {
          success: false,
          error:
            "Warranty on products from this order has expired. Orders older than 1 year are no longer eligible for warranty claims.",
        };
      }

      const [resolved, catalog] = await Promise.all([
        resolveProductWarranty({
          sku,
          mappingMonths: warrantyMonths,
          catalogProductId: item.product_id,
          catalogVariantId: item.variant_id,
        }),
        sku ? lookupCatalogProductBySku(sku).catch(() => null) : null,
      ]);
      warrantyMonths = resolved.months;

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

      const catalogName = catalog?.product_name?.trim() || "";
      const eanRaw = catalog?.ean ?? item.order_ean;
      const ean =
        eanRaw != null && String(eanRaw).trim() && String(eanRaw) !== "0"
          ? String(eanRaw).trim()
          : undefined;
      products.push({
        product_id: uniqueLineProductId(
          item.product_id,
          sku,
          products.length,
          `shopify_${sku || "item"}`,
        ),
        name: catalogName || sku || "Shopify Product",
        sku,
        ...(ean ? { ean } : {}),
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
