import Link from "next/link";
import {
  RETURN_AWB_PER_PAGE,
  formatReturnAwbIst,
  getReturnAwbFilterOptions,
  getReturnAwbRows,
  resolveReturnAwbPaging,
  returnAwbConditionClass,
  type ReturnAwbFilters,
} from "@/lib/admin/return-awb";

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

function buildQuery(
  filters: ReturnAwbFilters,
  extras: Record<string, string | number | null | undefined> = {},
) {
  const params = new URLSearchParams();
  const merged: Record<string, string | number | null | undefined> = {
    awb_number: filters.awb_number,
    order_id: filters.order_id,
    sku: filters.sku,
    ean: filters.ean,
    return_type: filters.return_type,
    source: filters.source,
    condition: filters.condition,
    company: filters.company,
    ...extras,
  };
  for (const [key, value] of Object.entries(merged)) {
    if (value === null || value === undefined || value === "") continue;
    params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

function dash(value: string | number | null | undefined) {
  if (value == null) return "—";
  const text = String(value).trim();
  return text ? text : "—";
}

export default async function AdminReturnAwbPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const filters: ReturnAwbFilters = {
    awb_number: first(sp.awb_number),
    order_id: first(sp.order_id),
    sku: first(sp.sku),
    ean: first(sp.ean),
    return_type: first(sp.return_type),
    source: first(sp.source),
    condition: first(sp.condition),
    company: first(sp.company),
  };
  const { page, perPage } = resolveReturnAwbPaging(
    first(sp.page),
    first(sp.per_page),
  );

  const [options, result] = await Promise.all([
    getReturnAwbFilterOptions(),
    getReturnAwbRows(filters, page, perPage),
  ]);

  const from = result.total === 0 ? 0 : (result.page - 1) * result.per_page + 1;
  const to = Math.min(result.page * result.per_page, result.total);
  const startPage = Math.max(1, result.page - 2);
  const endPage = Math.min(result.total_pages, result.page + 2);

  return (
    <>
      <div className="admin-page-header">
        <div>
          <h4 className="mb-1">
            <i className="fas fa-box-open me-2" />
            Return AWB
          </h4>
          <p className="text-muted mb-0">
            Returns synced into return inventory
          </p>
        </div>
      </div>

      {result.error ? (
        <div className="alert alert-danger">{result.error}</div>
      ) : null}

      <div className="card shadow mb-4">
        <div className="card-header">
          <span>
            <i className="fas fa-filter me-2" />
            Search &amp; Filters
          </span>
        </div>
        <div className="card-body">
          <form method="GET" className="row g-3">
            <div className="col-md-6 col-xl-3">
              <label className="form-label" htmlFor="awb_number">
                AWB Number
              </label>
              <input
                type="text"
                className="form-control"
                id="awb_number"
                name="awb_number"
                defaultValue={filters.awb_number}
                placeholder="Search AWB Number"
              />
            </div>
            <div className="col-md-6 col-xl-3">
              <label className="form-label" htmlFor="order_id">
                Order ID
              </label>
              <input
                type="text"
                className="form-control"
                id="order_id"
                name="order_id"
                defaultValue={filters.order_id}
                placeholder="Search Order ID"
              />
            </div>
            <div className="col-md-6 col-xl-3">
              <label className="form-label" htmlFor="sku">
                SKU
              </label>
              <input
                type="text"
                className="form-control"
                id="sku"
                name="sku"
                defaultValue={filters.sku}
                placeholder="Search SKU"
              />
            </div>
            <div className="col-md-6 col-xl-3">
              <label className="form-label" htmlFor="ean">
                EAN Number
              </label>
              <input
                type="text"
                className="form-control"
                id="ean"
                name="ean"
                defaultValue={filters.ean}
                placeholder="Search EAN Number"
              />
            </div>
            <div className="col-md-6 col-xl-3">
              <label className="form-label" htmlFor="return_type">
                Return Type
              </label>
              <select
                className="form-select"
                id="return_type"
                name="return_type"
                defaultValue={filters.return_type}
              >
                <option value="">All Return Types</option>
                {options.returnTypes.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-md-6 col-xl-3">
              <label className="form-label" htmlFor="source">
                Source
              </label>
              <select
                className="form-select"
                id="source"
                name="source"
                defaultValue={filters.source}
              >
                <option value="">All Sources</option>
                {options.sources.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-md-6 col-xl-3">
              <label className="form-label" htmlFor="condition">
                Condition
              </label>
              <select
                className="form-select"
                id="condition"
                name="condition"
                defaultValue={filters.condition}
              >
                <option value="">All Conditions</option>
                {options.conditions.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-md-6 col-xl-3">
              <label className="form-label" htmlFor="company">
                Company
              </label>
              <select
                className="form-select"
                id="company"
                name="company"
                defaultValue={filters.company}
              >
                <option value="">All Companies</option>
                {options.companies.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
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
                {RETURN_AWB_PER_PAGE.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-12 d-grid d-sm-flex gap-2">
              <button type="submit" className="btn btn-primary">
                <i className="fas fa-search me-1" />
                Search
              </button>
              <Link href="/admin/return-awb" className="btn btn-outline-secondary">
                Clear
              </Link>
            </div>
          </form>
        </div>
      </div>

      <div className="d-flex flex-column flex-md-row flex-wrap justify-content-between align-items-md-center gap-2 mb-3">
        <span className="text-muted small">
          Showing {from.toLocaleString("en-IN")} to {to.toLocaleString("en-IN")}{" "}
          of {result.total.toLocaleString("en-IN")} records
        </span>
        {result.total_pages > 1 ? (
          <nav className="overflow-auto">
            <ul className="pagination pagination-sm mb-0 flex-nowrap">
              {result.page > 1 ? (
                <li className="page-item">
                  <Link
                    className="page-link"
                    href={`/admin/return-awb${buildQuery(filters, {
                      page: result.page - 1,
                      per_page: result.per_page,
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
                  className={`page-item${p === result.page ? " active" : ""}`}
                >
                  <Link
                    className="page-link"
                    href={`/admin/return-awb${buildQuery(filters, {
                      page: p,
                      per_page: result.per_page,
                    })}`}
                  >
                    {p}
                  </Link>
                </li>
              ))}
              {result.page < result.total_pages ? (
                <li className="page-item">
                  <Link
                    className="page-link"
                    href={`/admin/return-awb${buildQuery(filters, {
                      page: result.page + 1,
                      per_page: result.per_page,
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

      <div className="card shadow">
        <div className="card-header">
          <strong>
            <i className="fas fa-list me-2" />
            Return AWB Records
          </strong>
        </div>
        <div className="table-responsive">
          <table className="table table-hover table-striped mb-0">
            <thead className="table-dark">
              <tr>
                <th>#</th>
                <th>AWB Number</th>
                <th>Order ID</th>
                <th>SKU</th>
                <th>EAN</th>
                <th>Quantity</th>
                <th>Received Qty</th>
                <th>Return Type</th>
                <th>Return Channel</th>
                <th>Source</th>
                <th>Condition</th>
                <th>Company</th>
                <th>Created At</th>
              </tr>
            </thead>
            <tbody>
              {result.rows.length === 0 ? (
                <tr>
                  <td colSpan={13} className="text-center py-5 text-muted">
                    No Return AWB records found.
                  </td>
                </tr>
              ) : (
                result.rows.map((row, index) => {
                  const serial =
                    (result.page - 1) * result.per_page + index + 1;
                  return (
                    <tr key={Number(row.id) || serial}>
                      <td>{serial}</td>
                      <td>
                        {row.awb_number ? (
                          <span className="badge bg-primary">
                            {row.awb_number}
                          </span>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                      <td>
                        <strong>{dash(row.order_id)}</strong>
                      </td>
                      <td>
                        <code>{dash(row.sku)}</code>
                      </td>
                      <td>{dash(row.ean)}</td>
                      <td>
                        <span className="badge bg-info text-dark">
                          {dash(row.quantity)}
                        </span>
                      </td>
                      <td>
                        <span className="badge bg-success">
                          {dash(row.admin_received_qty)}
                        </span>
                      </td>
                      <td>{dash(row.return_type)}</td>
                      <td>{dash(row.return_channel)}</td>
                      <td>
                        <span className="badge bg-secondary">
                          {dash(row.source)}
                        </span>
                      </td>
                      <td>
                        <span
                          className={`badge ${returnAwbConditionClass(row.condition)}`}
                        >
                          {dash(row.condition)}
                        </span>
                      </td>
                      <td>{dash(row.company)}</td>
                      <td>
                        <small>{formatReturnAwbIst(row.created_at)}</small>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
