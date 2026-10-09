import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { lookupAwbStatusesByTicketIds } from "@/lib/admin/logistics-ops";
import { silentSyncTicketsFromAwbLookup } from "@/lib/admin/shipway-status-sync";

export type TicketFilters = {
  search?: string;
  status?: string;
  priority?: string;
  ticket_type?: string;
  platform?: string;
  date_from?: string;
  date_to?: string;
  request_date_from?: string;
  request_date_to?: string;
  request_date_sort?: string;
  final_override?: number | null;
  handled_by?: string;
  filter?: string;
  status_name?: string;
};

export type TicketListItem = {
  ticket_id: number;
  ticket_number: string;
  priority: string;
  created_at: Date | null;
  updated_at: Date | null;
  customer_description: string;
  customer_email: string;
  first_name: string | null;
  last_name: string | null;
  product_name: string | null;
  product_sku: string | null;
  order_number: string | null;
  source_platform: string | null;
  order_date: Date | null;
  status_name: string | null;
  status_color: string | null;
  ticket_type: string | null;
  ticket_type_id: number;
  issue_name: string | null;
  awb_forward: string | null;
  awb_reverse: string | null;
};

export type FilterOptions = {
  statuses: Array<{
    status_id: number;
    status_name: string;
    ticket_type_id: number;
  }>;
  ticket_types: Array<{ ticket_type_id: number; type_name: string }>;
  platforms: string[];
  priorities: string[];
};

function toNumber(value: unknown): number {
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number") return value;
  return Number(value ?? 0);
}

/** Mirrors AdminController::getFilterOptions */
export async function getFilterOptions(): Promise<FilterOptions> {
  const [statuses, ticketTypes, platforms] = await Promise.all([
    prisma.$queryRaw<
      Array<{
        status_id: number;
        status_name: string;
        ticket_type_id: number;
      }>
    >`
      SELECT status_id, status_name, ticket_type_id
      FROM ticket_statuses
      WHERE is_active = 1
      ORDER BY sort_order
    `,
    prisma.$queryRaw<Array<{ ticket_type_id: number; type_name: string }>>`
      SELECT ticket_type_id, type_name
      FROM ticket_types
      WHERE is_active = 1
      ORDER BY type_name
    `,
    prisma.$queryRaw<Array<{ source_platform: string }>>`
      SELECT DISTINCT source_platform
      FROM orders
      WHERE source_platform IS NOT NULL
      ORDER BY source_platform
    `,
  ]);

  return {
    statuses,
    ticket_types: ticketTypes,
    platforms: platforms.map((p) => p.source_platform),
    priorities: ["low", "medium", "high", "urgent"],
  };
}

/**
 * Apply dashboard shortcut query params the same way tickets.php does.
 */
export function resolveTicketFilters(
  raw: TicketFilters,
  options: FilterOptions,
): {
  filters: TicketFilters;
  activeFilterLabel: string;
} {
  const dashFilter = raw.filter ?? "";
  const statusName = raw.status_name ?? "";
  const handledBy = raw.handled_by ?? "";

  let filterFinalOverride: number | null = null;
  let filterTypeOverride = "";
  let filterDateFrom = "";

  if (dashFilter === "pending") filterFinalOverride = 0;
  if (dashFilter === "completed") filterFinalOverride = 1;
  if (dashFilter === "recent") {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    filterDateFrom = d.toISOString().slice(0, 10);
  }

  if (dashFilter === "warranty" || dashFilter === "replacement") {
    for (const tt of options.ticket_types) {
      if (tt.type_name.toLowerCase().includes(dashFilter)) {
        filterTypeOverride = String(tt.ticket_type_id);
        break;
      }
    }
  }

  let statusIdFromName = "";
  if (statusName) {
    for (const st of options.statuses) {
      if (st.status_name.toLowerCase() === statusName.toLowerCase()) {
        statusIdFromName = String(st.status_id);
        break;
      }
    }
  }

  let activeFilterLabel = "";
  if (dashFilter) activeFilterLabel = `${capitalize(dashFilter)} tickets`;
  if (statusName) activeFilterLabel = `Status: ${statusName}`;
  if (handledBy) activeFilterLabel = `Handled by: ${handledBy}`;

  return {
    filters: {
      search: raw.search ?? "",
      status: statusIdFromName || raw.status || "",
      priority: raw.priority ?? "",
      ticket_type: filterTypeOverride || raw.ticket_type || "",
      platform: raw.platform ?? "",
      date_from: filterDateFrom || raw.date_from || "",
      date_to: raw.date_to ?? "",
      request_date_from: raw.request_date_from ?? "",
      request_date_to: raw.request_date_to ?? "",
      request_date_sort: raw.request_date_sort ?? "",
      final_override: filterFinalOverride,
      handled_by: handledBy,
      filter: dashFilter,
      status_name: statusName,
    },
    activeFilterLabel,
  };
}

function capitalize(value: string) {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

/**
 * MySQL zero-dates (0000-00-00) crash Prisma datetime decoding.
 * Coerce them to NULL before the driver reads the column.
 */
function sqlSafeDateTime(columnSql: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`CASE
    WHEN ${columnSql} IS NULL THEN NULL
    WHEN CAST(${columnSql} AS CHAR(19)) LIKE '0000-%' THEN NULL
    ELSE ${columnSql}
  END`;
}

function buildWhere(filters: TicketFilters): Prisma.Sql {
  const parts: Prisma.Sql[] = [];

  if (filters.search) {
    const term = `%${filters.search}%`;
    parts.push(Prisma.sql`(
      wt.ticket_number LIKE ${term}
      OR COALESCE(wt.claim_number, o.order_number) LIKE ${term}
      OR c.first_name LIKE ${term}
      OR c.last_name LIKE ${term}
      OR CONCAT(c.first_name, ' ', c.last_name) LIKE ${term}
      OR c.email LIKE ${term}
      OR wt.awb_number LIKE ${term}
      OR wt.reverse_awb_number LIKE ${term}
      OR EXISTS (
        SELECT 1 FROM shipments s2
        WHERE s2.ticket_id = wt.ticket_id AND s2.awb_number LIKE ${term}
      )
    )`);
  }

  if (filters.status) {
    parts.push(Prisma.sql`wt.status_id = ${Number(filters.status)}`);
  }

  if (filters.priority) {
    parts.push(Prisma.sql`wt.priority = ${filters.priority}`);
  }

  if (filters.ticket_type) {
    parts.push(Prisma.sql`wt.ticket_type_id = ${Number(filters.ticket_type)}`);
  }

  if (filters.platform) {
    parts.push(Prisma.sql`o.source_platform = ${filters.platform}`);
  }

  if (filters.date_from) {
    parts.push(Prisma.sql`DATE(o.order_date) >= ${filters.date_from}`);
  }

  if (filters.date_to) {
    parts.push(Prisma.sql`DATE(o.order_date) <= ${filters.date_to}`);
  }

  if (filters.request_date_from) {
    parts.push(Prisma.sql`DATE(wt.created_at) >= ${filters.request_date_from}`);
  }

  if (filters.request_date_to) {
    parts.push(Prisma.sql`DATE(wt.created_at) <= ${filters.request_date_to}`);
  }

  if (
    filters.final_override !== null &&
    filters.final_override !== undefined
  ) {
    parts.push(Prisma.sql`ts.is_final = ${filters.final_override}`);
  }

  if (filters.handled_by) {
    parts.push(Prisma.sql`EXISTS (
      SELECT 1 FROM ticket_status_history tsh2
      WHERE tsh2.ticket_id = wt.ticket_id AND tsh2.changed_by = ${filters.handled_by}
    )`);
  }

  if (parts.length === 0) return Prisma.empty;
  return Prisma.sql`WHERE ${Prisma.join(parts, " AND ")}`;
}

export type GetTicketsOptions = {
  /** When false, skip Shipway AWB lookup/sync (required for CSV export). Default true. */
  syncAwb?: boolean;
};

/**
 * Mirrors AdminController::getTickets.
 * Page loads may sync AWB statuses; CSV export must pass syncAwb: false
 * so it does not hit Shipway/SMTP for thousands of tickets.
 */
export async function getTickets(
  filters: TicketFilters = {},
  page = 1,
  perPage = 25,
  options: GetTicketsOptions = {},
) {
  const syncAwb = options.syncAwb !== false;
  const where = buildWhere(filters);
  const sortAsc = filters.request_date_sort === "asc";
  const offset = (page - 1) * perPage;

  const countRows = await prisma.$queryRaw<[{ count: bigint }]>`
    SELECT COUNT(*) AS count
    FROM warranty_tickets wt
    JOIN orders o ON wt.order_id = o.order_id
    JOIN customers c ON o.customer_id = c.customer_id
    LEFT JOIN ticket_statuses ts ON wt.status_id = ts.status_id
    ${where}
  `;

  const total = toNumber(countRows[0]?.count);

  const tickets = await prisma.$queryRaw<TicketListItem[]>`
    SELECT
      wt.ticket_id,
      wt.ticket_number,
      wt.priority,
      ${sqlSafeDateTime(Prisma.sql`wt.created_at`)} AS created_at,
      ${sqlSafeDateTime(Prisma.sql`wt.updated_at`)} AS updated_at,
      wt.customer_description,
      c.email AS customer_email,
      c.first_name,
      c.last_name,
      p.product_name,
      p.product_sku,
      COALESCE(wt.claim_number, o.order_number) AS order_number,
      o.source_platform,
      ${sqlSafeDateTime(Prisma.sql`o.order_date`)} AS order_date,
      ts.status_name,
      ts.status_color,
      tt.type_name AS ticket_type,
      wt.ticket_type_id,
      it.issue_name,
      COALESCE(
        (
          SELECT s_fwd.awb_number
          FROM shipments s_fwd
          WHERE s_fwd.ticket_id = wt.ticket_id AND s_fwd.shipment_type = 'forward'
          ORDER BY s_fwd.created_at DESC
          LIMIT 1
        ),
        wt.awb_number
      ) AS awb_forward,
      COALESCE(
        (
          SELECT s_rev.awb_number
          FROM shipments s_rev
          WHERE s_rev.ticket_id = wt.ticket_id AND s_rev.shipment_type = 'reverse'
          ORDER BY s_rev.created_at DESC
          LIMIT 1
        ),
        wt.reverse_awb_number
      ) AS awb_reverse
    FROM warranty_tickets wt
    JOIN orders o ON wt.order_id = o.order_id
    JOIN customers c ON o.customer_id = c.customer_id
    LEFT JOIN products p ON wt.product_id = p.product_id
    LEFT JOIN ticket_statuses ts ON wt.status_id = ts.status_id
    LEFT JOIN ticket_types tt ON wt.ticket_type_id = tt.ticket_type_id
    LEFT JOIN issue_types it ON wt.issue_type_id = it.issue_type_id
    ${where}
    ORDER BY wt.created_at ${sortAsc ? Prisma.raw("ASC") : Prisma.raw("DESC")}
    LIMIT ${perPage} OFFSET ${offset}
  `;

  // Port of AdminController::getTickets AWB auto-sync (silent).
  // Skipped for bulk export — syncing thousands of AWBs floods SMTP AUTH.
  if (syncAwb) {
    const ticketIdsWithAwb = tickets
      .filter((t) => t.awb_forward || t.awb_reverse)
      .map((t) => Number(t.ticket_id))
      .filter((id) => id > 0);

    if (ticketIdsWithAwb.length > 0) {
      try {
        const lookup = await lookupAwbStatusesByTicketIds(ticketIdsWithAwb);
        await silentSyncTicketsFromAwbLookup(lookup);

        const freshRows = await prisma.$queryRaw<
          Array<{
            ticket_id: number;
            status_name: string | null;
            status_color: string | null;
          }>
        >`
          SELECT wt.ticket_id, ts.status_name, ts.status_color
          FROM warranty_tickets wt
          JOIN ticket_statuses ts ON ts.status_id = wt.status_id
          WHERE wt.ticket_id IN (${Prisma.join(ticketIdsWithAwb)})
        `;
        const freshMap = new Map(
          freshRows.map((r) => [Number(r.ticket_id), r] as const),
        );
        for (const ticket of tickets) {
          const fresh = freshMap.get(Number(ticket.ticket_id));
          if (fresh) {
            ticket.status_name = fresh.status_name;
            ticket.status_color = fresh.status_color;
          }
        }
      } catch (error) {
        console.error(
          "[getTickets] AWB status sync failed:",
          error instanceof Error ? error.message : error,
        );
      }
    }
  }

  return {
    tickets,
    total,
    page,
    per_page: perPage,
    total_pages: total > 0 ? Math.ceil(total / perPage) : 0,
  };
}

/** Mirrors AdminController::exportTicketsCSV data rows */
export function ticketsToCsvRows(tickets: TicketListItem[]): string {
  const headers = [
    "Ticket Number",
    "Priority",
    "Status",
    "Created Date",
    "Updated Date",
    "Customer Email",
    "Customer Name",
    "Product Name",
    "Product SKU",
    "Order Number",
    "Platform",
    "Issue Type",
    "Description",
  ];

  const escape = (value: unknown) => {
    const str = value == null ? "" : String(value);
    if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
    return str;
  };

  const lines = [headers.join(",")];
  for (const ticket of tickets) {
    lines.push(
      [
        ticket.ticket_number,
        ticket.priority ? capitalize(ticket.priority) : "",
        ticket.status_name ?? "",
        ticket.created_at ? new Date(ticket.created_at).toISOString() : "",
        ticket.updated_at ? new Date(ticket.updated_at).toISOString() : "",
        ticket.customer_email ?? "",
        `${ticket.first_name ?? ""} ${ticket.last_name ?? ""}`.trim(),
        ticket.product_name ?? "",
        ticket.product_sku ?? "",
        ticket.order_number ?? "",
        ticket.source_platform ?? "",
        ticket.issue_name ?? "",
        (ticket.customer_description ?? "").slice(0, 200),
      ]
        .map(escape)
        .join(","),
    );
  }

  return lines.join("\n");
}
