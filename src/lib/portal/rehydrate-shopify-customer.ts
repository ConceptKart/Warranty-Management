/**
 * Port of public/index.php claim-step Shopify customer re-fetch.
 * If session name+phone are blank, reload customer fields from shopify_orders.
 */

import { prisma } from "@/lib/db";
import type { PortalOrderData } from "@/lib/portal/session";

function blank(value: string | null | undefined) {
  return !String(value ?? "").trim();
}

export async function rehydrateShopifyCustomerIfBlank(
  orderData: PortalOrderData,
): Promise<{ orderData: PortalOrderData; updated: boolean }> {
  if (!orderData.is_shopify_order) {
    return { orderData, updated: false };
  }

  const nameBlank = blank(orderData.customer?.name);
  const phoneBlank = blank(orderData.customer?.phone);
  if (!nameBlank || !phoneBlank) {
    return { orderData, updated: false };
  }

  const shopifyOrderId = String(orderData.order?.order_id ?? "").trim();
  if (!shopifyOrderId) {
    return { orderData, updated: false };
  }

  const bareId = shopifyOrderId.replace(/^#/, "");
  const hashedId = `#${bareId}`;

  const rows = await prisma.$queryRaw<
    Array<{
      customer_name: string | null;
      phone_number: string | null;
      email: string | null;
      customer_address: string | null;
      city: string | null;
      state: string | null;
      pincode: string | null;
    }>
  >`
    SELECT customer_name, phone_number, email, customer_address, city, state, pincode
    FROM shopify_orders
    WHERE shopify_order_id = ${shopifyOrderId}
       OR shopify_order_id = ${bareId}
       OR shopify_order_id = ${hashedId}
  `;

  let cName = "";
  let cPhone = "";
  let cEmail = "";
  let cAddr = "";
  let cCity = "";
  let cState = "";
  let cPin = "";

  for (const row of rows) {
    if (!cName && row.customer_name?.trim()) cName = row.customer_name.trim();
    if (!cPhone && row.phone_number?.trim()) cPhone = row.phone_number.trim();
    if (!cEmail && row.email?.trim()) cEmail = row.email.trim();
    if (!cAddr && row.customer_address?.trim())
      cAddr = row.customer_address.trim();
    if (!cCity && row.city?.trim()) cCity = row.city.trim();
    if (!cState && row.state?.trim()) cState = row.state.trim();
    if (!cPin && row.pincode?.trim()) cPin = row.pincode.trim();
  }

  if (!cName && !cPhone) {
    return { orderData, updated: false };
  }

  const addrArr = {
    address: cAddr,
    city: cCity,
    state: cState,
    zipcode: cPin,
    country: "India",
  };

  const nextCustomer: PortalOrderData["customer"] = {
    ...orderData.customer,
    name: cName,
    phone: cPhone,
    email: cEmail || orderData.customer.email || "",
    shipping_address: addrArr,
    billing_address: addrArr,
  };

  return {
    orderData: {
      ...orderData,
      customer: nextCustomer,
    },
    updated: true,
  };
}
