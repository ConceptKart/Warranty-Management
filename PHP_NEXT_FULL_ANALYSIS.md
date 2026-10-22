# Full analysis: PHP zip vs running Next.js app

**Date:** 22 Oct 2026  
**PHP source (this request):** `C:\Users\Lenovo\Downloads\warranty-management.zip`  
extracted to `C:\Users\Lenovo\Downloads\warranty-management`  
**Running Next app:** `warranty_management_new/` (this folder)

Both apps use the **same Hostinger MySQL** (`u590978274_warmanagement`) and the same external systems: BaseLinker, Shipway, Shopify Admin, SMTP.

This file is the full map: what the Next app already does (with the real rules), what the PHP zip still has, and what is remaining.

Shorter leftovers list: `PHP_TO_NEXT_REMAINING.md`  
API route table: `API_PARITY.md`

---

## 1. What this system is

Concept Kart warranty / 10-day replacement:

1. Customer proves an Amazon or Website (Shopify / conceptkart.com) order.
2. They pick product + issue, maybe follow troubleshooting, then file a claim.
3. A ticket is created (`WR…` warranty or `RP…` replacement).
4. Staff accept it → reverse pickup AWB (customer → warehouse).
5. After inspection / unit replace they create a forward AWB (warehouse → customer).
6. Packer handover, emails, and Shipway status keep the ticket moving.

**Timezone rule:** all claim windows (1 year, 10 days, 20 days) are **IST (`Asia/Kolkata`)**.

---

## 2. Shared data model (both apps)

| Table | Role |
|-------|------|
| `amazon_order_details` | Amazon line items from nightly BaseLinker cron |
| `amazon_sku_mapping` | SKU / product / variant → warranty months |
| `shopify_orders` | Website line items (cron + optional Shopify Admin import) |
| `bl_products` | BaseLinker catalog (name, EAN, category, warranty text) |
| `products` | Local catalog + `warranty_period_months` |
| `customers` / `orders` / `warranty_tickets` | Claim records |
| `ticket_types` / `ticket_statuses` / `issue_types` | Type, workflow, issues |
| `shipments` / `shipment_tracking` | Forward + reverse AWBs |
| `packer_handovers` | Who took the forward parcel |
| `ticket_attachments` / `ticket_comments` / `ticket_status_history` / `ticket_email_log` | Case file |
| External Shipway DB | Live courier status used for 10-day replacement + list refresh |

---

## 3. Next.js app — routes and logic (what is live now)

### 3.1 Portal pages

| URL | File | Logic |
|-----|------|--------|
| `/` | `(portal)/page.tsx` | Order + platform. Also “track existing ticket”. |
| `/issue` | `issue/page.tsx` | Needs verify session. Pick products + issue. |
| `/troubleshoot` | `troubleshoot/page.tsx` | Steps for the chosen issue. Yes → `/resolved`. No → `/claim`. “Issue not listed” skips here. |
| `/resolved` | `resolved/page.tsx` | No ticket created. |
| `/claim` | `claim/page.tsx` | Customer + description + device + uploads. Rehydrates blank Shopify name/phone from `shopify_orders`. |
| `/confirmation` | `confirmation/page.tsx` | Shows new ticket number. |
| `/track` | `track/page.tsx` | Public lookup. Optional live BaseLinker status if the linked order id is numeric. |

Session cookie: `warranty_portal_session` (iron-session, ~4 hours). Compacted in `src/lib/portal/compact-session.ts` so the sealed cookie stays under 4KB (names clipped, troubleshoot HTML dropped, only selected products kept).

### 3.2 Portal APIs

| Method | URL | Logic |
|--------|-----|--------|
| POST | `/api/portal/verify` | `verifyOrder` then save compact session → `/issue` |
| POST | `/api/portal/issue` | Save product/issue; warranty gate; → `/troubleshoot` or `/claim` |
| POST | `/api/portal/claim` | `submitPortalClaim` → `/confirmation` |
| POST | `/api/portal/upload` | Remote file upload, returns URL (max 2 files later on claim; 10MB; jpg/png/gif/mp4/avi/mov/wmv) |
| GET | `/api/portal/product-warranty?sku=` | Remaining days for one SKU |
| GET | `/api/portal/ean-issues?sku=` | Troubleshooting issues for that SKU |

### 3.3 Verify logic (this is the first gate)

File: `src/lib/portal/verify-order.ts`

**Input checks:** order number + platform. Allowed: `amazon`, `website`, `flipkart`. Flipkart is accepted in the dropdown then rejected (“Platform not supported”).

**Amazon**

1. Find rows in `amazon_order_details` by exact Amazon order id.
2. Missing → “Amazon order not found.”
3. Warranty months: mapping by `variant_id`, else `product_id`, then `resolveProductWarranty`.
4. If the order date (IST start of day) is **≥ 1 year ago** → hard reject.
5. Per line: `active` / `expired_by_date` / `no_info`.
6. Always `claim_type = warranty`. No 10-day replacement on Amazon.
7. Customer fields stay empty here; the claim form collects them.
8. Line keys are `productId__sku__index` so `product_id = 0` does not select every checkbox.

**Website / Shopify**

1. Normalize the typed id: `#CK320114`, `CK320114`, `320114`, strip `-W`/`-R`.
2. Load `shopify_orders`.
3. **If no local row:** `importShopifyOrderDirect` (Shopify Admin, then BaseLinker). This is why a same-day COD order can appear after a miss — nightly cron only pulls **yesterday** from BaseLinker.
4. Order date = earliest local row, then live Shopify `created_at` if earlier.
5. Same 1-year block + per-SKU warranty resolve.
6. Then **classification** (warranty vs replacement vs blocked). See 3.5.

### 3.4 Warranty months for a product

File: `src/lib/portal/product-warranty.ts` — `resolveProductWarranty`

Order of lookup (first hit with months > 0 wins):

1. `products.warranty_period_months` (SKU, compact-SKU match)
2. `bl_products.warranty` text (parsed; “no warranty” → 0)
3. Line mapping months from verify (`amazon_sku_mapping`)
4. Mapping by SKU (`base_sku`)
5. Live BaseLinker inventory field **`extra_field_1281`** (inventory 392)

No invented default. Live hits are written back into `bl_products` / mapping.

That is why on `#CK320114` the DAC showed **363 days** (12-month catalog hit) and the AK8 IEM showed **no product warranty listed** (no months in any of those sources). The 10-day replacement window still lets that IEM be claimed.

**Issue continue gate** (`validate-selected-products-warranty.ts`):

- Amazon, or 10-day replacement: always allowed (even 0 months / expired).
- Website **warranty** claim: block if a selected line is expired or has 0 months.

### 3.5 10-day replacement vs “in transit”

File: `src/lib/portal/shopify-classification.ts`

```
AWB on shopify_orders?
  no  → warranty
  yes → look up AWB in external Shipway DB
          not found / DB error → warranty
          status = DELIVERED
            now ≤ delivered + 10 days IST → replacement (RP, claim …-R)
            else → warranty
          status ≠ DELIVERED (e.g. AWB ASSIGNED)
            ask Shopify Admin: is fulfillment delivered?
              yes → treat as DELIVERED using Shopify delivered date (same 10-day window)
              no  → BLOCKED (“in transit… raise only after delivered”)
```

Amazon never uses this.  
`#CK320114` first failed “order not found” (not in `shopify_orders`), then “AWB ASSIGNED / in transit” (Shipway stale). Next now imports from Shopify and trusts Shopify **delivered**, not mere **fulfilled**.

### 3.6 Claim submit logic

File: `src/lib/portal/submit-claim.ts`

Validation:

- Email required.
- Amazon (and Flipkart if it ever verified): name, phone, shipping address required.
- Description **40–400 characters**. Device ≥ 3 characters.
- At least one product. Max 2 attachments, 10MB, listed types.
- Phone stored as last 10 Indian digits (`indianMobileDigits`: drop `91` / leading `0`).

**20-day re-claim** (`resolveSequentialOrderNumber`):

| | First claim | After 20 days |
|---|-------------|----------------|
| Amazon | `{amazonId}W` or `…R` (no dash) | `{amazonId}-02W` |
| Shopify | `{id}-W` or `{id}-R` | `{id}-02W` / `-02R` |

If the latest ticket on that order is **younger than 20 days IST** → block and show the existing ticket + days remaining.

**Ticket number** (`src/lib/tickets/ticket-number.ts`):

- Prefix `WR` (warranty) or `RP` (replacement) + **IST `YYYYMM`** + **MAX+1** 4-digit sequence.
- Not PHP’s first-gap walker (PHP Website reused holes).

Writes **local only**: `customers`, `orders`, `warranty_tickets`, attachments, history.  
`baselinker_integrated = 0`. Priority `high`. Sends `pending` email if SMTP is on.

Does **not** clone a BaseLinker order or set custom fields 5344 / 5345 / 5356 / 6397 / 6398.

### 3.7 Admin pages (Next)

| URL | Who | Logic |
|-----|-----|--------|
| `/admin/login` | all staff | bcrypt vs `admin_users`; 8-hour cookie |
| `/admin` | all | Counts, recent tickets; admin also sees priority + TAT |
| `/admin/tickets` | all viewers | Filters, pagination, export, Bulk Forward, Packer Handover, Change Type, EAN lookup, AWB refresh |
| `/admin/tickets/[ticketNumber]` | all viewers | Full case + actions |
| `/admin/shipments` | `manage_shipments` / `assign_awb` | List, assign AWB, manual status |
| `/admin/tracking` | logistics | Validate / fetch / history / bulk update |
| `/admin/shipway-tracker` | logistics | Live AWB/RMA vs Shipway API |
| `/admin/amazon-orders` | ops | Search, sync one IST day, manual insert |
| `/admin/shopify-import` | `import_shopify_orders` | Search, day sync, **direct Shopify Admin import**, CK status update |
| `/admin/users` | `manage_users` | Create / update / delete |

Roles (`src/lib/auth/permissions.ts`): admin, manager, support, operations, packer.  
Admin session cookie: `warranty_admin_session`, **8 hours**.

### 3.8 Ticket-details actions (Next)

| Action | Logic |
|--------|--------|
| Update Status | Writes history. Emails via `sendForStatus` **except** `accepted`. `accepted` auto-creates Shipway **return** and keeps status Accepted (`persistReverseAwbOnly`). UI then sends accepted email as a **second** request (default / website cable / Amazon cable). `unit_replaced` opens the EAN modal instead of saving status. Reason/notes UI fields are empty. |
| Change Type | Swaps type, resets to first status of new type, swaps `WR`↔`RP` on `ticket_number` and `W`↔`R` on claim + `orders.order_number`. Redirects to the new number. |
| Comment | Always internal in the UI. |
| Custom email | SMTP + `ticket_email_log`. |
| Priority | medium / high / urgent only. |
| Edit customer | Local `customers.phone` + `address` only. |
| Assign AWB | Return / forward via Shipway, or manual. Modal does **not** auto-fill city/state/PIN from the stored address blob. |
| Refresh tracking | External Shipway DB; does not walk status backward or overwrite `is_final`. |
| Replacement EAN / IGI | Local `products` then BaseLinker EAN; save EAN + warehouse + location; IGI document. Next warehouses: `9000461` + `9001939`. |

### 3.9 Shipway return vs forward (Next)

File: `src/lib/admin/shipway-service.ts`

| | Return (customer → warehouse) | Forward (warehouse → customer) |
|--|-------------------------------|--------------------------------|
| API | `Createreturns` | `v2orders` |
| Carrier | Blue Dart `1`. If pincode unserviceable and `SHIPWAY_FALLBACK_CARRIER_ID` is set, retry that. **Never blank.** | **Blank** (PHP parity). Forcing Blue Dart left Amazon forwards in Requested with no AWB. |
| Order id | Strip trailing W/R, append type `W` or `R` | `{claim}P`, then retry `{ticket}P` if no AWB / duplicate |
| AWB extract | Nested `awb_response` | Nested + `getorders` `message[]` walk |
| Empty AWB | Failure | Failure (PHP treated empty AWB as success) |
| Phone | raw | last 10 Indian digits |
| Warehouse | `56024` | `56024` |
| Product extras | `return_reason_id = 76487`, price `1` | price ≥ 1 |

Bulk Forward (`logistics-ops.ts`) parses the customer address from the end: 6-digit PIN, then state, city, rest = street. Missing city/state/PIN → that row fails locally.

Packer Handover: date + AWB filter, mark packer name, counts **total / pending / handed over**.

### 3.10 Ticket-list AWB auto-sync

`getTickets({ syncAwb: true })` on every list load. Silent: should not email, not move backward, not overwrite final statuses. CSV export sets `syncAwb: false` so export does not flood SMTP.

### 3.11 Emails (Next)

`src/lib/email/email-service.ts`

Auto codes: `pending`, `accepted` (only via template picker), `awb_assigned_return`, `return_in_transit`, `return_delivered`, `under_inspection`, `awb_assigned_forward`, `in_transit`, `out_for_delivery`, `delivered`.

Accepted templates:

- default — pickup + packaging video
- `amazon_cable` — no cable warranty on Amazon
- `website_cable` — 6-month cable warranty from original order date

`SMTP_ENABLED=false` until you want Next to mail customers (PHP may still be mailing).

### 3.12 Crons, webhook, CRUD

| Route | Logic |
|-------|--------|
| `/api/cron/sync-shopify` | Yesterday IST (or `?date=`) BaseLinker source `shop` / `9000436` → `shopify_orders` |
| `/api/cron/sync-amazon` | Amazon sources → `amazon_order_details` |
| `/api/cron/sync-shipments` | `changed` / `active` / `full` / `test` / `stats` from external Shipway DB |
| `/api/cron/backfill-warranty` | **Next-only:** fill empty `bl_products.warranty` from BL field 1281 |
| `/api/webhooks/shipway` | Ingest AWB status, log, update shipment/ticket |
| `/api/health` | DB ping |
| `/api/api_*` | Hostinger-style CRUD (cookie or `CRUD_API_KEY`). Next extra: `exclude_status` on tickets |

If `CRON_SECRET` is unset, cron URLs are **open**.

---

## 4. PHP zip — live surface (what the original portal still is)

Navbar in this zip: **Dashboard, Tickets, Users, Return AWB**.

### 4.1 Portal (`public/index.php`)

Same 4 steps as Next (`input` → `issue_selection` → `troubleshooting` → `claim`).  
Verify is **local tables only**. No Shopify Admin fallback. No Shopify-delivered override. Non-DELIVERED Shipway status **blocks**.

Ticket seq: Amazon `MAX+1`; Website `WarrantyModel::generateUniqueTicketNumber()` **walks holes** (`0001`, `0002`, … first free). Month is PHP `date('Ym')` (server TZ).

Website/legacy BaseLinker submit still **clones** the order and writes fields **5344, 5345, 5356, 6397, 6398** (and 4467 on some paths). Amazon submit stays local. Next Website/Shopify submit now clones after the ticket is saved (see 6.1).

### 4.2 Admin PHP pages

| Page | Logic |
|------|--------|
| `tickets.php` | Filters, export, bulk forward (`order + P`, blank carrier), packer, change type (**claim suffix only**), EAN lookup, silent list sync |
| `ticket-details.php` | Status (accepted → return AWB), comments, emails, customer edit, AWB modal, replacement EAN, IGI. Warehouses **SVPL `9000461`** and **CKPL `9002929`**. |
| `users.php` | User CRUD |
| **`return_inventory.php` (Return AWB)** | **Not in Next.** Reads `return_inventory_sync`. Search AWB / order / SKU / EAN. Filters: return type, source, condition, company. Pagination 10–100. Created-at shown as IST (code assumes DB time is UTC). Hardcodes DB credentials in the PHP file (do not copy that). |
| `shipments.php`, `assign_awb.php`, `shipway_tracking.php`, `tracking.php` | Live by URL, not in navbar |
| `correct_shopify_import_order.php` | Live Shopify import + BaseLinker import + CK status update |
| `amazon-order-search.php` | Manual Amazon row insert |

### 4.3 PHP Shipway

- Return: Blue Dart, warehouse `56024`, reason `76487`.
- Forward: **blank `carrier_id`**. Success with empty AWB is still treated as **OK**.
- Change Type: only `claim_number` last char `W`↔`R`. Does **not** rename `WR`/`RP`.

### 4.4 PHP crons / webhook

Same three jobs as Next (`baselinker_sync`, `amazon_sync`, `sync_shipments`) plus webhook `webhook/shipway.php`.  
If both PHP cron and Next cron run, they double-write the same tables.

---

## 5. Feature map — Next vs this PHP zip

| Feature | PHP zip | Next | Notes |
|---------|---------|------|--------|
| Portal verify Amazon | Yes | Yes | Same 1-year gate |
| Portal verify Website | Local `shopify_orders` only | Local **+ live Shopify import** | Next is ahead |
| 10-day replacement | Shipway DELIVERED only | Shipway **or Shopify delivered** | Next is ahead |
| Block in-transit Website | Yes | Yes, unless Shopify says delivered | |
| 20-day re-claim | Yes | Yes | Same IST window |
| Ticket `WR`/`RP` + IST month | Mixed (first-gap + server TZ) | MAX+1 + IST | Conflict if both write |
| Compact session / 4KB cookie | PHP session | Yes | Next-only fix |
| Indian last-10 phone | Mixed | Claim + forward | |
| BL clone + fields 5344… | Website/legacy path | **No** | Remaining |
| Flipkart verify | No (UI leftover) | No | Both missing |
| Dashboard / tickets / users | Yes | Yes | |
| **Return AWB (`return_inventory_sync`)** | **Yes (navbar)** | **No** | Remaining |
| Bulk Forward | Yes | Yes (stricter no-AWB + parse PIN) | |
| Packer handover | Yes | Yes + counts | |
| Change Type | Claim suffix only | Prefix + suffix | Next-only fix; old rows still WR |
| Accepted → auto return | Yes | Yes | |
| Replacement EAN + IGI | Warehouses 9000461 / **9002929** | 9000461 / **9001939** | Conflict |
| Assign AWB address autofill | PHP parse helper | Missing in modal | Remaining |
| Status reason/notes | Yes | Modal + history | Done |
| Custom / accepted emails | Yes | Yes (split calls) | |
| Customer edit → BaseLinker | `update_customer.php` | Local only | Remaining |
| Shopify / Amazon import pages | Yes (orphan URLs) | Yes (in nav) | Next is ahead |
| Shipments / tracking / tracker | Yes (orphan) | Yes (in nav) | |
| Crons + webhook | Yes | Yes | Point one stack only |
| Warranty backfill cron | No | Yes | Next-only |
| Hostinger `api_*` | Yes | Yes + extras | |
| Reports page | Permission only | Permission only | Both missing UI |
| ~150 debug PHP scripts | In zip | Skip | Do not port |

---

## 6. Remaining in Next — with the actual logic

These are the items still to build or decide. Not “screens we forgot,” but **rules PHP still has or Next still does differently**.

### 6.1 BaseLinker clone — done (Website / Shopify only)

PHP `submitWarrantyClaim()` / `cloneOrderWithSelectedProducts()`:

- Clone selected products only, warehouse `9001702`, status 8111.
- Write **5344** = `warranty` or `10-Day Replacement`.
- Write **5345** = ticket number, **5356** = description, **6397/6398** = upload URLs.

Next now does the same after the ticket is saved (`src/lib/baselinker/clone-order.ts`). Ticket first; clone failure does not drop the claim. Shopify products match original SKUs because Next session `product_id` is synthetic. Amazon stays local.

**Customer edit** in Next still updates `customers` only. PHP `update_customer.php` can push name/phone/address into BaseLinker.

### 6.2 Return AWB page (new in this zip)

PHP `public/admin/return_inventory.php` is in the navbar.

Logic: query `return_inventory_sync`, filters (AWB, order id, SKU, EAN, return type, source, condition, company), pagination, IST display.

**Next has no page, no API, no nav link.** This is the largest *new* gap vs the zip you attached.

### 6.3 Replacement warehouse IDs

PHP ticket-details: **9000461 (SVPL)** and **9002929 (CKPL)**.  
Next modal / inventory helper: **9000461** and **9001939**.

If CKPL is now `9002929`, Next IGI/stock is looking at the wrong warehouse.

### 6.4 Operator UI still short

1. **Assign AWB modal** — user must type city/state/PIN. Bulk Forward and auto-return already use `parseCustomerAddress`. Same helper should pre-fill the modal (Amazon addresses are one blob with an embedded 6-digit PIN).
2. **Status modal** — reason/notes boxes now post to history (done).
3. **Tickets list buttons** — Bulk Forward / Change Type / Refresh hide without the matching permission (done).
4. **Accepted email** — second HTTP call after status; status can succeed and email fail.
5. **Customer-visible comments** — API supports `is_internal: false`; UI never uses it.
6. **Admin session 8 hours** vs PHP long cookie.
7. **No Reports UI**; delete ticket only via `/api/api_tickets`.

### 6.5 Dual-app conflicts (if PHP stays live)

Same database, two writers:

- Ticket numbers: PHP first-gap vs Next MAX+1; PHP `date('Ym')` vs IST.
- Change Type: PHP leaves `WR` on Replacement; Next renames on new clicks only. ~1812 old replacement tickets can still be `WR…`.
- Forward: PHP blank carrier + empty AWB = success; Next blank carrier + empty AWB = fail + `{ticket}P` retry.
- `DATETIME` stored without timezone: Next now prints IST wall-clock (1.8 done). PHP+Next dual write can still mix clocks until PHP stops.
- Two crons / two webhooks double-update shipments.

**Rule:** after Next is the panel of record, stop PHP portal + tickets + ticket-details + cron + webhook.

### 6.6 Small API leftovers (only if something still calls them)

- `ean-issues` SKU-only (PHP also `ean` / `category_id`)
- AWB status by `awb_numbers` body (Next is ticket ids only)
- Public `baselinker.php` facade
- Live `warranty.php` / `product_warranty_calculation*` (superseded by DB `product-warranty`)

### 6.7 Flipkart

Both stacks: validator leftover, no real verify. Port only if you start taking Flipkart claims.

### 6.8 Data backfills (do not run unless asked)

- ~1812 replacement tickets still `WR…`
- ~8 warranty tickets still `RP…`
- Next claims with `baselinker_integrated = 0` (only fixed by building 6.1)

---

## 7. Do not port from the PHP zip

- Root `check_*` / `debug_*` / `fix_*` / `verify_*` scripts (~150 files)
- `setup_admin_users.php`
- PHP first-gap ticket generator
- PHP “forward success with empty AWB”
- Hardcoded DB password inside `return_inventory.php` (if you port Return AWB, use env/`DATABASE_URL`)
- Packer “Scanned EAN” column header with no renderer

---

## 8. Logics that Next already improved (do not undo)

1. Compact portal cookie (iron-session 4KB).
2. Shopify live import on verify miss.
3. Shopify **delivered** overrides stale Shipway `AWB ASSIGNED`.
4. Forward blank carrier + getorders walk + `{ticket}P` retry.
5. Change Type also renames `WR`/`RP`.
6. Indian last-10 mobile on forward.
7. Warranty resolve writes live BL field 1281 back to `bl_products`.
8. Packer AWB totals.
9. Admin nav includes Shopify import, Amazon orders, shipments, tracking.

---

## 9. Suggested remaining work order

1. **Deploy** this Next tree and **stop PHP writes** (portal + admin tickets + cron + webhook).
2. **Port Return AWB** (`return_inventory_sync`) — it is in the PHP navbar and missing here.
3. **Align warehouses** to `9000461` / `9002929` if CKPL moved.
4. **Assign AWB address parse** (stops Amazon pickup/forward form failures).
5. **BaseLinker clone** — done (Website / Shopify).
6. Status notes + role-gated ticket buttons — done.
7. IST/`DATETIME` audit — done.
8. Historical `WR`↔`RP` backfill only if you want old tickets renamed.

---

*Built from the 22 Oct 2026 PHP zip (`public/`, `src/`, `cron/`, `webhook/`, `api/`) and the current Next tree (`src/app`, `src/lib`). Update this file when Return AWB or BL clone is implemented.*
