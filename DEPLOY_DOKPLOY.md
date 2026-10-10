# Deploy Next.js on Dokploy + Hostinger MySQL (no live data loss)

Goal: run `warranty_management_new` on **Dokploy**, keep using **Hostinger** DB  
`u590978274_warmanagement` as the single source of truth. PHP can stay live until cutover.

---

## 0. Critical: how data stays safe

| Do | Don’t |
|----|--------|
| Use existing Hostinger MySQL (remote) | Create a new empty MySQL on Dokploy and “migrate” without a plan |
| Take a **full backup** before cutover | Run `prisma migrate reset` / `db push --force-reset` |
| Only `prisma generate` at build (already in Dockerfile) | Run schema migrations that DROP tables |
| Keep PHP site running until Next is verified | Point production DNS to Next on day 1 without smoke tests |
| Prefer GET / read paths first | Bulk DELETE/PUT from Postman on live |

Your app talks to Hostinger over the network. Dokploy does **not** copy or replace the DB unless you configure a second database.

---

## 1. Backup Hostinger DB (mandatory)

1. Hostinger hPanel → **Databases** → **phpMyAdmin** for `u590978274_warmanagement`
2. **Export** → Quick → SQL → Go  
   (or use hPanel backup / JetBackup if available)
3. Save the `.sql` file offline

If anything goes wrong, you can restore this dump.

---

## 2. Prepare Git repo

Dokploy deploys from Git.

1. Push `warranty_management_new` to GitHub/GitLab (private repo OK)
2. Confirm these files exist in the repo:
   - `Dockerfile`
   - `next.config.ts` with `output: "standalone"`
   - `prisma/schema.prisma`
   - `package-lock.json`
3. **Do not commit** `.env` (secrets stay in Dokploy UI)

---

## 3. Allow Dokploy server → Hostinger MySQL

1. Find your **Dokploy VPS public IP** (cloud provider dashboard)
2. Hostinger → **Databases** → **Remote MySQL**
3. Create connection:
   - **IP** = Dokploy VPS IP (or **Any Host** for a short test)
   - **Database** = `u590978274_warmanagement`
4. Click **Create**
5. Wait 1–2 minutes

Hostname (from Hostinger Remote MySQL page): `srv1087.hstgr.io`

Test from the VPS (optional SSH):

```bash
# on Dokploy VPS
nc -vz srv1087.hstgr.io 3306
```

---

## 4. Install / open Dokploy

If Dokploy is not installed yet on a VPS:

```bash
# Official installer (run on a fresh Ubuntu VPS as root)
curl -sSL https://dokploy.com/install.sh | sh
```

Open `http://YOUR_VPS_IP:3000` (or your Dokploy URL), create admin account.

---

## 5. Create the application in Dokploy

1. **Projects** → New Project → e.g. `warranty`
2. **Create Service** → **Application**
3. Name: `warranty-management-new`
4. **Source**: connect Git provider → select repo → branch `main` (or yours)
5. **Root Directory**: if the Next app is in a subfolder, set  
   `warranty_management_new`  
   (if the repo root *is* the Next app, leave blank)
6. **Build Type**: **Dockerfile**
7. **Dockerfile path**: `Dockerfile`
8. **Docker context**: `.` (or the root directory above)
9. **Port**: `3000`

---

## 6. Environment variables (Dokploy → Environment)

Paste these as **runtime** env vars (adjust secrets):

```env
NODE_ENV=production

# LIVE Hostinger MySQL — same data as PHP (do not point at a new empty DB)
DATABASE_URL=mysql://u590978274_warmanagement:Warmanagement%402526%23@srv1087.hstgr.io:3306/u590978274_warmanagement

SESSION_SECRET=replace-with-long-random-32plus-chars

SMTP_ENABLED=true
SMTP_HOST=smtp.hostinger.com
SMTP_PORT=465
SMTP_USERNAME=no-reply@warranty.conceptkart.co.in
SMTP_PASSWORD=your-smtp-password
SMTP_FROM_EMAIL=no-reply@warranty.conceptkart.co.in
SMTP_FROM_NAME=Concept Kart

BASELINKER_TOKEN=your-token
BASELINKER_API_URL=https://api.baselinker.com/connector.php
BASELINKER_SHOPIFY_SOURCE_ID=9000436
BASELINKER_AMAZON_SOURCE_IDS=155,306,307

SHIPWAY_EMAIL=operations@conceptkart.com
SHIPWAY_API_KEY=your-shipway-key
SHIPWAY_API_URL=https://app.shipway.com/api

# Optional Postman / external CRUD
CRUD_API_KEY=long-random-production-key

# Optional cron protection
CRON_SECRET=long-random-cron-secret
```

### Build-time (Dokploy Build Arguments / Build Secrets)

Also pass so `prisma generate` / Next prerender succeed:

```env
DATABASE_URL=mysql://u590978274_warmanagement:Warmanagement%402526%23@srv1087.hstgr.io:3306/u590978274_warmanagement
SESSION_SECRET=replace-with-long-random-string-at-least-32-chars
```

(`SESSION_SECRET` is required at **build** time too — portal pages use iron-session during prerender. Runtime env alone is not enough for Docker builds.)

Password encoding: `@` → `%40`, `#` → `%23`  
(`Warmanagement@2526#` → `Warmanagement%402526%23`)

**Do not** set a Dokploy-managed MySQL as `DATABASE_URL` unless you intentionally migrate data there.

---

## 7. Deploy

1. Dokploy → **Deploy**
2. Watch **Build logs** until success
3. Open the generated URL (or your domain)
4. Check: `https://YOUR_DOMAIN/api/health`  
   Expect: `"database": "connected"`

---

## 8. Domain + SSL (Dokploy)

1. Application → **Domains** → add e.g. `warranty-next.conceptkart.co.in`
2. DNS: create **A record** → Dokploy VPS IP
3. Enable **HTTPS** (Let’s Encrypt) in Dokploy
4. Redeploy / wait for cert

Keep the old PHP URL live until you are happy with Next.

---

## 9. Smoke test (no data loss)

Use GET only first:

| Check | URL |
|-------|-----|
| Health | `/api/health` |
| Tickets | `/api/api_tickets?page=1&limit=5` + header `x-crud-api-key` |
| Orders / channel | `/api/api_orders?page=1&limit=5` → `source_platform` |
| Admin login | `/admin/login` (existing Hostinger users) |
| Portal | Verify an order on the portal flow |

Compare ticket counts with phpMyAdmin / PHP admin. Counts should match live.

Avoid POST/PUT/DELETE in Postman until verified.

---

## 10. Cutover (when ready)

1. Announce maintenance window (optional)
2. Point main warranty domain to Dokploy (or reverse-proxy path)
3. Keep Hostinger MySQL as-is — **no DB move**
4. Retire or redirect PHP only after monitoring looks good
5. Keep the SQL backup for 30+ days

---

## 11. Rollback (if Next has issues)

1. Point DNS / proxy back to PHP Hostinger site
2. Data is still on Hostinger MySQL — **nothing was “moved”**
3. Fix Next on Dokploy, redeploy, cut over again

---

## Optional: EXTERNAL_SHIPWAY_DATABASE_URL

If you use Shipway AWB mirror DB on Hostinger:

1. Find that DB host/user/pass in `config/external_db.php`
2. Allow Dokploy IP in Remote MySQL for that DB too
3. Set `EXTERNAL_SHIPWAY_DATABASE_URL=...` in Dokploy env

If unused, leave unset / local — main warranty still works.

---

## Checklist

- [ ] Hostinger SQL backup saved  
- [ ] Repo pushed with `Dockerfile` + `output: "standalone"`  
- [ ] Dokploy VPS IP allowed in Hostinger **Remote MySQL**  
- [ ] `DATABASE_URL` → `srv1087.hstgr.io` / `u590978274_warmanagement`  
- [ ] No new empty Dokploy MySQL used as primary  
- [ ] `/api/health` → connected  
- [ ] Ticket/order counts match live  
- [ ] PHP still available until cutover  

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Auth failed / Access denied | Remote MySQL: add Dokploy IP; check password encoding |
| Build fails on prisma | Add `DATABASE_URL` as build arg/secret |
| App up but DB disconnected | Runtime env missing `DATABASE_URL`; redeploy after env change |
| Emails to real customers | Set `SMTP_ENABLED=false` until go-live |
| Wrong data / empty tables | You pointed at a new Dokploy DB — switch URL back to Hostinger |

Live data is **not lost** as long as Next only **connects** to Hostinger MySQL and you never reset/migrate-destructive that database.
