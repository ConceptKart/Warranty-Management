import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, "..", "postman");
fs.mkdirSync(outDir, { recursive: true });

const base = "{{baseUrl}}";

function item(name, method, routePath, opts = {}) {
  const [pathname, query = ""] = routePath.split("?");
  const headers = [{ key: "Accept", value: "application/json" }];
  if (opts.json || opts.jsonBody) {
    headers.push({ key: "Content-Type", value: "application/json" });
  }
  if (opts.cron) {
    headers.push({ key: "x-cron-secret", value: "{{cronSecret}}" });
  }

  const request = {
    method,
    header: headers,
    url: {
      raw: base + routePath,
      host: ["{{baseUrl}}"],
      path: pathname.replace(/^\//, "").split("/").filter(Boolean),
    },
    description: opts.description || "",
  };

  if (query) {
    request.url.query = query.split("&").map((p) => {
      const [k, v] = p.split("=");
      return { key: k, value: decodeURIComponent(v || "") };
    });
  }

  if (opts.jsonBody) {
    request.body = {
      mode: "raw",
      raw: JSON.stringify(opts.jsonBody, null, 2),
      options: { raw: { language: "json" } },
    };
  }

  if (opts.formdata) {
    request.body = { mode: "formdata", formdata: opts.formdata };
  }

  return { name, request, response: [] };
}

function folder(name, items) {
  return { name, item: items };
}

const collection = {
  info: {
    name: "Warranty Management Next.js",
    description: [
      "API collection for warranty_management_new (Next.js).",
      "",
      "Auth notes:",
      "- Admin APIs: run Admin Auth > Login first. Postman stores the session cookie (warranty_admin_session). Keep cookie jar enabled.",
      "- Portal APIs: run Portal > Verify Order first (sets warranty_portal_session), then Issue / Claim.",
      "- Cron APIs: set cronSecret to match CRON_SECRET in .env (sent as x-cron-secret).",
      "",
      "Default local baseUrl: http://localhost:3000",
    ].join("\n"),
    schema:
      "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
  },
  variable: [
    { key: "baseUrl", value: "http://localhost:3000" },
    { key: "cronSecret", value: "" },
    { key: "adminUsername", value: "admin" },
    { key: "adminPassword", value: "admin123" },
    { key: "ticketId", value: "1" },
    { key: "ticketNumber", value: "WT-000001" },
    { key: "orderNumber", value: "#CK278358" },
    { key: "awbNumber", value: "90592796383" },
    { key: "sku", value: "AC-Beam-DAC-Blk-TypeC-3.5" },
  ],
  item: [
    folder("Health", [
      item("Health check", "GET", "/api/health", {
        description: "DB/app health",
      }),
    ]),
    folder("Admin Auth", [
      item("Login", "POST", "/api/admin/login", {
        jsonBody: {
          username: "{{adminUsername}}",
          password: "{{adminPassword}}",
        },
        description:
          "Sets admin session cookie. Run this before other admin routes.",
      }),
      item("Me", "GET", "/api/admin/me", {
        description: "Current admin session user",
      }),
      item("Logout", "POST", "/api/admin/logout", {
        description: "Clears admin session",
      }),
    ]),
    folder("Admin Users", [
      item("Create user", "POST", "/api/admin/users", {
        jsonBody: {
          action: "create",
          username: "test_support",
          password: "support123",
          full_name: "Test Support",
          email: "support@example.com",
          role: "support",
        },
        description: "Requires manage_users (admin role)",
      }),
      item("Update user", "POST", "/api/admin/users", {
        jsonBody: {
          action: "update",
          user_id: 2,
          full_name: "Updated Name",
          email: "updated@example.com",
          role: "support",
          is_active: true,
          new_password: "",
        },
      }),
      item("Delete user", "POST", "/api/admin/users", {
        jsonBody: { action: "delete", user_id: 2 },
      }),
    ]),
    folder("Admin Amazon / Shopify / Shipway tools", [
      item(
        "Amazon orders search",
        "GET",
        "/api/admin/amazon-orders?q={{orderNumber}}",
      ),
      item("Amazon sync day", "POST", "/api/admin/amazon-orders", {
        jsonBody: {
          action: "sync_day",
          q: "{{orderNumber}}",
          date: "2026-07-21",
        },
      }),
      item("Amazon manual insert", "POST", "/api/admin/amazon-orders", {
        jsonBody: {
          amazon_order_id: "404-3980445-1276367",
          sku: "{{sku}}",
          order_date: "2026-07-21",
        },
      }),
      item(
        "Shopify orders search",
        "GET",
        "/api/admin/shopify-orders?q={{orderNumber}}",
      ),
      item("Shopify sync day", "POST", "/api/admin/shopify-orders", {
        jsonBody: {
          action: "sync_day",
          q: "{{orderNumber}}",
          date: "2026-07-21",
        },
      }),
      item("Shipway tracker (AWB/RMA)", "POST", "/api/admin/shipway-tracker", {
        jsonBody: { number: "{{awbNumber}}" },
      }),
      item("Shipway tracking fetch", "POST", "/api/admin/shipway-tracking", {
        jsonBody: {
          action: "fetch_tracking",
          awb_number: "{{awbNumber}}",
        },
        description:
          "Actions: validate_awb | fetch_tracking | get_shipment_history | bulk_update",
      }),
    ]),
    folder("Admin Shipments", [
      item("Assign shipment AWB", "POST", "/api/admin/shipments/assign", {
        jsonBody: {
          ticket_id: "{{ticketId}}",
          awb_number: "{{awbNumber}}",
          courier_partner: "Shipway",
          shipment_type: "forward",
        },
      }),
      item(
        "Get shipment tracking",
        "GET",
        "/api/admin/shipments/tracking?awb={{awbNumber}}",
      ),
      item(
        "Update shipment status",
        "POST",
        "/api/admin/shipments/update-status",
        {
          jsonBody: {
            awb_number: "{{awbNumber}}",
            status_code: "DELIVERED",
            status_message: "Delivered",
            location: "Mumbai",
            remarks: "",
            courier_status: "DELIVERED",
          },
        },
      ),
    ]),
    folder("Admin Tickets", [
      item("Update status", "POST", "/api/admin/tickets/status", {
        jsonBody: {
          ticket_id: "{{ticketId}}",
          status_id: 1,
          reason: "",
          notes: "",
        },
      }),
      item(
        "Update local status from Shipway map",
        "POST",
        "/api/admin/tickets/update-local-status",
        {
          jsonBody: {
            ticket_id: "{{ticketId}}",
            mapped_status: "delivered",
            awb_type: "forward",
          },
        },
      ),
      item("Change type", "POST", "/api/admin/tickets/change-type", {
        jsonBody: { ticket_id: "{{ticketId}}", new_type_id: 1 },
      }),
      item("Add comment", "POST", "/api/admin/tickets/comment", {
        jsonBody: {
          ticket_id: "{{ticketId}}",
          comment_text: "Internal note",
          is_internal: true,
        },
      }),
      item("Update priority", "POST", "/api/admin/tickets/priority", {
        jsonBody: { ticket_id: "{{ticketId}}", priority: "high" },
      }),
      item("Update customer", "POST", "/api/admin/tickets/customer", {
        jsonBody: {
          ticket_id: "{{ticketId}}",
          customer_name: "Test Customer",
          customer_email: "customer@example.com",
          phone: "9999999999",
          address: "Test Address",
        },
      }),
      item("Send email (accepted)", "POST", "/api/admin/tickets/email", {
        jsonBody: {
          action: "accepted",
          ticket_id: "{{ticketId}}",
          email_template: "",
        },
      }),
      item("Send email (custom)", "POST", "/api/admin/tickets/email", {
        jsonBody: {
          action: "custom",
          ticket_id: "{{ticketId}}",
          to_email: "customer@example.com",
          subject: "Update on Your Warranty Request",
          body: "Hello, this is a test update.",
        },
      }),
      item("Assign AWB (manual forward)", "POST", "/api/admin/tickets/awb", {
        jsonBody: {
          ticket_id: "{{ticketId}}",
          shipment_mode: "manual_forward",
          awb_number: "{{awbNumber}}",
          courier_partner: "Shipway",
          shipment_type: "forward",
        },
      }),
      item("Create Shipway return AWB", "POST", "/api/admin/tickets/awb", {
        jsonBody: {
          ticket_id: "{{ticketId}}",
          shipment_mode: "return",
          customer_address: "Test Address",
          customer_city: "Mumbai",
          customer_state: "MH",
          customer_zipcode: "400001",
        },
      }),
      item("AWB status lookup", "POST", "/api/admin/tickets/awb-status", {
        jsonBody: { ticket_id: "{{ticketId}}" },
      }),
      item("Refresh tracking", "POST", "/api/admin/tickets/tracking", {
        jsonBody: { ticket_id: "{{ticketId}}" },
      }),
      item("Lookup EAN", "POST", "/api/admin/tickets/lookup-ean", {
        jsonBody: { sku: "{{sku}}" },
      }),
      item("Replacement EAN", "POST", "/api/admin/tickets/replacement-ean", {
        jsonBody: { ticket_id: "{{ticketId}}", ean: "" },
      }),
      item("Unit replace", "POST", "/api/admin/tickets/unit-replace", {
        jsonBody: { ticket_id: "{{ticketId}}" },
      }),
      item("Bulk forward", "POST", "/api/admin/tickets/bulk-forward", {
        jsonBody: { ticket_ids: ["{{ticketId}}"] },
      }),
      item("Packer handover list", "POST", "/api/admin/tickets/packer-handover", {
        jsonBody: {
          action: "list",
          awb_filter: "",
          date_from: "",
          date_to: "",
        },
      }),
      item("Packer handover mark", "POST", "/api/admin/tickets/packer-handover", {
        jsonBody: {
          action: "mark",
          ticket_id: "{{ticketId}}",
          awb_number: "{{awbNumber}}",
          packer_name: "Packer 1",
        },
      }),
      item("Export tickets CSV", "GET", "/api/admin/tickets/export", {
        description:
          "Requires export_data permission (admin/manager). Returns CSV.",
      }),
    ]),
    folder("Portal", [
      item("Verify order", "POST", "/api/portal/verify", {
        jsonBody: {
          order_number: "{{orderNumber}}",
          platform: "website",
        },
        description: "Sets portal session. platform: amazon | website | flipkart",
      }),
      item("Select issue", "POST", "/api/portal/issue", {
        jsonBody: {
          issue_type_id: "not_listed",
          selected_product: "0",
          selected_products_json: JSON.stringify([
            {
              product_id: 0,
              name: "Sample",
              sku: "{{sku}}",
              quantity: 1,
            },
          ]),
          selected_ean_issue: null,
        },
        description: "Requires prior Verify order session.",
      }),
      item("EAN issues by SKU", "GET", "/api/portal/ean-issues?sku={{sku}}"),
      item(
        "Product warranty",
        "GET",
        "/api/portal/product-warranty?sku={{sku}}",
      ),
      item("Upload attachment", "POST", "/api/portal/upload", {
        formdata: [
          {
            key: "file",
            type: "file",
            src: "",
            description: "Pick a local image/file",
          },
        ],
        description: "Multipart upload for claim attachments.",
      }),
      item("Submit claim", "POST", "/api/portal/claim", {
        formdata: [
          {
            key: "customer_email",
            type: "text",
            value: "customer@example.com",
          },
          { key: "edit_name", type: "text", value: "Test Customer" },
          { key: "edit_phone", type: "text", value: "9999999999" },
          { key: "edit_shipping_street", type: "text", value: "Street 1" },
          { key: "edit_shipping_city", type: "text", value: "Mumbai" },
          { key: "edit_shipping_state", type: "text", value: "MH" },
          { key: "edit_shipping_pincode", type: "text", value: "400001" },
          {
            key: "issue_description",
            type: "text",
            value: "Product not working",
          },
          { key: "source_device", type: "text", value: "Phone" },
          { key: "uploaded_urls", type: "text", value: "[]" },
          { key: "attachments", type: "file", src: "" },
        ],
        description: "Requires Verify + Issue session. Multipart form.",
      }),
    ]),
    folder("Cron", [
      item(
        "Sync Amazon",
        "GET",
        "/api/cron/sync-amazon?date=2026-07-21&dry_run=1",
        {
          cron: true,
          description:
            "Header x-cron-secret required if CRON_SECRET is set.",
        },
      ),
      item(
        "Sync Amazon (POST)",
        "POST",
        "/api/cron/sync-amazon?date=2026-07-21&dry_run=1",
        { cron: true },
      ),
      item(
        "Sync Shopify",
        "GET",
        "/api/cron/sync-shopify?date=2026-07-21&dry_run=1",
        { cron: true },
      ),
      item(
        "Sync Shopify (POST)",
        "POST",
        "/api/cron/sync-shopify?date=2026-07-21&dry_run=1",
        { cron: true },
      ),
      item(
        "Sync shipments (changed)",
        "GET",
        "/api/cron/sync-shipments?mode=changed",
        { cron: true },
      ),
      item(
        "Sync shipments (test)",
        "GET",
        "/api/cron/sync-shipments?mode=test",
        { cron: true },
      ),
      item(
        "Sync shipments (stats)",
        "GET",
        "/api/cron/sync-shipments?mode=stats",
        { cron: true },
      ),
      item(
        "Sync shipments (active)",
        "GET",
        "/api/cron/sync-shipments?mode=active&limit=50",
        { cron: true },
      ),
      item(
        "Sync shipments (full)",
        "GET",
        "/api/cron/sync-shipments?mode=full",
        { cron: true },
      ),
      item(
        "Sync shipments (POST)",
        "POST",
        "/api/cron/sync-shipments?mode=test",
        { cron: true },
      ),
    ]),
    folder("Webhooks", [
      item("Shipway webhook test", "GET", "/api/webhooks/shipway?test=1"),
      item("Shipway webhook POST", "POST", "/api/webhooks/shipway", {
        jsonBody: {
          awb_number: "{{awbNumber}}",
          status: "DELIVERED",
          current_status: "DELIVERED",
        },
        description:
          "Sample Shipway-style payload; processor accepts webhook JSON.",
      }),
    ]),
  ],
};

const env = {
  id: "wm-next-local",
  name: "Warranty Management Local",
  values: [
    { key: "baseUrl", value: "http://localhost:3000", enabled: true },
    { key: "cronSecret", value: "", enabled: true },
    { key: "adminUsername", value: "admin", enabled: true },
    { key: "adminPassword", value: "admin123", enabled: true },
    { key: "ticketId", value: "1", enabled: true },
    { key: "ticketNumber", value: "WT-000001", enabled: true },
    { key: "orderNumber", value: "#CK278358", enabled: true },
    { key: "awbNumber", value: "90592796383", enabled: true },
    { key: "sku", value: "AC-Beam-DAC-Blk-TypeC-3.5", enabled: true },
  ],
  _postman_variable_scope: "environment",
};

fs.writeFileSync(
  path.join(outDir, "Warranty-Management-Nextjs.postman_collection.json"),
  JSON.stringify(collection, null, 2),
);
fs.writeFileSync(
  path.join(outDir, "Warranty-Management-Local.postman_environment.json"),
  JSON.stringify(env, null, 2),
);

console.log("Wrote Postman files to", outDir);
