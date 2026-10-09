import Link from "next/link";
import {
  getFilterOptions,
  getTickets,
  resolveTicketFilters,
  type TicketFilters,
} from "@/lib/admin/tickets";
import { TicketsLogistics } from "@/components/admin/tickets-logistics";
import { getSession } from "@/lib/auth/get-session";
import { hasPermission } from "@/lib/auth/permissions";
import { redirect } from "next/navigation";

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

function buildQuery(
  filters: TicketFilters,
  extras: Record<string, string | number | null | undefined> = {},
) {
  const params = new URLSearchParams();
  const merged: Record<string, string | number | null | undefined> = {
    search: filters.search,
    status: filters.status,
    priority: filters.priority,
    ticket_type: filters.ticket_type,
    platform: filters.platform,
    date_from: filters.date_from,
    date_to: filters.date_to,
    request_date_from: filters.request_date_from,
    request_date_to: filters.request_date_to,
    request_date_sort: filters.request_date_sort,
    handled_by: filters.handled_by,
    filter: filters.filter,
    status_name: filters.status_name,
    ...extras,
  };

  for (const [key, value] of Object.entries(merged)) {
    if (value === null || value === undefined || value === "") continue;
    params.set(key, String(value));
  }

  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export default async function AdminTicketsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await getSession();
  if (!session.adminUser) redirect("/admin/login");
  const canExport = hasPermission(session.adminUser.role, "export_data");

  const sp = await searchParams;
  const raw: TicketFilters = {
    search: first(sp.search),
    status: first(sp.status),
    priority: first(sp.priority),
    ticket_type: first(sp.ticket_type),
    platform: first(sp.platform),
    date_from: first(sp.date_from),
    date_to: first(sp.date_to),
    request_date_from: first(sp.request_date_from),
    request_date_to: first(sp.request_date_to),
    request_date_sort: first(sp.request_date_sort),
    handled_by: first(sp.handled_by),
    filter: first(sp.filter),
    status_name: first(sp.status_name),
  };

  const page = Math.max(1, Number(first(sp.page) || "1"));
  const perPage = Math.min(
    100,
    Math.max(10, Number(first(sp.per_page) || "25")),
  );

  const options = await getFilterOptions();
  const { filters, activeFilterLabel } = resolveTicketFilters(raw, options);
  const result = await getTickets(filters, page, perPage);

  const from =
    result.total === 0 ? 0 : (result.page - 1) * result.per_page + 1;
  const to = Math.min(result.page * result.per_page, result.total);

  const startPage = Math.max(1, page - 2);
  const endPage = Math.min(result.total_pages, page + 2);

  return (
    <>
      <div className="admin-page-header">
        <div>
          <h4 className="mb-1">
            <i className="fas fa-ticket-alt me-2" />
            Ticket Management
          </h4>
          {activeFilterLabel ? (
            <p className="mb-0">
              <span className="badge bg-info text-dark me-2">
                {activeFilterLabel}
              </span>
              <Link href="/admin/tickets" className="small text-muted">
                Clear filter
              </Link>
            </p>
          ) : (
            <p className="text-muted mb-0">
              Manage and track warranty tickets
            </p>
          )}
        </div>
        <div className="admin-page-actions">
          {canExport ? (
            <a
              href={`/api/admin/export-tickets${buildQuery(filters)}`}
              className="btn btn-success"
            >
              <i className="fas fa-file-csv me-1" />
              Export CSV
            </a>
          ) : null}
        </div>
      </div>

      <div className="card shadow mb-4">
        <div className="card-header">
          <span>
            <i className="fas fa-filter me-2" />
            Filters
          </span>
        </div>
        <div className="card-body">
            <form method="GET" className="row g-3">
              <div className="col-md-4 col-xl-3">
                <label className="form-label" htmlFor="search">
                  Search
                </label>
                <input
                  type="text"
                  className="form-control"
                  id="search"
                  name="search"
                  defaultValue={filters.search}
                  placeholder="Ticket #, Order ID, Name, Email, AWB #"
                />
              </div>

              <div className="col-md-4 col-xl-2">
                <label className="form-label" htmlFor="status">
                  Status
                </label>
                <select
                  className="form-select"
                  id="status"
                  name="status"
                  defaultValue={filters.status}
                >
                  <option value="">All Statuses</option>
                  {options.statuses.map((status) => (
                    <option key={status.status_id} value={status.status_id}>
                      {status.status_name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="col-md-4 col-xl-2">
                <label className="form-label" htmlFor="priority">
                  Priority
                </label>
                <select
                  className="form-select"
                  id="priority"
                  name="priority"
                  defaultValue={filters.priority}
                >
                  <option value="">All Priorities</option>
                  {options.priorities.map((priority) => (
                    <option key={priority} value={priority}>
                      {priority.charAt(0).toUpperCase() + priority.slice(1)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="col-md-4 col-xl-2">
                <label className="form-label" htmlFor="ticket_type">
                  Type
                </label>
                <select
                  className="form-select"
                  id="ticket_type"
                  name="ticket_type"
                  defaultValue={filters.ticket_type}
                >
                  <option value="">All Types</option>
                  {options.ticket_types.map((type) => (
                    <option
                      key={type.ticket_type_id}
                      value={type.ticket_type_id}
                    >
                      {type.type_name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="col-md-4 col-xl-2">
                <label className="form-label" htmlFor="platform">
                  Platform
                </label>
                <select
                  className="form-select"
                  id="platform"
                  name="platform"
                  defaultValue={filters.platform}
                >
                  <option value="">All Platforms</option>
                  {options.platforms.map((platform) => (
                    <option key={platform} value={platform}>
                      {platform}
                    </option>
                  ))}
                </select>
              </div>

              <div className="col-md-4 col-xl-2">
                <label className="form-label" htmlFor="date_from">
                  Order Date From
                </label>
                <input
                  type="date"
                  className="form-control"
                  id="date_from"
                  name="date_from"
                  defaultValue={filters.date_from}
                />
              </div>

              <div className="col-md-4 col-xl-2">
                <label className="form-label" htmlFor="date_to">
                  Order Date To
                </label>
                <input
                  type="date"
                  className="form-control"
                  id="date_to"
                  name="date_to"
                  defaultValue={filters.date_to}
                />
              </div>

              <div className="col-md-4 col-xl-2">
                <label className="form-label" htmlFor="request_date_from">
                  Request Date From
                </label>
                <input
                  type="date"
                  className="form-control"
                  id="request_date_from"
                  name="request_date_from"
                  defaultValue={filters.request_date_from}
                />
              </div>

              <div className="col-md-4 col-xl-2">
                <label className="form-label" htmlFor="request_date_to">
                  Request Date To
                </label>
                <input
                  type="date"
                  className="form-control"
                  id="request_date_to"
                  name="request_date_to"
                  defaultValue={filters.request_date_to}
                />
              </div>

              <div className="col-md-4 col-xl-2">
                <label className="form-label" htmlFor="per_page">
                  Per Page
                </label>
                <select
                  className="form-select"
                  id="per_page"
                  name="per_page"
                  defaultValue={String(perPage)}
                >
                  {[10, 25, 50, 100].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </div>

              <div className="col-12 d-grid d-sm-flex gap-2">
                <button type="submit" className="btn btn-primary">
                  <i className="fas fa-search me-1" />
                  Apply Filters
                </button>
                <Link href="/admin/tickets" className="btn btn-outline-secondary">
                  Clear
                </Link>
              </div>
            </form>
        </div>
      </div>

      <div className="d-flex flex-column flex-md-row flex-wrap justify-content-between align-items-md-center gap-2 mb-3">
        <span className="text-muted small">
          Showing {from.toLocaleString("en-IN")} to{" "}
          {to.toLocaleString("en-IN")} of{" "}
          {result.total.toLocaleString("en-IN")} tickets
        </span>
        {result.total_pages > 1 ? (
          <nav className="overflow-auto">
            <ul className="pagination pagination-sm mb-0 flex-nowrap">
              {page > 1 ? (
                <li className="page-item">
                  <Link
                    className="page-link"
                    href={`/admin/tickets${buildQuery(filters, {
                      page: page - 1,
                      per_page: perPage,
                    })}`}
                  >
                    ‹
                  </Link>
                </li>
              ) : null}
              {Array.from(
                { length: endPage - startPage + 1 },
                (_, i) => startPage + i,
              ).map((p) => (
                <li
                  key={p}
                  className={`page-item${p === page ? " active" : ""}`}
                >
                  <Link
                    className="page-link"
                    href={`/admin/tickets${buildQuery(filters, {
                      page: p,
                      per_page: perPage,
                    })}`}
                  >
                    {p}
                  </Link>
                </li>
              ))}
              {page < result.total_pages ? (
                <li className="page-item">
                  <Link
                    className="page-link"
                    href={`/admin/tickets${buildQuery(filters, {
                      page: page + 1,
                      per_page: perPage,
                    })}`}
                  >
                    ›
                  </Link>
                </li>
              ) : null}
            </ul>
          </nav>
        ) : null}
      </div>

      <TicketsLogistics
        tickets={result.tickets.map((ticket) => ({
          ticket_id: Number(ticket.ticket_id),
          ticket_number: ticket.ticket_number,
          order_number: ticket.order_number,
          first_name: ticket.first_name,
          last_name: ticket.last_name,
          customer_email: ticket.customer_email,
          order_date: ticket.order_date,
          created_at: ticket.created_at,
          awb_forward: ticket.awb_forward,
          awb_reverse: ticket.awb_reverse,
          status_name: ticket.status_name,
          status_color: ticket.status_color,
          ticket_type: ticket.ticket_type,
          ticket_type_id: Number(ticket.ticket_type_id),
        }))}
        ticketTypes={options.ticket_types.map((t) => ({
          ticket_type_id: Number(t.ticket_type_id),
          type_name: t.type_name,
        }))}
        sortAscHref={`/admin/tickets${buildQuery(filters, {
          request_date_sort: "asc",
          page: 1,
          per_page: perPage,
        })}`}
        sortDescHref={`/admin/tickets${buildQuery(filters, {
          request_date_sort: "desc",
          page: 1,
          per_page: perPage,
        })}`}
      />
    </>
  );
}
