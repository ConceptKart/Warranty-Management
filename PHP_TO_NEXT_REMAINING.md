# Remaining PHP → Next.js work

**Date:** 21 Oct 2026  
**PHP tree:** repo root (`public/`, `src/`, `cron/`, `webhook/`)  
**Next tree:** `warranty_management_new/`

This is the remaining **behavior and ops** list, not another API map.  
API route mapping already lives in `API_PARITY.md`.

Both apps write the **same Hostinger MySQL**. Most “conflicts showing up right away” come from that: PHP and Next do the same job with different rules, or Next is already stricter while old PHP rows still sit in the database.

---

## How to read this list

| Tag | Meaning |
|-----|---------|
| **Conflict** | PHP and Next already both exist, but they disagree. Live data / tickets / Shipway can diverge if both stay on. |
| **Missing** | PHP still has it; Next does not (or only half). |
| **Next-only fix** | Next already changed this on purpose. Old PHP rows or the old PHP app will still look “wrong” until you deploy / stop PHP / backfill. |
| **Skip** | Do not port. Debug scripts, unused APIs, or PHP bugs. |

Suggested rule: **one writer**. After Next is the panel of record, stop creating tickets, changing type, and creating Shipway orders from PHP.

---

## 1. Conflicts that are already hitting operations

These are the items most likely to produce the mismatches you are seeing now.

### 1.1 Two apps writing the same tickets

| | |
|---|---|
| **Tag** | Conflict |
| **PHP** | `public/index.php`, `public/admin/tickets.php`, `public/admin/ticket-details.php` |
| **Next** | `/`, `/admin/tickets`, `/admin/tickets/[ticketNumber]` |

If portal/admin traffic is split (or bookmarks still hit PHP), you get:

- different ticket numbers for the same month
- Change Type that only flips `W`/`R` on PHP vs WR↔RP on Next
- Shipway forwards with / without Blue Dart
- claim rows with `baselinker_integrated = 1` (PHP clone) next to `0` (Next)

**Remaining change:** cut PHP write traffic (portal + tickets + ticket-details). Keep PHP only as rollback, not as a second live panel.

---

### 1.2 Ticket numbers: first-gap vs MAX+1, server month vs IST

| | |
|---|---|
| **Tag** | Conflict |
| **PHP** | `WarrantyModel::generateUniqueTicketNumber()` walks `WR2026100001`, `0002`, … and **reuses the first hole**. Amazon path `generateAmazonTicketNumber()` uses **MAX+1**. Month is PHP `date('Ym')` (server timezone). |
| **Next** | `src/lib/tickets/ticket-number.ts` — **MAX+1** for every platform, month in **IST**. |

Effects:

- Shopify claims from PHP can reuse a deleted/skipped seq that Next will never pick.
- If both create tickets in the same month, numbers collide or jump.
- Near IST midnight, PHP can stamp the previous/next calendar month if the server is not `Asia/Kolkata`.

**Remaining change:** keep Next MAX+1 + IST as the only generator. Do not port PHP first-gap. Confirm the PHP host timezone before any last PHP-side claim.

---

### 1.3 Change Type: PHP only swaps claim suffix

| | |
|---|---|
| **Tag** | Conflict + Next-only fix |
| **PHP** | `AdminController::changeTicketType()` updates `ticket_type_id`, resets status, swaps last char of `claim_number` (`W`↔`R`). **Does not** rename `ticket_number` or `orders.order_number`. |
| **Next** | `src/lib/admin/replacement-ean.ts` `changeTicketType()` also swaps `WR`↔`RP` on `ticket_number` and `W`↔`R` on `orders.order_number` / `claim_number`. |

Live result you already hit: a Replacement ticket can still show as `WR…` and `CK…-W` if it was changed in PHP, or if it was changed in Next **before** the prefix fix was deployed.

**Remaining change (code):** done for *new* Change Type clicks after deploy.  
**Remaining change (data):** historical backfill was **not** run. Rough count from earlier check: ~1812 replacement tickets still `WR…`, 8 warranty tickets still `RP…`. Only `WR2026100737` was repaired by hand. Do not bulk-rename unless you explicitly ask.

---

### 1.4 Amazon / bulk Forward AWB empty or “no AWB”

| | |
|---|---|
| **Tag** | Conflict + Next-only fix (in code, needs deploy) |
| **PHP** | `ShipwayService::createForwardShipment()` always sends `carrier_id: ''`. Treats Shipway success with empty AWB as **OK**. |
| **Next (before fix)** | Forced Blue Dart (`carrier_id: 1`) on `v2orders`. Then treated no-AWB as failure — that is the `WR20261005565` modal. |
| **Next (current tree)** | Blank `carrier_id` like PHP; walks `getorders` `message[]`; retries once as `{ticket}P` if `…WP` is stuck Requested. |

**Remaining change:** push / redeploy this tree, then retry Bulk Forward on the failed Amazon tickets. Do not keep using PHP forward on the same `…WP` order id while Next is also posting.

---

### 1.5 Forward phone and address payload

| | |
|---|---|
| **Tag** | Conflict |
| **PHP** | Bulk forward sends the **full raw customer address** string and the phone as stored. |
| **Next** | Phone is last-10 Indian digits (`indianMobileDigits`). Street is `parseCustomerAddress().address` (PIN/state/city stripped). City/state/PIN are separate fields. Pincode must be exactly 6 digits or the row fails locally. |

Effects:

- Better for Amazon blobs that embed a 6-digit PIN in one line.
- Worse if the stored address is not comma-separated the way the parser expects (`Could not parse address`).
- Shipway may reject or accept a different courier if PHP sent `+91…` and Next sends `98xxxxxxxx`.

**Remaining change:** tighten `parseCustomerAddress` for the Amazon address shapes you still fail on; optionally pre-fill Assign AWB city/state/PIN from the same parser (see 2.1).

---

### 1.6 Website claims clone BaseLinker orders — done

| | |
|---|---|
| **Tag** | Done |
| **PHP** | `submitShopifyWarrantyClaim()` / `submitWarrantyClaim()` clone the BL order and set custom fields **5344** (warranty vs 10-day replacement), **5345** (ticket number), **5356** (description), **6397/6398** (upload URLs). Sets `baselinker_integrated = 1`. |
| **Next** | After the ticket is saved, `src/lib/baselinker/clone-order.ts` clones selected products to warehouse **9001702**, status **8111**, then writes the same custom fields. Success sets `baselinker_integrated = 1` and `cloned_from_order_id`. Clone failure is logged; the claim stays. Amazon stays local. |

---

### 1.7 Customer edit is local-only

| | |
|---|---|
| **Tag** | Missing |
| **PHP** | Ticket-details POST updates local `customers`. Separate `public/api/update_customer.php` can push name/phone/address into BaseLinker. |
| **Next** | `POST /api/admin/tickets/customer` updates local `customers` only. |

**Remaining change:** port BL customer update if cloned/original BL orders must stay in sync after a phone/address fix.

---

### 1.8 Hostinger `DATETIME` vs IST display

| | |
|---|---|
| **Tag** | Conflict |
| **PHP** | `date_default_timezone_set('Asia/Kolkata')`. `NOW()` and `date()` are IST if the PHP host is IST. |
| **Next** | Node/`new Date()` is UTC unless formatted with `timeZone: 'Asia/Kolkata'`. MySQL `NOW()` follows the Hostinger session TZ. |

Ticket created-at, AWB created-at, and packer handover times can look shifted by 5:30 if one side stores IST-naive and the other reads it as UTC.

**Remaining change:** one rule for write + read (IST wall-clock in MySQL, always format as IST in UI). Audit list, details, packer handover, emails, CSV export (`ticketsToCsvRows` currently emits ISO UTC).

---

### 1.9 Ticket-list AWB auto-sync

| | |
|---|---|
| **Tag** | Partial / Conflict |
| **PHP** | List auto-sync is silent: no email, no backward status, no overwrite of `is_final`. Manual Refresh emails. |
| **Next** | `getTickets({ syncAwb: true })` on every tickets page load; export turns it off. Implementation is `silentSyncTicketsFromAwbLookup`. |

If silent sync is not actually silent, list loads spam SMTP or move statuses PHP would leave alone.

**Remaining change:** confirm silent sync never emails and never moves a ticket backward / off an admin-set status. Keep export `syncAwb: false`.

---

## 2. Operator UI still short of PHP

### 2.1 Assign AWB modal does not split the stored address — Missing

PHP and Next both require city / state / 6-digit PIN for return/forward.  
Next `AssignAwbButton` puts the raw address in the street box and leaves city/state/PIN empty. Auto-return and Bulk Forward already call `parseCustomerAddress`.

**Remaining change:** on open, parse `defaultAddress` into street / city / state / PIN (same helper as bulk forward).

### 2.2 Status modal has no reason / notes — Missing

`updateTicketStatus` accepts `reason` and `notes`. The Next modal always posts `""`. PHP has those fields.

### 2.3 Packer Handover AWB totals — Next-only fix (deploy)

PHP shows `{n} order(s)`. Next now shows **total AWBs / pending / handed over** in `tickets-logistics.tsx`. Needs deploy.

PHP table header also has **Scanned EAN**; the PHP JS renderer never fills that column. **Skip** (PHP dead column).

### 2.4 Tickets-list buttons are not permission-gated — Conflict

PHP mostly only required login. Next APIs differ (`view_all_tickets`, `edit_tickets`, `assign_awb`) but Bulk Forward / Packer / Change Type still show for every tickets viewer.

**Remaining change:** hide buttons the role cannot call.

### 2.5 Reports and delete-ticket UI — Missing

Permissions `view_reports` and `delete_tickets` exist. No admin Reports page. Ticket delete exists only on Hostinger CRUD `/api/api_tickets`.

### 2.6 Customer-visible comments — Missing

Comment API supports `is_internal: false`. UI always sends internal.

### 2.7 Priority cannot go back to `low` — Same as PHP

Both lock the dropdown to medium / high / urgent. Skip unless you want `low` again.

### 2.8 Accepted email is a second request — Partial

PHP `update_status` can carry `email_template` on the same POST (accepted itself skips the generic mailer).  
Next: status POST, then `/api/admin/tickets/email` `action=accepted`. Works, but a failed second call looks like “status changed, email missing”.

### 2.9 Admin session length — Conflict

PHP admin cookie was effectively long-lived. Next iron-session is **8 hours**. Operators get logged out mid-shift.

### 2.10 Flipkart verify — Missing on both live paths

Next dropdown includes Flipkart and then returns “Platform not supported”. PHP live dropdown is Website + Amazon only (code still has Flipkart validation leftovers). Port only if you start taking Flipkart claims.

---

## 3. Portal / claim leftovers

| Item | Tag | PHP | Next | Remaining |
|------|-----|-----|------|-----------|
| Order verify Amazon + Website | Done | `verifyAmazonOrder` / `verifyShopifyOrder` | `/api/portal/verify` | — |
| 10-day replacement window | Done | AWB + DELIVERED + 10 days IST | `shopify-classification.ts` + external Shipway DB | Needs `EXTERNAL_SHIPWAY_DATABASE_URL` in prod |
| 20-day re-claim sequence (`-02W`) | Done | `resolveSequentialOrderNumber` | `submit-claim.ts` | — |
| Compact portal cookie | Done | PHP session | `compact-session.ts` | — |
| Indian mobile on claim | Done | mixed | `indianMobileDigits` | — |
| Logo / favicon | Done | mixed | `public/images/conceptkart-logo.png` | — |
| BL clone + fields 5344/5345/5356/6397/6398 | Missing | Yes on Website | No | See 1.6 |
| `update_customer.php` | Missing | Yes | No | See 1.7 |
| `ean-issues` by `ean` / `category_id` | Missing | Yes | SKU only | Add if any caller still uses those query params |
| Live `warranty.php` / calculation APIs | Skip | Unused by current portal JS | DB `product-warranty` | Do not rebuild |
| Public `baselinker.php` facade | Skip | Test/tools | Internal libs only | Do not expose unless an external tool still calls it |
| Flipkart verify | Missing | Incomplete | Incomplete | See 2.10 |

---

## 4. Admin surfaces PHP did not even put in the nav

Next **already has** pages PHP left as orphans / one-off scripts. These are not remaining PHP work:

- `/admin/shipments` ← `shipments.php`
- `/admin/tracking` ← `shipway_tracking.php`
- `/admin/shipway-tracker` ← `shipway_tracker.php`
- `/admin/amazon-orders` ← `amazon-order-search.php`
- `/admin/shopify-import` ← `correct_shopify_import_order.php`

No extra port needed unless a specific button on those PHP files is still used and missing.

---

## 5. Crons, webhook, Hostinger CRUD

| Job | PHP | Next | Remaining |
|-----|-----|------|-----------|
| Shopify / Website orders | `cron/baselinker_sync.php` | `/api/cron/sync-shopify` | Point the scheduler at Next; do not run both |
| Amazon orders | `cron/amazon_sync.php` | `/api/cron/sync-amazon` | Same |
| Shipway mirror sync | `cron/sync_shipments.php` | `/api/cron/sync-shipments` | Same |
| Warranty field backfill | — | `/api/cron/backfill-warranty` | Next-only; optional |
| Old Shipway poller | `update_shipments_cron.php` | — | Skip (superseded) |
| Shipway webhook | `webhook/shipway.php` | `/api/webhooks/shipway` | Repoint Shipway dashboard to Next |
| Hostinger `api_*` CRUD | Hostinger PHP | `/api/api_*` | `exclude_status` is Next-only extra — fine. No `type_code=replacement` filter unless you ask |

If `CRON_SECRET` is unset, Next crons are **open**. Set it before advertising the URLs.

---

## 6. Data backfills (do not run unless asked)

| Data | Why it looks like a “Next bug” | Action |
|------|--------------------------------|--------|
| ~1812 replacement tickets still `WR…` | PHP Change Type never renamed the ticket | Optional bulk `WR`→`RP` + claim/order suffix |
| ~8 warranty tickets still `RP…` | Same, opposite direction | Optional |
| Shipway orders stuck Requested (`…WP`, no AWB) | Old Next Blue Dart forward, or duplicate order id | Retry Bulk Forward after deploy (unique `{ticket}P`) |
| `baselinker_integrated = 0` Next claims | Next never cloned | Only fix by porting 1.6, not by SQL |
| Empty Amazon customer on verify | Both stacks; claim form collects address | No backfill |

---

## 7. Production cutover (not code, but still remaining)

From `DEPLOY_DOKPLOY.md` — still required for PHP and Next to stop fighting:

1. Next must keep using live Hostinger `u590978274_warmanagement` (never an empty Dokploy MySQL).
2. `SESSION_SECRET` at **build** time (portal cookie).
3. `EXTERNAL_SHIPWAY_DATABASE_URL` or Website 10-day replacement degrades to warranty.
4. `SMTP_ENABLED=false` until you want customer mail from Next (PHP may still be mailing).
5. `CRON_SECRET` + `CRUD_API_KEY`.
6. Move cron + Shipway webhook to Next, then disable the PHP cron/webhook.
7. DNS / Dokploy to Next only after smoke tests; rollback is DNS back to PHP.

---

## 8. Do not port

- ~150 root `check_*` / `debug_*` / `fix_*` / `verify_*` PHP scripts
- `public/admin/setup_admin_users.php`
- `public/set_test_session.php`, `test_api.php`, `debug_order_search.php`
- `product_warranty_calculation.php` and `_fixed`
- PHP first-gap ticket generator
- PHP “success with empty AWB” on forward
- Packer “Scanned EAN” column (header only in PHP)

---

## 9. Suggested order

1. **Deploy** the current Next tree (blank-carrier forward, ticket prefix on Change Type, packer AWB counts, compact session, logo).
2. **Stop PHP writes** (portal + admin tickets + ticket-details). Leave PHP up only for emergency rollback.
3. **Repoint** Amazon/Shopify/shipment crons and the Shipway webhook to Next. Turn off PHP cron/webhook.
4. **Assign AWB address parse** (2.1) — stops Amazon pickup/forward conflicts on the details page.
5. **BaseLinker clone** (1.6) — done. Customer-edit BL push (1.7) still local-only.
6. **Status reason/notes + role-gated ticket buttons** (2.2 / 2.4).
7. **IST/DATETIME audit** (1.8) if created-at / handover times still look wrong after cutover.
8. **Historical WR↔RP backfill** only if you want old tickets renamed. New Change Type clicks already rename.

---

## 10. Already done in Next (do not redo)

- Portal: verify → issue → troubleshoot / resolved → claim → confirmation → track
- Admin: dashboard, tickets filters/export, ticket details, users
- Shipway return on Accepted (Blue Dart, persist reverse AWB without flipping status)
- Shipway forward + Bulk Forward + Packer Handover
- Replacement EAN + IGI unit replace
- Refresh AWB from external DB
- Status / accepted / custom emails
- Amazon + Shopify import/sync pages
- Shipway webhook + three main crons
- Hostinger `api_*` CRUD
- Compact portal session (cookie &lt; 4KB)
- Conceptkart logo
- Indian last-10 mobile on claim + forward
- Change Type also renames `WR`/`RP` and order suffix (new clicks only)
- Forward blank `carrier_id` + getorders array walk + `{ticket}P` retry (this tree)
- Packer AWB total / pending / handed-over counts (this tree)

---

*Built by comparing live PHP (`public/admin`, `src/controllers`, `src/services`, `cron`, `webhook`) with `warranty_management_new/src`. Update this file when an item is deployed or deliberately dropped.*
