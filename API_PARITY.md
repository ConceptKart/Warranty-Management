# API Parity: Legacy PHP → Next.js (`warranty_management_new`)

**Question:** Are the main-folder PHP APIs recreated in Next.js with the same logic?

**Short answer:** **Most operational APIs are ported (Full or Partial).** A small set of legacy / unused BaseLinker public APIs are **Missing**. Admin ticket, shipment, Shipway, cron, webhook, and portal claim flows are largely covered.

| Status | Meaning |
|--------|---------|
| **Full** | Equivalent Next route exists; core logic matches PHP intent |
| **Partial** | Ported, but some inputs, actions, or edge cases differ |
| **Different** | Same job, different shape (auth scope, upload model, etc.) |
| **Missing** | No Next API equivalent |

---

## 1. Verdict summary

| Area | Parity |
|------|--------|
| Portal warranty / issues / claim / verify / upload | Strong (DB-based warranty; BL calc APIs skipped) |
| Admin tickets / AWB / tracking / users | Strong |
| Shipway webhook + shipment cron | Full |
| BaseLinker Amazon / Shopify sync crons | Full |
| Public BaseLinker REST facade (`baselinker.php`) | Missing (logic used internally, not exposed) |
| Legacy live BaseLinker warranty calc APIs | Missing (superseded by `product_warranty`) |
| Flipkart verify | Missing on both stacks |

**Production takeaway:** You do **not** need 1:1 clones of every `public/api/*.php` file. You need the **used** portal + admin + cron/webhook paths — and those are mostly present.

---

## 2. Public JSON APIs (`public/api/` + `api/`)

| Legacy PHP | Method | Next.js route | Status | Notes |
|------------|--------|---------------|--------|-------|
| `public/api/product_warranty.php` | GET `?sku=` | `/api/portal/product-warranty` | **Full** | SKU → `bl_products.warranty` → remaining days |
| `public/api/ean_category_issues.php` | GET | `/api/portal/ean-issues` | **Partial** | Next requires `sku`; PHP also accepts `ean` / `category_id` |
| `public/api/warranty_unit_replace.php` | POST `get_stock` / `replace_unit` | `/api/admin/tickets/unit-replace` | **Full** | Admin-auth gated |
| `public/api/get_awb_status.php` | POST `ticket_ids` or `awb_numbers` | `/api/admin/tickets/awb-status` | **Partial** | Ticket IDs ported; `awb_numbers` body not supported |
| `public/api/ean_lookup.php` | POST `{ean}` | `/api/admin/tickets/replacement-ean` (`fetch_product_by_ean`) | **Different** | Admin-only; local `products` then BaseLinker |
| `api/save-uploaded-file.php` | POST session metadata | `/api/portal/upload` | **Different** | Next uploads file to remote and returns URL |
| `webhook/shipway.php` | POST / GET `?test=1` | `/api/webhooks/shipway` | **Full** | Ingest + local update |
| `public/api/warranty.php` | GET/POST live BL warranty field | — | **Missing** | Unused by current portal JS; live inventory field lookup |
| `public/api/product_warranty_calculation.php` | POST live BL calc | — | **Missing** | Legacy / test harness; superseded |
| `public/api/product_warranty_calculation_fixed.php` | POST | — | **Missing** | Same as above |
| `public/api/baselinker.php` | GET/POST actions | — | **Missing** | No public facade; BL used in cron/libs only |
| `public/api/update_customer.php` | POST update BL customer | — | **Missing** | Claim stores customer on ticket; no BL customer update API |
| `public/api/category_issues.php` | GET by category name | — | **Missing** | Portal uses EAN/SKU guide; category table used server-side only |

---

## 3. Cron jobs

| Legacy PHP (CLI) | Next.js HTTP | Status | Notes |
|------------------|--------------|--------|-------|
| `cron/baselinker_sync.php` | `/api/cron/sync-shopify` | **Full** | Shopify/Website → `shopify_orders` |
| `cron/amazon_sync.php` | `/api/cron/sync-amazon` | **Full** | Amazon sources → `amazon_order_details` |
| `cron/sync_shipments.php` | `/api/cron/sync-shipments` | **Full** | Modes: `changed` / `active` / `full` / `test` / `stats` |

Protect Next crons with `x-cron-secret: $CRON_SECRET`.

---

## 4. Admin AJAX (PHP pages → Next routes)

### 4.1 `public/admin/tickets.php`

| PHP action | Next route | Status |
|------------|------------|--------|
| `bulk_forward_shipment` | `POST /api/admin/tickets/bulk-forward` | **Full** |
| `get_todays_forward_awb` | `POST /api/admin/tickets/packer-handover` | **Full** |
| `mark_handover` | `POST /api/admin/tickets/packer-handover` | **Full** |
| `change_ticket_type` | `POST /api/admin/tickets/change-type` | **Full** |
| `lookup_by_replacement_ean` | `POST /api/admin/tickets/lookup-ean` | **Full** |
| `update_local_status` | `POST /api/admin/tickets/update-local-status` | **Full** |
| `?export=csv` | `GET /api/admin/export-tickets` | **Full** |

### 4.2 `public/admin/ticket-details.php`

| PHP action | Next route | Status |
|------------|------------|--------|
| `update_status` | `POST /api/admin/tickets/status` | **Partial** (email_template on same action not mirrored; accepted email is separate) |
| `update_priority` | `POST /api/admin/tickets/priority` | **Full** |
| `add_comment` | `POST /api/admin/tickets/comment` | **Full** |
| `assign_awb` | `POST /api/admin/tickets/awb` | **Full** |
| `update_customer_info` | `POST /api/admin/tickets/customer` | **Full** |
| `refresh_tracking` | `POST /api/admin/tickets/tracking` | **Full** |
| `send_custom_email` | `POST /api/admin/tickets/email` | **Full** |
| `send_accepted_email` | `POST /api/admin/tickets/email` (`action=accepted`) | **Full** |
| `fetch_product_by_ean` | `POST /api/admin/tickets/replacement-ean` | **Full** |
| `get_replacement_product_info` | same | **Full** |
| `save_replacement_ean` | same | **Full** |
| unit replace (via `warranty_unit_replace.php`) | `POST /api/admin/tickets/unit-replace` | **Full** |

### 4.3 Shipments / AWB / tracking / users

| Legacy | Next route | Status |
|--------|------------|--------|
| `shipments.php` → `assign_awb` | `POST /api/admin/shipments/assign` | **Full** |
| `shipments.php` → `update_status` | `POST /api/admin/shipments/update-status` | **Full** |
| `tracking.php?awb=` | `GET /api/admin/shipments/tracking?awb=` | **Full** |
| `assign_awb.php` | `/api/admin/tickets/awb` + `/api/admin/shipments/assign` | **Full** |
| `shipway_tracking.php` (`validate_awb`, `fetch_tracking`, `get_shipment_history`, `bulk_update`) | `POST /api/admin/shipway-tracking` | **Full** |
| `public/shipway_tracker.php` → `track` | `POST /api/admin/shipway-tracker` | **Full** |
| `users.php` create/update/delete | `POST /api/admin/users` | **Full** |

---

## 5. Portal flows (PHP page logic → Next APIs)

These were mostly form/session flows in `public/index.php`, not separate `public/api/*` files:

| Legacy behavior | Next route | Status |
|-----------------|------------|--------|
| Order verify | `POST /api/portal/verify` | **Full** |
| Issue selection + warranty gate | `POST /api/portal/issue` | **Full** |
| Claim submit | `POST /api/portal/claim` | **Full** |
| Media upload | `POST /api/portal/upload` | **Full** / **Different** vs `save-uploaded-file.php` |

---

## 6. Next-only APIs (no direct PHP REST twin)

| Next route | Purpose |
|------------|---------|
| `GET /api/health` | DB health check |
| `POST /api/admin/login` | JSON admin login |
| `POST /api/admin/logout` | JSON logout |
| `GET /api/admin/me` | Session probe |
| `GET/POST /api/admin/amazon-orders` | Amazon search / sync_day / insert (page logic in PHP) |
| `GET/POST /api/admin/shopify-orders` | Shopify search / sync_day |
| `GET /api/admin/tickets/export` | Redirect shim → `export-tickets` |

---

## 7. Logic sameness (important nuances)

1. **Warranty source of truth changed for portal**  
   Live BaseLinker warranty field APIs (`warranty.php`, `product_warranty_calculation*`) were **not** ported. Active path is DB: `bl_products` / product warranty mapping — matching `product_warranty.php`.

2. **BaseLinker still used**, but not as a public multi-action API  
   Inventory, unit replace, Amazon/Shopify sync call BaseLinker from libs/cron — not via `/api/.../baselinker`.

3. **Shipway**  
   Create (live API), status sync (external Hostinger mirror), webhook, tracker — all present with PHP-equivalent intent.

4. **Auth model**  
   PHP used PHP sessions on admin pages. Next uses iron-session + permission checks on routes.

5. **Not “same URL paths”**  
   Paths were redesigned (`/api/portal/*`, `/api/admin/*`, `/api/cron/*`). Parity is **behavioral**, not URL-identical.

---

## 8. Gap list (if you need closer PHP parity)

| Priority | Gap | Suggested action |
|----------|-----|------------------|
| Low | `baselinker.php` public facade | Skip unless an external tool depends on it |
| Low | `warranty.php` / calculation APIs | Skip if portal only uses DB warranty |
| Medium | `update_customer.php` BL customer update | Port only if BaseLinker customer sync is still required on claim |
| Low | `category_issues.php` | Only if UI still needs category-name listing |
| Low | `get_awb_status` `awb_numbers` body | Add if any client sends AWBs without ticket IDs |
| Low | `ean-issues` `ean` / `category_id` params | Add if callers need them |

---

## 9. Quick scorecard

| Category | Full | Partial / Different | Missing |
|----------|------|---------------------|---------|
| Public `public/api/*` (+ upload/webhook) | 3 | 4 | 5 |
| Crons | 3 | 0 | 0 |
| Admin ticket/shipment/tracking/users AJAX | ~20 | 1–2 | 0 |
| Portal verify/issue/claim | 3 | 0 | 0 |

**Conclusion:** For day-to-day warranty operations (portal + admin + Shipway + BaseLinker sync), **yes — the same logic is largely created in Next.js**.  
It is **not** a complete file-for-file clone of every legacy public API; unused or superseded BaseLinker helper endpoints remain missing on purpose.

---

## 10. Hostinger `api_*` CRUD parity (added)

Live PHP paths under `conceptkart.co.in/warranty-management/api/api_*` are mirrored in Next as:

| Hostinger PHP | Next.js route | Methods | Notes |
|---------------|---------------|---------|-------|
| `api_users` | `/api/api_users` | GET/POST/PUT/DELETE | `admin_users`; list returns `{total,data}` |
| `api_tickets` | `/api/api_tickets` | GET/POST/PUT/DELETE | `?search=`, `?id=`, `?page&limit` |
| `api_ticket_statuses` | `/api/api_ticket_statuses` | GET/POST/PUT/DELETE | Full CRUD (PHP was mostly GET) |
| `api_shipments` | `/api/api_shipments` | GET/POST/PUT/DELETE | `?id=`, `?awb=` |
| `api_orders` | `/api/api_orders` | GET/POST/PUT/DELETE | **Fixed** `?id=` (PHP 500) |
| `api_customers` | `/api/api_customers` | GET/POST/PUT/DELETE | **Fixed** `?id=` (PHP 500) |
| `api_category_issues` | `/api/api_category_issues` | GET/POST/PUT/DELETE | Full CRUD |
| `api_bl_products` | `/api/api_bl_products` | GET/POST/PUT/DELETE | **Fixed** `?id=` |
| `api_baseorders` | `/api/api_baseorders` | GET/POST/PUT/DELETE | New; needs `baseorders` table |

Auth: admin session cookie **or** `x-crud-api-key: $CRUD_API_KEY`.

Libs: `src/lib/crud/*`. Response shape matches PHP `{status, data, page, limit, total_records, total_pages}`.

---

*Generated from comparison of the main PHP tree (`public/api`, `api`, `webhook`, `cron`, `public/admin`) against `warranty_management_new/src/app/api`.*
