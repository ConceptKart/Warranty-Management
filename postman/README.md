# Postman collection — Warranty Management (Next.js)

## Files

- `Hostinger-CRUD-APIs.postman_collection.json` — **Hostinger PHP parity** `/api/api_*` CRUD (users, tickets, orders, shipments, …)
- `Warranty-Management-Nextjs.postman_collection.json` — Admin / portal / cron `/api/*` endpoints
- `Warranty-Management-Local.postman_environment.json` — local app variables (`baseUrl`, `crudApiKey`, ids)
- `Third-Party-Data-Fetch.postman_collection.json` — BaseLinker + Shipway external APIs
- `Third-Party-Data-Fetch.postman_environment.json` — third-party tokens / IDs

## Import

1. Open Postman → **Import**
2. Import `Hostinger-CRUD-APIs.postman_collection.json` + `Warranty-Management-Local.postman_environment.json`
3. Top-right: select environment **Warranty Management Local**
4. (Optional) Also import `Warranty-Management-Nextjs.postman_collection.json` for admin/portal/cron

## Usage (local DB)

1. Ensure `.env` has local `DATABASE_URL` and `CRUD_API_KEY=dev-test-key`
2. Start the app: `npm run dev`
3. Open collection **Hostinger CRUD APIs (Next.js)**
4. Run **0. Health → Health check**, then any **List / Get** request
5. Collection auth sends `x-crud-api-key: {{crudApiKey}}` automatically

### Quick checks for your questions
| Question | Request |
|----------|---------|
| Channel Amazon / Conceptkart | `api_orders` → Get by id → `source_platform` |
| Ticket exists | `api_tickets` → Search |
| Products on ticket | `api_tickets` → Get by id → `selected_products_json` |
| Ticket status | same → `status_id` |

6. **Admin/Portal collection:** Login first for cookie session; portal needs Verify first
7. **Cron APIs:** set `cronSecret` if `CRON_SECRET` is set in `.env`

## Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `baseUrl` | `http://localhost:3000` | API host |
| `adminUsername` / `adminPassword` | `admin` / `admin123` | Admin login |
| `orderNumber` | sample order | Portal / Amazon search |
| `ticketId` | `1` | Ticket actions |
| `awbNumber` | sample AWB | Shipway / shipments |
| `sku` | sample SKU | Warranty / EAN |
| `cronSecret` | empty | Cron header |

Regenerate collection after API changes:

```bash
node scripts/generate-postman.mjs
```
