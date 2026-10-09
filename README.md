# Warranty Management — Next.js (V2)

New Next.js app for migrating the Concept Kart warranty system.  
**Legacy PHP code is not modified.** This folder is additive only.

## Stack

- Next.js 16 (App Router) + TypeScript + Tailwind
- Prisma 6 → MySQL (`u590978274_warmanagement`)

## Setup

1. Import the live dump into MySQL (XAMPP or remote):

   ```bash
   mysql -u root -p -e "CREATE DATABASE u590978274_warmanagement CHARACTER SET utf8mb4;"
   mysql -u root -p u590978274_warmanagement < "../path/to/u590978274_warmanagement (1).sql"
   ```

2. Copy env and set `DATABASE_URL`:

   ```bash
   cp .env.example .env
   ```

   URL-encode special characters in the password (`@` → `%40`, `#` → `%23`).

3. Install & run:

   ```bash
   npm install
   npm run db:generate
   npm run dev
   ```

4. Health check: [http://localhost:3000/api/health](http://localhost:3000/api/health)

## Useful scripts

| Command | Purpose |
|---------|---------|
| `npm run dev` | Start Next.js |
| `npm run db:generate` | Generate Prisma Client |
| `npm run db:pull` | Introspect live DB (refines schema) |
| `npm run db:studio` | Browse data in Prisma Studio |

## Migration status

See commit history / chat for migration progress. Admin: `/admin/login`. Portal: `/`.

