import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { prisma } from "@/lib/db";
import { sendForStatus } from "@/lib/email/email-service";
import type { PortalOrderData, PortalSessionData } from "@/lib/portal/session";
import { uploadToRemoteServer } from "@/lib/portal/upload-to-remote";

export type ClaimInput = {
  customerEmail: string;
  customerName: string;
  customerPhone: string;
  shippingAddress: string;
  issueDescription: string;
  sourceDevice: string;
  files: File[];
  baselinkerField6397?: string;
  baselinkerField6398?: string;
  uploadedUrlsJson?: string;
};
export type ClaimResult =
  | { success: true; ticket_number: string; ticket_id: number }
  | {
      success: false;
      error: string;
      duplicate?: boolean;
      ticket_number?: string;
      days_remaining?: number;
      status_name?: string;
    };

const ALLOWED_EXT = new Set([
  "jpg",
  "jpeg",
  "png",
  "gif",
  "mp4",
  "avi",
  "mov",
  "wmv",
]);
const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/gif",
  "video/mp4",
  "video/avi",
  "video/quicktime",
  "video/x-msvideo",
  "video/x-ms-wmv",
  "video/mov",
  "video/wmv",
]);
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_FILES = 2;

function platformDisplayName(platform: string) {
  if (platform === "amazon") return "Amazon";
  if (platform === "flipkart") return "Flipkart";
  return "Website";
}

function formatShippingLine(parts: {
  address?: string;
  city?: string;
  state?: string;
  zipcode?: string;
  country?: string;
}) {
  return [parts.address, parts.city, parts.state, parts.zipcode, parts.country]
    .map((p) => (p ?? "").trim())
    .filter(Boolean)
    .join(", ");
}

export function validateClaimInput(
  data: ClaimInput,
  session: PortalSessionData,
): string[] {
  const errors: string[] = [];
  const platform = (session.platform ?? "website").toLowerCase();
  const isAmazon = platform === "amazon" || platform === "flipkart";
  const customer = session.orderData?.customer;

  const email = data.customerEmail.trim();
  if (!email) {
    errors.push(
      "Email address is required. Please enter your email address to proceed with the warranty claim.",
    );
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.push("Please enter a valid email address");
  }

  if (isAmazon) {
    const hasName =
      Boolean(data.customerName.trim()) || Boolean(customer?.name?.trim());
    const hasPhone =
      Boolean(data.customerPhone.trim()) || Boolean(customer?.phone?.trim());
    const hasAddress =
      Boolean(data.shippingAddress.trim()) ||
      Boolean(formatShippingLine(customer?.shipping_address ?? {}).trim());

    if (!hasName) {
      errors.push(
        `Customer name is required for ${platformDisplayName(platform)} orders. Please provide your customer information before submitting the warranty claim.`,
      );
    }
    if (!hasPhone) {
      errors.push(
        `Phone number is required for ${platformDisplayName(platform)} orders. Please provide your customer information before submitting the warranty claim.`,
      );
    }
    if (!hasAddress) {
      errors.push(
        `Shipping address is required for ${platformDisplayName(platform)} orders. Please provide your customer information before submitting the warranty claim.`,
      );
    }
    if (errors.length > 0) {
      errors.push(
        "Please scroll up and complete the customer information section before submitting your warranty claim.",
      );
    }
  }

  const nameValue = data.customerName.trim();
  if (nameValue && !/^[a-zA-Z\s]+$/.test(nameValue)) {
    errors.push("Name must contain only alphabets");
  }

  const phoneValue = data.customerPhone.trim();
  if (phoneValue && !/^\d{10}$/.test(phoneValue)) {
    errors.push("Phone number must be exactly 10 digits");
  }

  if (!session.selectedIssueId) {
    errors.push("Please select an issue type");
  }

  const desc = data.issueDescription.trim();
  if (!desc) {
    errors.push("Issue description is required");
  } else if (desc.length < 40) {
    errors.push("Issue description must be at least 40 characters long");
  } else if (desc.length > 400) {
    errors.push("Issue description must not exceed 400 characters");
  }

  const device = data.sourceDevice.trim();
  if (!device) {
    errors.push("Please specify the device and model used with the product");
  } else if (device.length < 3) {
    errors.push("Please provide a valid device name (at least 3 characters)");
  }

  const hasProducts =
    Boolean(session.selectedProductsJson?.trim()) ||
    Boolean(session.selectedProduct?.trim());
  if (!hasProducts) {
    errors.push("Please select a product");
  }

  const preUploaded = extractPreUploadedUrls(data);
  if (!data.files.length && !preUploaded.length) {
    errors.push("Please upload at least one photo or video of the issue");
  } else if (data.files.length > MAX_FILES) {
    errors.push(`Maximum ${MAX_FILES} files allowed.`);
  } else if (preUploaded.length > MAX_FILES) {
    errors.push(`Maximum ${MAX_FILES} files allowed.`);
  }

  return errors;
}

function guessMimeFromUrl(url: string) {
  const ext = url.split("?")[0]?.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    mp4: "video/mp4",
    mov: "video/mov",
    avi: "video/avi",
    wmv: "video/wmv",
  };
  return map[ext] ?? "image/jpeg";
}

function isValidUrl(value: string) {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

export function extractPreUploadedUrls(input: ClaimInput): string[] {
  const urls: string[] = [];
  if (input.baselinkerField6397 && isValidUrl(input.baselinkerField6397)) {
    urls.push(input.baselinkerField6397.trim());
  }
  if (input.baselinkerField6398 && isValidUrl(input.baselinkerField6398)) {
    urls.push(input.baselinkerField6398.trim());
  }
  if (urls.length === 0 && input.uploadedUrlsJson) {
    try {
      const decoded = JSON.parse(input.uploadedUrlsJson) as unknown;
      if (Array.isArray(decoded)) {
        for (const u of decoded.slice(0, MAX_FILES)) {
          if (typeof u === "string" && isValidUrl(u)) {
            urls.push(u.trim());
          }
        }
      }
    } catch {
      /* ignore */
    }
  }
  return urls.slice(0, MAX_FILES);
}

function buildRecordsFromPreUploadedUrls(urls: string[]): UploadedFile[] {
  return urls.map((url) => {
    const filename = decodeURIComponent(
      url.split("?")[0]?.split("/").pop() || "attachment",
    );
    return {
      original_filename: filename,
      stored_filename: filename,
      file_path: url,
      remote_url: url,
      file_type: guessMimeFromUrl(url),
      file_size: 0,
    };
  });
}

type UploadedFile = {
  original_filename: string;
  stored_filename: string;
  file_path: string;
  remote_url: string | null;
  file_type: string;
  file_size: number;
};

async function saveClaimFiles(files: File[]): Promise<
  | { success: true; files: UploadedFile[] }
  | { success: false; error: string }
> {
  const uploadDir = path.join(process.cwd(), "public", "uploads", "claims");
  await mkdir(uploadDir, { recursive: true });

  const saved: UploadedFile[] = [];

  for (const file of files) {
    const original = file.name || "attachment";
    const ext = original.split(".").pop()?.toLowerCase() ?? "";
    if (!ALLOWED_EXT.has(ext) || (file.type && !ALLOWED_MIME.has(file.type))) {
      return {
        success: false,
        error: `File '${original}' has an unsupported format. Please use JPG, PNG, GIF, MP4, AVI, MOV, or WMV files.`,
      };
    }
    if (file.size > MAX_FILE_BYTES) {
      return {
        success: false,
        error: `File '${original}' is too large. Maximum size is 10MB.`,
      };
    }

    const stored = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}.${ext}`;
    const absPath = path.join(uploadDir, stored);
    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(absPath, buffer);

    const publicPath = `/uploads/claims/${stored}`;
    const remote = await uploadToRemoteServer(buffer, stored, file.type || "application/octet-stream");
    const remoteUrl = remote.success ? remote.remote_url : publicPath;

    saved.push({
      original_filename: original,
      stored_filename: stored,
      file_path: publicPath,
      remote_url: remoteUrl,
      file_type: file.type || "application/octet-stream",
      file_size: file.size,
    });
  }

  return { success: true, files: saved };
}

async function resolveClaimAttachments(
  input: ClaimInput,
): Promise<
  | { success: true; files: UploadedFile[] }
  | { success: false; error: string }
> {
  const preUploaded = extractPreUploadedUrls(input);
  if (preUploaded.length > 0) {
    return { success: true, files: buildRecordsFromPreUploadedUrls(preUploaded) };
  }
  if (input.files.length > 0) {
    return saveClaimFiles(input.files);
  }
  return {
    success: false,
    error: "Please upload at least one photo or video of the issue",
  };
}

async function resolveTicketTypeAndStatus(
  claimType: "warranty" | "replacement",
): Promise<{ ticketTypeId: number; statusId: number }> {
  let ticketTypeId: number | null = null;
  const typeRows = await prisma.$queryRaw<Array<{ ticket_type_id: number }>>`
    SELECT ticket_type_id FROM ticket_types
    WHERE type_code = ${claimType} AND is_active = 1
    LIMIT 1
  `;
  ticketTypeId = typeRows[0]?.ticket_type_id ?? null;

  if (!ticketTypeId) {
    const fallback = await prisma.$queryRaw<Array<{ ticket_type_id: number }>>`
      SELECT ticket_type_id FROM ticket_types WHERE is_active = 1 LIMIT 1
    `;
    ticketTypeId = fallback[0]?.ticket_type_id ?? null;
  }
  if (!ticketTypeId) {
    throw new Error("No active ticket type configured");
  }

  let statusId: number | null = null;
  const statusRows = await prisma.$queryRaw<Array<{ status_id: number }>>`
    SELECT status_id FROM ticket_statuses
    WHERE ticket_type_id = ${ticketTypeId} AND is_active = 1
    ORDER BY sort_order ASC
    LIMIT 1
  `;
  statusId = statusRows[0]?.status_id ?? null;
  if (!statusId) {
    const fallback = await prisma.$queryRaw<Array<{ status_id: number }>>`
      SELECT status_id FROM ticket_statuses
      WHERE is_active = 1
      ORDER BY sort_order ASC
      LIMIT 1
    `;
    statusId = fallback[0]?.status_id ?? null;
  }
  if (!statusId) {
    throw new Error("No active ticket status configured");
  }

  return { ticketTypeId, statusId };
}

async function generateTicketNumber(ticketTypeId: number): Promise<string> {
  let prefix = "WR";
  const typeRows = await prisma.$queryRaw<Array<{ type_code: string | null }>>`
    SELECT type_code FROM ticket_types WHERE ticket_type_id = ${ticketTypeId}
  `;
  const typeCode = typeRows[0]?.type_code ?? "";
  if (typeCode === "replacement") prefix = "RP";
  else if (typeCode === "warranty") prefix = "WR";
  else if (typeCode) prefix = "TK";

  const now = new Date();
  const yearMonth = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
  const like = `${prefix}${yearMonth}%`;
  const offset = prefix.length + yearMonth.length + 1;

  const rows = await prisma.$queryRaw<Array<{ max_seq: bigint | number | null }>>`
    SELECT COALESCE(MAX(CAST(SUBSTRING(ticket_number, ${offset}) AS UNSIGNED)), 0) AS max_seq
    FROM warranty_tickets
    WHERE ticket_number LIKE ${like}
  `;
  const next = Number(rows[0]?.max_seq ?? 0) + 1;
  return `${prefix}${yearMonth}${String(next).padStart(4, "0")}`;
}

type SeqResult =
  | {
      blocked: false;
      order_number: string;
      is_first: boolean;
    }
  | {
      blocked: true;
      ticket_number: string;
      status_name: string;
      days_remaining: number;
    };

async function resolveSequentialOrderNumber(
  baseOrderId: string,
  typeChar: "W" | "R",
  platform: "amazon" | "shopify",
): Promise<SeqResult> {
  const firstW =
    platform === "amazon" ? `${baseOrderId}W` : `${baseOrderId}-W`;
  const firstR =
    platform === "amazon" ? `${baseOrderId}R` : `${baseOrderId}-R`;
  const pattern = `${baseOrderId}-%`;

  const existingClaims = await prisma.$queryRaw<
    Array<{
      ticket_number: string;
      created_at: Date;
      status_name: string | null;
      order_number: string | null;
    }>
  >`
    SELECT wt.ticket_number, wt.created_at, ts.status_name, o.order_number
    FROM orders o
    JOIN warranty_tickets wt ON wt.order_id = o.order_id
    LEFT JOIN ticket_statuses ts ON ts.status_id = wt.status_id
    WHERE o.source_platform = ${platform}
      AND (o.order_number = ${firstW}
           OR o.order_number = ${firstR}
           OR o.order_number LIKE ${pattern}
           OR o.baselinker_order_id = ${baseOrderId})
    ORDER BY wt.created_at DESC
  `;

  if (existingClaims.length === 0) {
    const suffix = platform === "amazon" ? typeChar : `-${typeChar}`;
    return {
      blocked: false,
      order_number: `${baseOrderId}${suffix}`,
      is_first: true,
    };
  }

  const latest = existingClaims[0];
  const createdAt = new Date(latest.created_at);
  const now = new Date();
  const daysAgo = Math.floor(
    (now.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24),
  );

  if (daysAgo < 20) {
    return {
      blocked: true,
      ticket_number: latest.ticket_number,
      status_name: latest.status_name ?? "Processing",
      days_remaining: 20 - daysAgo,
    };
  }

  const seq = existingClaims.length + 1;
  const seqPadded = String(seq).padStart(2, "0");
  return {
    blocked: false,
    order_number: `${baseOrderId}-${seqPadded}${typeChar}`,
    is_first: false,
  };
}

async function upsertCustomer(input: {
  email: string;
  name: string;
  phone: string;
  address: string;
}): Promise<number> {
  const existing = await prisma.$queryRaw<Array<{ customer_id: number }>>`
    SELECT customer_id FROM customers WHERE email = ${input.email} LIMIT 1
  `;
  const customerId = existing[0]?.customer_id;
  if (customerId) {
    await prisma.$executeRaw`
      UPDATE customers SET
        first_name = COALESCE(NULLIF(${input.name}, ''), first_name),
        phone = COALESCE(NULLIF(${input.phone}, ''), phone),
        address = COALESCE(NULLIF(${input.address}, ''), address),
        updated_at = NOW()
      WHERE customer_id = ${customerId}
    `;
    return customerId;
  }

  await prisma.$executeRaw`
    INSERT INTO customers (email, first_name, phone, address, created_at)
    VALUES (${input.email}, ${input.name}, ${input.phone}, ${input.address}, NOW())
  `;
  const inserted = await prisma.$queryRaw<Array<{ customer_id: number }>>`
    SELECT customer_id FROM customers WHERE email = ${input.email} ORDER BY customer_id DESC LIMIT 1
  `;
  return inserted[0]!.customer_id;
}

async function getOrCreateProductId(
  sku: string,
  name: string,
): Promise<number> {
  if (sku) {
    const bySku = await prisma.$queryRaw<Array<{ product_id: number }>>`
      SELECT product_id FROM products WHERE product_sku = ${sku} LIMIT 1
    `;
    if (bySku[0]?.product_id) return bySku[0].product_id;
  }

  const byName = await prisma.$queryRaw<Array<{ product_id: number }>>`
    SELECT product_id FROM products WHERE product_name = ${name} LIMIT 1
  `;
  if (byName[0]?.product_id) return byName[0].product_id;

  let uniqueSku = sku || `GEN-${Date.now()}`;
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      await prisma.$executeRaw`
        INSERT INTO products (
          product_name, product_sku, category, warranty_period_months,
          replacement_period_days, is_electronic, created_at, updated_at
        ) VALUES (
          ${name}, ${uniqueSku}, 'Generic', 12.00, 10.00, 1, NOW(), NOW()
        )
      `;
      const created = await prisma.$queryRaw<Array<{ product_id: number }>>`
        SELECT product_id FROM products WHERE product_sku = ${uniqueSku} LIMIT 1
      `;
      if (created[0]?.product_id) return created[0].product_id;
    } catch {
      uniqueSku = `${sku || "GEN"}-${attempt + 1}`;
    }
  }

  const fallback = await prisma.$queryRaw<Array<{ product_id: number }>>`
    SELECT product_id FROM products ORDER BY product_id ASC LIMIT 1
  `;
  if (!fallback[0]?.product_id) {
    throw new Error("Unable to resolve product for claim");
  }
  return fallback[0].product_id;
}

function resolveSelectedProduct(orderData: PortalOrderData, session: PortalSessionData) {
  const products = orderData.products;
  if (session.selectedProductsJson) {
    try {
      const selected = JSON.parse(session.selectedProductsJson) as Array<{
        product_id?: string | number;
        sku?: string;
      }>;
      if (Array.isArray(selected) && selected.length > 0) {
        const first = selected[0];
        const bySku = products.find(
          (p) =>
            first.sku &&
            p.sku &&
            String(p.sku) === String(first.sku),
        );
        if (bySku) return bySku;
        const byId = products.find(
          (p) => String(p.product_id) === String(first.product_id),
        );
        if (byId) return byId;
      }
    } catch {
      /* fall through */
    }
  }
  if (session.selectedProduct) {
    return (
      products.find((p) => String(p.product_id) === String(session.selectedProduct)) ??
      null
    );
  }
  return null;
}

function formatOrderDateIst(unixSeconds: number) {
  const d = new Date(unixSeconds * 1000);
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  // en-CA gives YYYY-MM-DD, HH:MM:SS parts — build MySQL datetime
  const parts = Object.fromEntries(
    fmt.formatToParts(d).map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

export async function submitPortalClaim(
  session: PortalSessionData,
  input: ClaimInput,
): Promise<ClaimResult> {
  const orderData = session.orderData;
  if (!orderData) {
    return { success: false, error: "Session expired. Please verify your order again." };
  }

  const validationErrors = validateClaimInput(input, session);
  if (validationErrors.length > 0) {
    return { success: false, error: validationErrors[0]! };
  }

  const upload = await resolveClaimAttachments(input);
  if (!upload.success) {
    return { success: false, error: upload.error };
  }

  const platform = (session.platform ?? "website").toLowerCase();
  const sourcePlatform =
    platform === "amazon" ? "amazon" : ("shopify" as const);
  const claimType =
    orderData.claim_type === "replacement" ? "replacement" : "warranty";
  const typeChar: "W" | "R" = claimType === "replacement" ? "R" : "W";

  const baseOrderId = String(orderData.order.order_id);
  const selectedProduct = resolveSelectedProduct(orderData, session);
  if (!selectedProduct) {
    return { success: false, error: "Selected product not found" };
  }

  const customerEmail = input.customerEmail.trim();
  const customerName =
    input.customerName.trim() || orderData.customer.name || "";
  const customerPhone =
    input.customerPhone.trim() || orderData.customer.phone || "";
  const shippingAddress =
    input.shippingAddress.trim() ||
    formatShippingLine(orderData.customer.shipping_address);

  const { ticketTypeId, statusId } =
    await resolveTicketTypeAndStatus(claimType);
  const ticketNumber = await generateTicketNumber(ticketTypeId);

  const seqResult = await resolveSequentialOrderNumber(
    baseOrderId,
    typeChar,
    sourcePlatform,
  );
  if (seqResult.blocked) {
    return {
      success: false,
      error: `A ticket is already raised under this Order ID (${seqResult.ticket_number}) — Status: ${seqResult.status_name}. You can submit a new ticket after 20 days (${seqResult.days_remaining} day(s) remaining).`,
      duplicate: true,
      ticket_number: seqResult.ticket_number,
      days_remaining: seqResult.days_remaining,
      status_name: seqResult.status_name,
    };
  }

  const formattedOrderNumber = seqResult.order_number;
  let issueTypeId = Number(session.selectedIssueId);
  if (!Number.isFinite(issueTypeId) || issueTypeId <= 0) {
    const def = await prisma.$queryRaw<Array<{ issue_type_id: number }>>`
      SELECT issue_type_id FROM issue_types WHERE is_active = 1 ORDER BY issue_type_id ASC LIMIT 1
    `;
    issueTypeId = def[0]?.issue_type_id ?? 1;
  }

  const selectedProductsJson = session.selectedProductsJson || null;
  const productSku = selectedProduct.sku || "";
  const productName =
    selectedProduct.name ||
    (sourcePlatform === "amazon" ? "Amazon Product" : "Shopify Product");
  const localProductId = await getOrCreateProductId(productSku, productName);
  const orderDate = formatOrderDateIst(orderData.order.date_add || Math.floor(Date.now() / 1000));
  const orderStatusLabel =
    sourcePlatform === "amazon" ? "Amazon Order" : "Shopify Order";
  const historyReason =
    sourcePlatform === "amazon"
      ? "Amazon warranty ticket created by customer"
      : "Shopify warranty ticket created by customer";

  try {
    const customerId = await upsertCustomer({
      email: customerEmail,
      name: customerName,
      phone: customerPhone,
      address: shippingAddress,
    });

    let orderId: number | null = null;
    const byNumber = await prisma.$queryRaw<Array<{ order_id: number }>>`
      SELECT order_id FROM orders
      WHERE order_number = ${formattedOrderNumber}
        AND source_platform = ${sourcePlatform}
      LIMIT 1
    `;
    orderId = byNumber[0]?.order_id ?? null;

    if (!orderId) {
      const byBase = await prisma.$queryRaw<
        Array<{ order_id: number; customer_id: number }>
      >`
        SELECT order_id, customer_id FROM orders
        WHERE baselinker_order_id = ${baseOrderId}
          AND source_platform = ${sourcePlatform}
        LIMIT 1
      `;
      if (byBase[0]) {
        orderId = byBase[0].order_id;
        if (seqResult.is_first) {
          await prisma.$executeRaw`
            UPDATE orders SET
              order_number = ${formattedOrderNumber},
              customer_id = ${customerId},
              updated_at = NOW()
            WHERE order_id = ${orderId}
          `;
        } else {
          const linkedCustomerId = byBase[0].customer_id;
          if (linkedCustomerId && linkedCustomerId !== customerId) {
            await prisma.$executeRaw`
              UPDATE customers SET
                first_name = COALESCE(NULLIF(${customerName}, ''), first_name),
                phone = COALESCE(NULLIF(${customerPhone}, ''), phone),
                address = COALESCE(NULLIF(${shippingAddress}, ''), address),
                updated_at = NOW()
              WHERE customer_id = ${linkedCustomerId}
            `;
          }
        }
      }
    }

    if (!orderId) {
      await prisma.$executeRaw`
        INSERT INTO orders (
          baselinker_order_id, order_number, customer_id, source_platform,
          order_value, order_status, order_date, created_at
        ) VALUES (
          ${baseOrderId}, ${formattedOrderNumber}, ${customerId}, ${sourcePlatform},
          0, ${orderStatusLabel}, ${orderDate}, NOW()
        )
      `;
      const inserted = await prisma.$queryRaw<Array<{ order_id: number }>>`
        SELECT order_id FROM orders
        WHERE baselinker_order_id = ${baseOrderId}
          AND order_number = ${formattedOrderNumber}
          AND source_platform = ${sourcePlatform}
        ORDER BY order_id DESC
        LIMIT 1
      `;
      orderId = inserted[0]?.order_id ?? null;
    }

    if (!orderId) {
      return { success: false, error: "Failed to create order record" };
    }

    await prisma.$executeRaw`
      INSERT INTO warranty_tickets (
        ticket_number, order_id, claim_number, product_id, selected_products_json,
        ticket_type_id, issue_type_id, status_id,
        customer_description, source_device, priority, baselinker_integrated, created_at
      ) VALUES (
        ${ticketNumber}, ${orderId}, ${formattedOrderNumber}, ${localProductId},
        ${selectedProductsJson}, ${ticketTypeId}, ${issueTypeId}, ${statusId},
        ${input.issueDescription.trim()}, ${input.sourceDevice.trim()},
        'high', 0, NOW()
      )
    `;

    const ticketRows = await prisma.$queryRaw<Array<{ ticket_id: number }>>`
      SELECT ticket_id FROM warranty_tickets
      WHERE ticket_number = ${ticketNumber}
      LIMIT 1
    `;
    const ticketDbId = ticketRows[0]?.ticket_id;
    if (!ticketDbId) {
      return { success: false, error: "Failed to create warranty ticket" };
    }

    await prisma.$executeRaw`
      UPDATE orders SET ticket_number = ${ticketNumber} WHERE order_id = ${orderId}
    `;

    for (const file of upload.files) {
      await prisma.$executeRaw`
        INSERT INTO ticket_attachments (
          ticket_id, original_filename, stored_filename, file_path, remote_url,
          file_type, file_size, uploaded_by, created_at
        ) VALUES (
          ${ticketDbId},
          ${file.original_filename},
          ${file.stored_filename},
          ${file.file_path},
          ${file.remote_url},
          ${file.file_type},
          ${file.file_size},
          'customer',
          NOW()
        )
      `;
    }

    await prisma.$executeRaw`
      INSERT INTO ticket_status_history (
        ticket_id, old_status_id, new_status_id, changed_by, change_reason, changed_at
      ) VALUES (
        ${ticketDbId}, NULL, ${statusId}, 'customer', ${historyReason}, NOW()
      )
    `;

    try {
      await sendForStatus(ticketDbId, "pending");
    } catch (emailErr) {
      console.error("[submitPortalClaim] Pending email error:", emailErr);
    }

    return {
      success: true,
      ticket_number: ticketNumber,
      ticket_id: ticketDbId,
    };
  } catch (error) {
    console.error("[submitPortalClaim]", error);
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to submit warranty claim. Please try again.",
    };
  }
}

export function buildShippingAddressFromParts(form: {
  address: string;
  city: string;
  state: string;
  pincode: string;
}) {
  return formatShippingLine({
    address: form.address,
    city: form.city,
    state: form.state,
    zipcode: form.pincode,
    country: "India",
  });
}
