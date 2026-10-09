# Third-Party Data Sources — `warranty_management_new`

This document lists **external systems** the Next.js app calls to **fetch or push data**.  
It does **not** list the app’s own `/api/*` routes (those are internal).

---

## Overview

| Provider | Type | Base / connection | Auth (env) |
|----------|------|-------------------|------------|
| **BaseLinker** | HTTP API | `https://api.baselinker.com/connector.php` | `BASELINKER_TOKEN` |
| **Shipway** | HTTP API | `https://app.shipway.com/api` | `SHIPWAY_EMAIL` + `SHIPWAY_API_KEY` (or `shipway_config` table) |
| **Shipway mirror DB** | MySQL | `EXTERNAL_SHIPWAY_DATABASE_URL` | DB user/password in URL |
| **SMTP (Hostinger)** | Email | `SMTP_HOST` (default `smtp.hostinger.com`) | `SMTP_USERNAME` / `SMTP_PASSWORD` |
| **Remote upload host** | HTTP upload | `WARRANTY_UPLOAD_URL` or `https://conceptkart.co.in/warrantyreplacement.php` | None (multipart POST) |

**Not used:** Direct Shopify Admin API. Shopify/Website orders are fetched **via BaseLinker**.

---

## 1. BaseLinker

### Connection

| Item | Value |
|------|--------|
| URL | `BASELINKER_API_URL` or `https://api.baselinker.com/connector.php` |
| Protocol | `POST` `application/x-www-form-urlencoded` |
| Token | `BASELINKER_TOKEN` |
| Client | `src/lib/cron/baselinker-client.ts` → `baselinkerCall()` |

Related env:

- `BASELINKER_SHOPIFY_SOURCE_ID` (default `9000436`)
- `BASELINKER_AMAZON_SOURCE_IDS` (default `155,306,307`)
- `BASELINKER_INVENTORY_ID` (default `392`)

### Methods used (data fetch / write)

| Method | Direction | Purpose | Implemented in |
|--------|-----------|---------|----------------|
| `getOrders` | **Fetch** | Amazon / Shopify / Website orders; portal live order status | `baselinker-client.ts`, `shopify-sync.ts`, `amazon-sync.ts`, `baselinker-live-status.ts` |
| `getOrderStatusList` | **Fetch** | Map BaseLinker status id → label/description | `baselinker-live-status.ts` |
| `getInventoryProductsList` | **Fetch** | Inventory product list (EAN search pages) | `baselinker/inventory.ts` |
| `getInventoryProductsData` | **Fetch** | Product detail, stock, warehouses | `baselinker/inventory.ts` |
| `addInventoryDocument` | Write | Unit-replace IGI document | `baselinker/inventory.ts` |
| `addInventoryDocumentItems` | Write | Add lines to inventory document | `baselinker/inventory.ts` |
| `setInventoryDocumentStatusConfirmed` | Write | Confirm inventory document | `baselinker/inventory.ts` |

### What data is stored locally after fetch

| Sync / feature | Local tables / use |
|----------------|--------------------|
| Shopify sync | `shopify_orders` |
| Amazon sync | `amazon_order_details` |
| Live track status | Overlay on portal track/confirmation (not always persisted as ticket status) |
| Inventory / EAN | Used for admin replacement / unit replace |

### App entry points that trigger BaseLinker

| Trigger | Path |
|---------|------|
| Cron Shopify sync | `GET/POST /api/cron/sync-shopify` |
| Cron Amazon sync | `GET/POST /api/cron/sync-amazon` |
| Admin Amazon sync day | `POST /api/admin/amazon-orders` (`action=sync_day`) |
| Admin Shopify sync day | `POST /api/admin/shopify-orders` (`action=sync_day`) |
| Portal ticket track | `/track` → `getTicketForTracking()` |
| Portal confirmation | uses same live status helpers |
| Admin EAN / unit replace | `/api/admin/tickets/replacement-ean`, `/api/admin/tickets/unit-replace` |

---

## 2. Shipway (live HTTP API)

### Connection

| Item | Value |
|------|--------|
| Base URL | `SHIPWAY_API_URL` or forced `https://app.shipway.com/api` |
| Auth | HTTP Basic (`email:api_key`) |
| Env | `SHIPWAY_EMAIL`, `SHIPWAY_API_KEY`, `SHIPWAY_TIMEOUT` |
| Fallback | Active row in `shipway_config` table |

Clients:

- `src/lib/admin/shipway-service.ts` — create shipments  
- `src/lib/admin/shipway-tracker.ts` — live AWB / RMA lookup  

### Endpoints used

| Endpoint | Method | Direction | Purpose | File |
|----------|--------|-----------|---------|------|
| `/Createreturns` | POST | Write (+ returns AWB) | Create reverse / return shipment | `shipway-service.ts` |
| `/v2orders` | POST | Write (+ returns AWB) | Create forward shipment | `shipway-service.ts` |
| `/getorders` | GET | **Fetch** | Forward order / AWB search | `shipway-tracker.ts` |
| `/getorders?order_type=R` | GET | **Fetch** | Reverse / RMA search | `shipway-tracker.ts` |
| `/orders` | GET | **Fetch** | Alternate order lookup | `shipway-tracker.ts` |

Query variants used by the tracker include date windows and AWB/RMA filters (see `shipway-tracker.ts`).

### App entry points that trigger Shipway HTTP

| Trigger | Path |
|---------|------|
| Assign AWB (create) | `POST /api/admin/tickets/awb` |
| Bulk forward | `POST /api/admin/tickets/bulk-forward` |
| Auto-return on accepted | ticket status flow → `ticket-details.ts` |
| Live tracker UI | `POST /api/admin/shipway-tracker` |

---

## 3. Shipway status mirror (external MySQL)

Day-to-day **shipment status sync** mostly reads a Hostinger (or local copy) database, **not** continuous Shipway HTTP polling.

| Item | Value |
|------|--------|
| Connection | `EXTERNAL_SHIPWAY_DATABASE_URL` |
| Client | `src/lib/db-external-shipway.ts` |
| Sync logic | `external-shipment-sync.ts`, `external-shipment-sync-service.ts` |

### External tables / data fetched

| Table | Direction | Typical fields used | Purpose |
|-------|-----------|---------------------|---------|
| `orders` | **Fetch** | `awb_number`, `shipment_status`, `courier_name`, `updated_at` | Forward AWB status |
| `shipway_return_orders` | **Fetch** | `tracking_number`, `tracking_status`, `status`, `carrier`, timestamps | Reverse AWB status |

Statuses are mapped (e.g. `DELIVERED` → `delivered`) and written into local `shipments` / `warranty_tickets` / cache.

### App entry points

| Trigger | Path |
|---------|------|
| Cron sync | `GET/POST /api/cron/sync-shipments?mode=changed\|active\|full\|test\|stats` |
| Ticket list AWB sync | `getTickets()` (silent) |
| AWB status refresh | `POST /api/admin/tickets/awb-status` |
| Tracking refresh | `POST /api/admin/tickets/tracking` |
| Portal Shopify classification | `shopify-classification.ts` (delivery / AWB checks) |

---

## 4. SMTP (Hostinger email)

| Item | Value |
|------|--------|
| Host | `SMTP_HOST` (default `smtp.hostinger.com`) |
| Port | `SMTP_PORT` (default `465`) |
| Auth | `SMTP_USERNAME`, `SMTP_PASSWORD` |
| Client | `src/lib/email/email-service.ts` |

**Direction:** outbound only (status / custom / accepted emails). Not used for fetching order/warranty data.

---

## 5. Remote claim file upload

| Item | Value |
|------|--------|
| URL | `WARRANTY_UPLOAD_URL` or `https://conceptkart.co.in/warrantyreplacement.php` |
| Method | `POST` multipart (`mediaFile`, `type=warranty`) |
| Client | `src/lib/portal/upload-to-remote.ts` |
| Trigger | `POST /api/portal/upload` |

**Direction:** upload file → receive remote URL. Not a data-fetch API for orders/tickets.

---

## 6. Data-fetch summary (by domain)

| Domain | Primary third-party fetch | Local store |
|--------|---------------------------|-------------|
| Website / Shopify orders | BaseLinker `getOrders` (source shop) | `shopify_orders` |
| Amazon orders | BaseLinker `getOrders` (sources 155/306/307) | `amazon_order_details` |
| Portal live “current status” on track | BaseLinker `getOrders` + `getOrderStatusList` | Overlay (ticket still local) |
| Product warranty valid/expired | **No third party** — local `bl_products` / mappings | Calculated in app |
| Ticket claim workflow status | **Local MySQL** (+ optional Shipway sync updates) | `warranty_tickets` |
| Forward/reverse AWB create | Shipway HTTP create APIs | `shipments`, ticket AWB columns |
| AWB tracking lookup (admin tracker) | Shipway `getorders` / `orders` | Display / optional local update |
| Ongoing AWB status sync | External Shipway MySQL mirror | `shipments`, ticket status, cache |
| Inventory / EAN / stock | BaseLinker inventory methods | Used in admin actions |

---

## 7. Explicitly not implemented as third-party fetch

| System | Notes |
|--------|-------|
| Shopify Admin / GraphQL API | Not present; Shopify via BaseLinker only |
| Flipkart order API | Not implemented |
| Dedicated “warranty provider” coverage API | Product warranty is local calculation |
| BaseLinker `getOrderProducts` / `getOrderPackages` / `setOrderFields` | Present in legacy PHP; not used in Next |

---

## 8. Env checklist for live fetch

```env
BASELINKER_TOKEN=...
BASELINKER_API_URL=https://api.baselinker.com/connector.php
BASELINKER_SHOPIFY_SOURCE_ID=9000436
BASELINKER_AMAZON_SOURCE_IDS=155,306,307

SHIPWAY_EMAIL=...
SHIPWAY_API_KEY=...
SHIPWAY_API_URL=https://app.shipway.com/api

EXTERNAL_SHIPWAY_DATABASE_URL=mysql://...@host:3306/returnorders_db

SMTP_HOST=smtp.hostinger.com
SMTP_USERNAME=...
SMTP_PASSWORD=...

# Optional
WARRANTY_UPLOAD_URL=https://conceptkart.co.in/warrantyreplacement.php
BASELINKER_INVENTORY_ID=392
```

---

*Source of truth: `src/lib/cron/*`, `src/lib/baselinker/*`, `src/lib/admin/shipway-*.ts`, `src/lib/db-external-shipway.ts`, `src/lib/portal/upload-to-remote.ts`, `src/lib/email/email-service.ts`.*
