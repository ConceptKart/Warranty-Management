# Warranty Management (Next.js) — Project Flow & Components

This document describes **how the application works**, its **main flows**, and the **components / domains** you need when designing a data schema.  
It is **not** a database schema file.

---

## 1. What the system is

Concept Kart **Warranty & Replacement Management**:

- Customers verify an order and submit a **warranty** or **10-day replacement** claim.
- Support / operations staff manage **tickets**, **shipments (AWB)**, **tracking**, and **emails**.
- Background jobs sync **Amazon / Website (Shopify) orders** from BaseLinker and **shipment status** from Shipway.

**Stack (reference):** Next.js App Router · React · TypeScript · Prisma (MySQL) · iron-session · SMTP · BaseLinker API · Shipway API.

---

## 2. Actors

| Actor | Role |
|--------|------|
| **Customer** | Uses the public portal: verify order → pick product/issue → troubleshoot → claim → track ticket |
| **Admin** | Full access: users, export, all ticket/shipment actions |
| **Manager** | Tickets, reports, export, statuses, comments (no user management) |
| **Support** | Tickets and status updates; limited logistics |
| **Operations** | Shipments, AWB assign, tracking |
| **Packer** | Pack / handover style actions; shipment view |
| **External systems** | BaseLinker (orders), Shipway (AWB/tracking/webhooks), SMTP (email), optional remote upload host |

Roles drive **permissions** (who can export, assign AWB, manage users, etc.).

---

## 3. High-level system map

```
┌─────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Customer   │────▶│  Portal (UI)     │────▶│  Portal APIs    │
│  Browser    │     │  / /issue /claim │     │  + sessions     │
└─────────────┘     └──────────────────┘     └────────┬────────┘
                                                      │
┌─────────────┐     ┌──────────────────┐     ┌────────▼────────┐
│  Staff      │────▶│  Admin (UI)      │────▶│  Admin APIs     │
│  Browser    │     │  /admin/*        │     │  + permissions  │
└─────────────┘     └──────────────────┘     └────────┬────────┘
                                                      │
                    ┌──────────────────┐              │
                    │  MySQL Database  │◀─────────────┤
                    └────────▲─────────┘              │
                             │                        │
         ┌───────────────────┼────────────────────────┤
         │                   │                        │
┌────────┴────────┐  ┌───────┴────────┐     ┌─────────�┤
         │                   │                        │
┌────────┴────────┐  ┌───────┴────────┐     ┌─────────┴─────────┐
│ BaseLinker cron │  │ Shipway cron / │     │ SMTP + optional   │
│ Amazon/Shopify  │  │ webhook        │     │ remote file upload│
└─────────────────┘  └────────────────┘     └───────────────────┘
```

---

## 4. Customer portal flow

Portal steps are separate routes. State is kept in a **portal session cookie** after order verify.

### 4.1 Flow (happy path)

```
1. Verify order          (/) 
       │  platform: amazon | website | (flipkart listed but not fully supported)
       ▼
2. Issue selection       (/issue)
       │  pick product(s) + issue type
       │  warranty gate (website): block expired / no-warranty unless 10-day replacement
       ▼
3a. Troubleshooting      (/troubleshoot)     ── if issue is listed
       │
       ├─ Resolved? YES → (/resolved)  [end]
       └─ Resolved? NO  → continue
       ▼
3b. Claim form           (/claim)            ── or skip troubleshoot if "issue not listed"
       │  customer details, description, attachments
       ▼
4. Submit claim          (API)
       │  creates ticket (+ related records)
       │  may send confirmation email
       ▼
5. Confirmation          (/confirmation)
       │
6. Track anytime         (/track?ticket=...)
```

### 4.2 Verify order — business rules (conceptual)

- Customer enters **order number** + **platform**.
- System loads order + line items from local order tables (Amazon / Website-Shopify sync).
- For each product, compute:
  - **Warranty**: months from mapping / catalog (`bl_products` style warranty text), remaining days, active vs expired.
  - **10-day replacement** (Website): needs delivery + AWB delivered within window; otherwise warranty path only.
- Amazon claims: product warranty display/rules differ; Amazon is not blocked the same way as Website on issue continue.
- Flipkart: allowed as a platform choice in validation, but **no full verify path** (same limitation as legacy PHP).

### 4.3 Issue selection

- Load products from session.
- Load issue list by SKU (EAN / category troubleshooting guides when available).
- **Warranty eligibility gate (Website, non-replacement):** cannot continue if selected product is expired or has zero warranty months.
- **Replacement window:** can continue even if product warranty expired / missing.
- Choosing “issue not listed” skips troubleshooting and goes to claim.

### 4.4 Claim submit

- Uses session: order, selected products, issue.
- Collects customer name/email/phone, shipping address, description, device, files.
- Creates a **warranty ticket** (and links to customer/order/product as implemented).
- Stores attachments (local and/or remote upload URL).
- Logs outbound email attempts when notifications fire.

### 4.5 Track / confirmation

- Customer looks up ticket by number.
- Shows ticket status; may overlay **live BaseLinker status** when the linked order id is a numeric BaseLinker id (not Amazon `#CK…` style ids).

### 4.6 Portal UI / API components

| Area | Pages | Key APIs / libs |
|------|--------|-----------------|
| Verify | `/` | `POST /api/portal/verify` · `verify-order` |
| Issue | `/issue` | `POST /api/portal/issue` · `GET /api/portal/ean-issues` · warranty gate |
| Troubleshoot / resolved | `/troubleshoot`, `/resolved` | session issue data |
| Claim | `/claim` | `POST /api/portal/claim` · `POST /api/portal/upload` · rehydrate Shopify customer |
| Warranty helper | — | `GET /api/portal/product-warranty` |
| Track / confirm | `/track`, `/confirmation` | `track-ticket` · live BaseLinker status |

---

## 5. Admin application flow

### 5.1 Auth

```
Login (/admin/login) → session cookie → protected /admin/*
Logout → clear session
```

Passwords are bcrypt hashes in admin users. Roles map to a **permission matrix** (export, AWB, users, packer handover, etc.).

### 5.2 Core staff loop

```
Dashboard (/admin)
    │  counts, recent tickets, (admin) priority/TAT stats
    ▼
Tickets list (/admin/tickets)
    │  filters, export CSV, logistics actions (bulk/packer where allowed)
    ▼
Ticket details (/admin/tickets/{ticketNumber})
    │
    ├─ Update status / change type / priority
    ├─ Internal comments
    ├─ Edit customer
    ├─ Send email (accepted template or custom)
    ├─ Assign AWB (manual or Shipway create forward/return)
    ├─ Refresh shipment tracking / sync mapped status → ticket status
    ├─ Email log (subject, failure, body preview)
    └─ Previous claims for same order
```

### 5.3 Logistics & tools

| Page | Purpose |
|------|---------|
| `/admin/shipments` | Shipment list, assign AWB, update status |
| `/admin/tracking` | Shipway tracking ops (fetch/history/bulk style) |
| `/admin/shipway-tracker` | Live AWB / RMA lookup against Shipway |
| `/admin/amazon-orders` | Search Amazon orders; day sync from BaseLinker; manual insert if cron missed |
| `/admin/users` | Create/update/delete admin users (admin only) |

### 5.4 Admin components (conceptual)

- **Auth:** login, session, permissions.
- **Dashboard:** aggregates over tickets/statuses.
- **Tickets:** list, filters, export, logistics UI.
- **Ticket details:** status history, comments, attachments, shipment card, email log, previous claims.
- **Shipments / tracking / Shipway tracker.**
- **Amazon order ops.**
- **User management.**
- **Email service** (SMTP + ticket email log).

---

## 6. Background & integration flows

### 6.1 Order sync (BaseLinker)

```
Cron → /api/cron/sync-amazon     → upsert Amazon order rows (by day)
Cron → /api/cron/sync-shopify    → upsert Website/Shopify order rows (by day)
Admin UI (Amazon day sync)        → same engines on demand
```

These feeds power **portal verify**. Without sync, customers cannot find recent orders.

### 6.2 Shipment sync (Shipway)

```
Cron → /api/cron/sync-shipments
         modes: changed | active | full | test | stats
         → refresh AWB status, may update ticket workflow status (with guards)

Webhook → POST /api/webhooks/shipway
         → ingest Shipway event, log, update shipment/ticket when matched
```

### 6.3 Email

```
Claim created / status change / admin action
    → SMTP send
    → write ticket_email_log (recipient, subject, sent flag, error, body html)
```

### 6.4 External DBs / services (optional)

- **External Shipway DB** (Hostinger return-orders style): used for some AWB classification / sync paths when configured.
- **Remote warranty upload URL:** claim images may be pushed to a remote PHP handler URL if configured.

---

## 7. Data domains (for your schema design)

Use these as **entity groups**. Names below are domain concepts, not a finished DDL.

### 7.1 Identity & access

- **Admin user** — username, password hash, name, email, role, active, last login.
- **Role / permission** — admin, manager, support, operations, packer → capabilities (manage users, export, assign AWB, etc.).

### 7.2 Customers & catalog

- **Customer** — email, name, phone, address; optional BaseLinker customer id.
- **Product (catalog)** — name, SKU, EAN, category, warranty months, replacement days.
- **Product warranty source (Website)** — SKU → warranty text/months from catalog sync table (`bl_products` style).
- **Amazon SKU mapping** — Amazon SKU → warranty period (when used).
- **Troubleshooting guide** — issues / steps by EAN or category.

### 7.3 Orders (multi-source)

- **Canonical order** (CRM-style) — BaseLinker order id, platform, dates, warranty/replacement windows, link to customer.
- **Order line items** — product, quantity, price.
- **Amazon orders mirror** — synced Amazon order id, SKU, order date, etc. (portal Amazon verify).
- **Shopify / website orders mirror** — shopify order id, SKU, EAN, customer fields, order date, AWB/delivery fields for 10-day logic.

### 7.4 Tickets (core case file)

- **Ticket type** — warranty vs replacement (and codes).
- **Ticket status** — per type, sort order, final flag, color.
- **Warranty ticket** — ticket number, claim number, order/product links, selected products JSON, quantities, issue type, status, priority, customer snapshot, description, notes, timestamps, platform source.
- **Status history** — old/new status, who changed, reason, notes, time.
- **Comments** — author, text, internal vs customer-visible, time.
- **Attachments** — file path / remote URL, ticket link.
- **Issue types** (lookup) — if used separately from EAN guides.

### 7.5 Logistics

- **Shipment** — ticket link, AWB, courier, forward vs reverse, status, tracking URL.
- **Shipment tracking events** — timeline points (status, location, time).
- **Shipway config / cache / webhook logs** — API settings, cached lookups, inbound webhook audit.

### 7.6 Communications

- **Ticket email log** — recipient, subject, status code/trigger, sent yes/no, error message, body HTML, sent at.

### 7.7 Session (not necessarily DB tables)

- **Admin session** — cookie (iron-session): user id, role, name.
- **Portal session** — cookie: verified order payload, platform, selected issue/products, ticket number after submit.

---

## 8. Key relationships (conceptual)

```
Customer 1──* Order 1──* OrderProduct *──1 Product

Order 1──* WarrantyTicket
Product 1──* WarrantyTicket   (or ticket stores selected_products_json for multi-item)

TicketType 1──* TicketStatus
TicketType 1──* WarrantyTicket
TicketStatus 1──* WarrantyTicket

WarrantyTicket 1──* StatusHistory
WarrantyTicket 1──* Comment
WarrantyTicket 1──* Attachment
WarrantyTicket 1──* EmailLog
WarrantyTicket 1──* Shipment 1──* TrackingEvent

AdminUser   (actors on history / comments / AWB assign)
AmazonOrderMirror / ShopifyOrderMirror   (feed portal verify; may link into Order)
```

Design note from current system: the live MySQL dump often has **few formal foreign keys**; the app joins by ids in queries. Your new schema can add real FKs if you want stricter integrity.

---

## 9. Business rules that affect schema design

1. **Two claim paths:** warranty vs 10-day replacement (ticket type + eligibility fields on order/delivery/AWB).
2. **Multi-product claims:** selected products often stored as JSON on the ticket as well as/instead of normalized lines.
3. **Platform-specific order sources:** Amazon vs Website need different mirrors or source flags.
4. **Status workflows differ by ticket type** (status rows belong to a type).
5. **Final / protected statuses** should not be overwritten blindly by shipment cron.
6. **Email audit** needs subject, body, success/failure for support debugging.
7. **AWB direction:** forward (to customer) vs reverse (return pickup) can coexist on one ticket.
8. **Permissions** are role-based; either hardcode roles or introduce a permission table.
9. **Idempotent sync:** Amazon/Shopify upserts by external order id + SKU/date windows.
10. **Webhook durability:** log raw payload even when processing fails.

---

## 10. Page map (UI surface)

### Portal
| Route | Purpose |
|-------|---------|
| `/` | Order verify |
| `/issue` | Product + issue |
| `/troubleshoot` | Guided steps |
| `/resolved` | Issue fixed |
| `/claim` | Submit claim |
| `/confirmation` | Success |
| `/track` | Public ticket track |

### Admin
| Route | Purpose |
|-------|---------|
| `/admin/login` | Staff login |
| `/admin` | Dashboard |
| `/admin/tickets` | Ticket list |
| `/admin/tickets/[ticketNumber]` | Ticket detail |
| `/admin/shipments` | Shipments |
| `/admin/tracking` | Tracking ops |
| `/admin/shipway-tracker` | AWB/RMA lookup |
| `/admin/amazon-orders` | Amazon order tools |
| `/admin/users` | User management |

---

## 11. Suggested reading order when designing schema

1. **Ticket + status + type** (center of the product).  
2. **Customer + order + order lines + product**.  
3. **Amazon / Shopify mirror tables** (portal verify inputs).  
4. **Shipment + tracking + Shipway logs**.  
5. **Comments, attachments, email log, status history**.  
6. **Admin users + roles**.  
7. **Warranty/troubleshooting lookups** (SKU warranty, EAN issues).

---

## 12. Out of scope / known gaps (for design honesty)

- **Flipkart:** UI choice exists; full order verify is not implemented.
- **Cron/webhook cutover:** Next exposes APIs; production host must point jobs at Next when leaving PHP.
- Debug/setup PHP scripts are not part of this Next product surface.

---

*Document purpose: support schema design discussions. No DDL or Prisma schema is defined here.*
