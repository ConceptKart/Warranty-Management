# Postman collection — Warranty Management (Next.js)

## Files

- `Hostinger-CRUD-APIs.postman_collection.json` — **Hostinger PHP parity** `/api/api_*` CRUD (users, tickets, orders, shipments, …)
- `Warranty-Management-Nextjs.postman_collection.json` — Admin / portal / cron `/api/*` endpoints
- `Warranty-Management-Dokploy.postman_environment.json` — **production** `baseUrl=https://warrantymanagement.conceptkart.co.in`
- `Warranty-Management-Local.postman_environment.json` — local `baseUrl=http://localhost:3000`
- `Third-Party-Data-Fetch.postman_collection.json` — BaseLinker + Shipway external APIs
- `Third-Party-Data-Fetch.postman_environment.json` — third-party tokens / IDs

## Import (Dokploy / production)

1. Open Postman → **Import**
2. Import:
   - `Hostinger-CRUD-APIs.postman_collection.json`
   - `Warranty-Management-Dokploy.postman_environment.json`
   - (optional) `Warranty-Management-Nextjs.postman_collection.json`
3. Top-right: select **Warranty Management Dokploy**
4. `baseUrl` = `https://warrantymanagement.conceptkart.co.in`

## Usage (Dokploy — no local server)

1. Fix `SESSION_SECRET` (≥32 chars) on Dokploy runtime if health/login fails
2. **Health:** `GET {{baseUrl}}/api/health`
3. **Login** (no CRUD_API_KEY set): `POST {{baseUrl}}/api/admin/login` with admin user → keep cookies
4. Then List/Get tickets, orders, etc.
5. Prefer **GET** on live data

### Claim + phone (e.g. WR2026100427)
1. **0. Auth + Health → Admin Login** (cookie auth)
2. Set env `ticketSearch` = `WR2026100427`
3. **2. api_tickets → Search ticket (claim / phone)**
4. **Get order (phone fallback)** — uses saved `orderId` → field **`customer_phone`**

After deploy of ticket join: Search alone returns `customer_phone`.

### Quick checks
| Question | Request |
|----------|---------|
| Phone for a claim | Search ticket → Get order → `customer_phone` |
| Channel Amazon / Conceptkart | `api_orders` → Get by id → `source_platform` |
| Ticket exists | `api_tickets` → Search |
| Products on ticket | `api_tickets` → Get by id → `selected_products_json` |
| Ticket status | same → `status_id` |

For local testing, use environment **Warranty Management Local** instead.

## Variables

| Variable | Dokploy default | Purpose |
|----------|-----------------|---------|
| `baseUrl` | `https://warrantymanagement.conceptkart.co.in` | API host |
| `adminUsername` / `adminPassword` | `abhishek` / (set in env) | Admin login |
| `orderNumber` | sample order | Portal / Amazon search |
| `ticketId` | `1` | Ticket actions |
| `awbNumber` | sample AWB | Shipway / shipments |
| `sku` | sample SKU | Warranty / EAN |
| `cronSecret` | empty | Cron header |

Regenerate collection after API changes:

```bash
node scripts/generate-postman.mjs
```
