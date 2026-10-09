import Link from "next/link";
import { redirect } from "next/navigation";
import { getShipments } from "@/lib/admin/shipments";
import { ShipmentsManager } from "@/components/admin/shipments-manager";
import { getSession } from "@/lib/auth/get-session";
import { hasAnyPermission } from "@/lib/auth/permissions";

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

function buildQuery(
  filters: { status: string; courier: string; search: string },
  extras: Record<string, string | number | null | undefined> = {},
) {
  const params = new URLSearchParams();
  const merged = { ...filters, ...extras };
  for (const [key, value] of Object.entries(merged)) {
    if (value === null || value === undefined || value === "") continue;
    params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export default async function AdminShipmentsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await getSession();
  if (!session.adminUser) redirect("/admin/login");
  if (
    !hasAnyPermission(session.adminUser.role, [
      "manage_shipments",
      "assign_awb",
    ])
  ) {
    redirect("/admin");
  }

  const sp = await searchParams;
  const filters = {
    status: first(sp.status),
    courier: first(sp.courier),
    search: first(sp.search),
  };
  const page = Math.max(1, Number(first(sp.page) || "1"));

  const result = await getShipments(filters, page, 20);
  const startPage = Math.max(1, page - 2);
  const endPage = Math.min(result.total_pages, page + 2);

  return (
    <>
      <div className="card mb-4">
        <div className="card-body">
          <form method="GET" className="row g-3">
            <div className="col-md-3">
              <label className="form-label">Status</label>
              <select
                name="status"
                className="form-select"
                defaultValue={filters.status}
              >
                <option value="">All Statuses</option>
                {result.statuses.map((status) => (
                  <option key={status} value={status}>
                    {status.replace(/_/g, " ").replace(/\b\w/g, (c) =>
                      c.toUpperCase(),
                    )}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-md-3">
              <label className="form-label">Courier</label>
              <select
                name="courier"
                className="form-select"
                defaultValue={filters.courier}
              >
                <option value="">All Couriers</option>
                {result.couriers.map((courier) => (
                  <option key={courier} value={courier}>
                    {courier}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-md-4">
              <label className="form-label">Search</label>
              <input
                type="text"
                name="search"
                className="form-control"
                placeholder="AWB, Ticket, Customer..."
                defaultValue={filters.search}
              />
            </div>
            <div className="col-md-2">
              <label className="form-label">&nbsp;</label>
              <div className="d-flex gap-2">
                <button type="submit" className="btn btn-primary">
                  <i className="fas fa-search" /> Filter
                </button>
                <Link
                  href="/admin/shipments"
                  className="btn btn-outline-secondary"
                >
                  Clear
                </Link>
              </div>
            </div>
          </form>
        </div>
      </div>

      <ShipmentsManager
        shipments={result.shipments.map((s) => ({
          ...s,
          created_at: s.created_at,
        }))}
        readyTickets={result.readyTickets}
        total={result.total}
      />

      {result.total_pages > 1 ? (
        <nav className="mt-4">
          <ul className="pagination justify-content-center">
            {page > 1 ? (
              <li className="page-item">
                <Link
                  className="page-link"
                  href={`/admin/shipments${buildQuery(filters, {
                    page: page - 1,
                  })}`}
                >
                  Previous
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
                  href={`/admin/shipments${buildQuery(filters, { page: p })}`}
                >
                  {p}
                </Link>
              </li>
            ))}
            {page < result.total_pages ? (
              <li className="page-item">
                <Link
                  className="page-link"
                  href={`/admin/shipments${buildQuery(filters, {
                    page: page + 1,
                  })}`}
                >
                  Next
                </Link>
              </li>
            ) : null}
          </ul>
        </nav>
      ) : null}
    </>
  );
}
