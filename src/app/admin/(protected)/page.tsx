import Link from "next/link";
import type { CSSProperties } from "react";
import { getSession } from "@/lib/auth/get-session";
import {
  getEnhancedDashboardStats,
  getRecentTickets,
} from "@/lib/admin/dashboard";

const priorityColors: Record<string, string> = {
  urgent: "#dc3545",
  high: "#fd7e14",
  medium: "#ffc107",
  low: "#28a745",
};

const priorityBadge: Record<string, string> = {
  urgent: "bg-danger",
  high: "bg-warning text-dark",
  medium: "bg-info text-dark",
  low: "bg-success",
};

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-IN").format(value);
}

function formatDate(value: Date | null) {
  if (!value) return "—";
  return value.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export default async function AdminDashboardPage() {
  const session = await getSession();
  const user = session.adminUser!;
  const isAdmin = user.role === "admin";

  const [stats, recentTickets] = await Promise.all([
    getEnhancedDashboardStats(user.role),
    getRecentTickets(10),
  ]);

  const total = stats.total_tickets || 0;

  return (
    <div className="dashboard-page">
      <div className="dashboard-welcome mb-3">
        <h4 className="mb-1">Welcome back, {user.name}!</h4>
        <p className="text-muted mb-0">
          Here&apos;s your warranty ticket overview.
        </p>
      </div>

      <div className="row g-2 g-md-3 mb-3">
        <StatCard
          href="/admin/tickets"
          label="Total Tickets"
          value={stats.total_tickets}
          border="border-left-primary"
          text="text-primary"
        />
        <StatCard
          href="/admin/tickets?filter=pending"
          label="Pending"
          value={stats.pending_tickets}
          border="border-left-warning"
          text="text-warning"
        />
        <StatCard
          href="/admin/tickets?filter=completed"
          label="Completed"
          value={stats.completed_tickets}
          border="border-left-success"
          text="text-success"
        />
        <StatCard
          href="/admin/tickets?filter=warranty"
          label="Warranty"
          value={stats.warranty_tickets}
          border="border-left-info"
          text="text-info"
        />
        <StatCard
          href="/admin/tickets?filter=replacement"
          label="Replacement"
          value={stats.replacement_tickets}
          border="border-left-purple"
          text="text-purple"
          style={{ color: "#6f42c1" }}
        />
        <StatCard
          href="/admin/tickets?filter=recent"
          label="Last 7 Days"
          value={stats.recent_tickets}
          border="border-left-secondary"
          text="text-secondary"
        />
      </div>

      {isAdmin && stats.by_priority.length > 0 ? (
        <div className="row g-2 g-md-3 mb-3">
          {stats.by_priority.map((p) => (
            <div key={p.priority} className="col-6 col-md-3">
              <Link
                href={`/admin/tickets?priority=${encodeURIComponent(p.priority)}`}
                className="text-decoration-none text-dark"
              >
                <div
                  className="card shadow h-100 py-2 stat-card"
                  style={{
                    borderLeft: `4px solid ${priorityColors[p.priority] ?? "#6c757d"}`,
                  }}
                >
                  <div className="card-body py-2 px-3">
                    <div
                      className="text-xs fw-bold text-uppercase mb-1"
                      style={{
                        color: priorityColors[p.priority] ?? "#6c757d",
                      }}
                    >
                      {p.priority.charAt(0).toUpperCase() + p.priority.slice(1)}{" "}
                      Priority
                    </div>
                    <div className="h5 mb-0 fw-bold">
                      {formatNumber(p.count)}
                    </div>
                  </div>
                </div>
              </Link>
            </div>
          ))}
        </div>
      ) : null}

      <div className="row g-3 dashboard-main-row align-items-stretch">
        <div className="col-lg-4 d-flex">
          <div className="card shadow mb-3 w-100 h-100">
            <div className="card-header py-2 px-3">
              <h6 className="m-0 fw-bold text-primary">Tickets by Status</h6>
            </div>
            <div className="card-body py-3 px-3">
              {stats.by_status.length === 0 ? (
                <p className="text-center text-muted mb-0">No data yet</p>
              ) : (
                stats.by_status.map((s) => {
                  const pct =
                    total > 0 ? Math.round((s.count / total) * 1000) / 10 : 0;
                  const color = s.status_color || "#6c757d";
                  return (
                    <Link
                      key={s.status_id}
                      href={`/admin/tickets?status_name=${encodeURIComponent(s.status_name)}`}
                      className="text-decoration-none d-block dashboard-status-row"
                    >
                      <div className="d-flex justify-content-between align-items-center mb-1">
                        <span
                          className="badge"
                          style={{ backgroundColor: color }}
                        >
                          {s.status_name}
                        </span>
                        <strong className="text-dark">{s.count}</strong>
                      </div>
                      <div className="progress" style={{ height: 5 }}>
                        <div
                          className="progress-bar"
                          style={{
                            width: `${pct}%`,
                            backgroundColor: color,
                          }}
                        />
                      </div>
                    </Link>
                  );
                })
              )}
            </div>
          </div>
        </div>

        <div className="col-lg-8 d-flex">
          <div className="card shadow mb-3 w-100 h-100 d-flex flex-column dashboard-recent-card">
            <div className="card-header py-2 px-3 flex-shrink-0 d-flex flex-column flex-sm-row justify-content-between align-items-sm-center gap-2">
              <h6 className="m-0 fw-bold text-primary">Recent Tickets</h6>
              <Link href="/admin/tickets" className="btn btn-sm btn-primary align-self-start">
                View All
              </Link>
            </div>
            <div className="card-body p-0 flex-grow-1 d-flex flex-column" style={{ minHeight: 0 }}>
              {recentTickets.length === 0 ? (
                <div className="text-center text-muted py-4 flex-grow-1 d-flex align-items-center justify-content-center">
                  No tickets yet
                </div>
              ) : (
                <div className="table-responsive flex-grow-1 dashboard-recent-table">
                  <table
                    className="table table-hover table-sm align-middle mb-0"
                    style={
                      {
                        "--recent-row-count": String(
                          Math.max(recentTickets.length, 1),
                        ),
                      } as CSSProperties
                    }
                  >
                    <thead className="table-light">
                      <tr>
                        <th>Ticket #</th>
                        <th>Customer</th>
                        <th>Product</th>
                        <th>Priority</th>
                        <th>Status</th>
                        <th>Date</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {recentTickets.map((ticket) => (
                        <tr key={ticket.ticket_number}>
                          <td className="fw-semibold">{ticket.ticket_number}</td>
                          <td>
                            <small>{ticket.customer_email}</small>
                          </td>
                          <td>
                            <small>{ticket.product_name}</small>
                          </td>
                          <td>
                            <span
                              className={`badge ${
                                priorityBadge[ticket.priority] ?? "bg-secondary"
                              }`}
                            >
                              {ticket.priority.charAt(0).toUpperCase() +
                                ticket.priority.slice(1)}
                            </span>
                          </td>
                          <td>
                            <span
                              className="badge"
                              style={{
                                backgroundColor:
                                  ticket.status_color || "#6c757d",
                              }}
                            >
                              {ticket.status_name}
                            </span>
                          </td>
                          <td>
                            <small>{formatDate(ticket.created_at)}</small>
                          </td>
                          <td>
                            <Link
                              href={`/admin/tickets/${encodeURIComponent(ticket.ticket_number)}`}
                              className="btn btn-sm btn-outline-primary"
                            >
                              View
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {isAdmin && stats.user_stats && stats.user_stats.length > 0 ? (
        <div className="row mt-4">
          <div className="col-12">
            <div className="card shadow mb-3">
              <div className="card-header py-2 px-3 d-flex flex-column flex-sm-row justify-content-between align-items-sm-center gap-2">
                <h6 className="m-0 fw-bold text-primary">User Activity &amp; TAT</h6>
                <Link href="/admin/users" className="btn btn-sm btn-outline-primary align-self-start">
                  Users
                </Link>
              </div>
              <div className="card-body p-0">
                <div className="table-responsive">
                  <table className="table table-sm table-hover align-middle tat-table mb-0">
                    <thead className="table-light">
                      <tr>
                        <th>User</th>
                        <th className="text-center">Tickets</th>
                        <th className="text-center">Actions</th>
                        <th className="text-center">Avg Hours</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stats.user_stats.map((us) => (
                        <tr key={us.username}>
                          <td>{us.username}</td>
                          <td className="text-center">
                            <Link
                              href={`/admin/tickets?handled_by=${encodeURIComponent(us.username)}`}
                              className="badge bg-primary text-decoration-none"
                            >
                              {us.tickets_handled}
                            </Link>
                          </td>
                          <td className="text-center">{us.total_actions}</td>
                          <td className="text-center">
                            {us.avg_response_hours !== null ? (
                              <span
                                className={`badge ${
                                  us.avg_response_hours <= 24
                                    ? "bg-success"
                                    : us.avg_response_hours <= 72
                                      ? "bg-warning text-dark"
                                      : "bg-danger"
                                }`}
                              >
                                {us.avg_response_hours}h
                              </span>
                            ) : (
                              <span className="text-muted">—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function StatCard({
  href,
  label,
  value,
  border,
  text,
  style,
}: {
  href: string;
  label: string;
  value: number;
  border: string;
  text: string;
  style?: CSSProperties;
}) {
  return (
    <div className="col-6 col-md-4 col-xl-2">
      <Link href={href} className="text-decoration-none text-dark">
        <div className={`card ${border} shadow h-100 py-2 stat-card`}>
          <div className="card-body py-2 px-3">
            <div
              className={`text-xs fw-bold text-uppercase mb-1 ${text}`}
              style={style}
            >
              {label}
            </div>
            <div className="h5 mb-0 fw-bold">{formatNumber(value)}</div>
          </div>
        </div>
      </Link>
    </div>
  );
}
