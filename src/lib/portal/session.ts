import { SessionOptions } from "iron-session";

export type PortalOrderData = {
  success: true;
  order: {
    order_id: string;
    date_add: number;
    external_order_id: string;
    order_status_name: string;
  };
  products: Array<{
    product_id: string | number;
    name: string;
    sku: string;
    quantity: number;
    variant_id?: string | number;
    warranty_months: number;
    warranty_valid: boolean;
    warranty_expiry: string | null;
    warranty_days_remaining: number;
    warranty_status: string;
  }>;
  customer: {
    email: string;
    phone: string;
    name: string;
    billing_address: {
      address: string;
      city: string;
      state: string;
      zipcode: string;
      country: string;
    };
    shipping_address: {
      address: string;
      city: string;
      state: string;
      zipcode: string;
      country: string;
    };
  };
  warranty: {
    is_valid: boolean;
    expiry_date: string;
    days_remaining: number;
  };
  replacement: {
    is_eligible: boolean;
    expiry_date: string | null;
    days_remaining: number;
    days_since_delivery?: number | null;
  };
  is_amazon_order?: boolean;
  is_shopify_order?: boolean;
  claim_type?: "warranty" | "replacement";
};

export type PortalSessionData = {
  orderData?: PortalOrderData;
  platform?: string;
  selectedIssueId?: string;
  selectedProduct?: string;
  selectedProductsJson?: string;
  ticketNumber?: string;
  /**
   * Single selected EAN/guide issue (not the full list — cookie size limit).
   * Used when selectedIssueId is ean_category_*
   */
  selectedEanIssue?: {
    issue: string;
    troubleshoot_steps: string;
    category_name?: string;
  };
};

export const portalSessionOptions: SessionOptions = {
  password: process.env.SESSION_SECRET ?? "dev-session-secret-change-in-production",
  cookieName: "warranty_portal_session",
  cookieOptions: {
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 4,
  },
};
