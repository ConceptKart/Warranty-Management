"use client";

import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";

export type TicketRow = {
  ticket_id: number;
  ticket_number: string;
  order_number: string | null;
  first_name: string | null;
  last_name: string | null;
  customer_email: string | null;
  order_date: Date | string | null;
  created_at: Date | string | null;
  awb_forward: string | null;
  awb_reverse: string | null;
  status_name: string | null;
  status_color: string | null;
  ticket_type: string | null;
  ticket_type_id: number;
};

type TicketTypeOption = {
  ticket_type_id: number;
  type_name: string;
};

type PackerOrder = {
  ticket_id: number;
  ticket_number: string;
  order_number: string | null;
  ticket_type: string | null;
  forward_awb: string | null;
  awb_created_at: string | null;
  awb_created_by: string | null;
  replacement_ean: string | null;
  replacement_location: string | null;
  handed_over_to: string | null;
  handed_over_at: string | null;
};

type BulkResult = {
  ticket_id: number;
  ticket_number: string;
  success: boolean;
  awb_number?: string;
  courier_name?: string;
  label_url?: string;
  error?: string | null;
};

function formatOrderDate(value: Date | string | null) {
  if (!value) return null;
  return new Date(value).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatRequestDate(value: Date | string | null) {
  if (!value) return null;
  return (
    new Date(value).toLocaleString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
      timeZone: "Asia/Kolkata",
    }) + " IST"
  );
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export function TicketsLogistics({
  tickets,
  ticketTypes,
  sortAscHref,
  sortDescHref,
}: {
  tickets: TicketRow[];
  ticketTypes: TicketTypeOption[];
  sortAscHref?: string;
  sortDescHref?: string;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<number[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkResults, setBulkResults] = useState<BulkResult[] | null>(null);
  const [packerOpen, setPackerOpen] = useState(false);
  const [packerLoading, setPackerLoading] = useState(false);
  const [packerOrders, setPackerOrders] = useState<PackerOrder[]>([]);
  const [awbFilter, setAwbFilter] = useState("");
  const [dateFrom, setDateFrom] = useState(todayIso());
  const [dateTo, setDateTo] = useState(todayIso());
  const [packerName, setPackerName] = useState("");
  const [statusMap, setStatusMap] = useState<
    Record<number, { forward?: string; reverse?: string }>
  >({});
  const [changeTypeTicket, setChangeTypeTicket] = useState<TicketRow | null>(
    null,
  );
  const [selectedTypeId, setSelectedTypeId] = useState<number | null>(null);
  const [changingType, setChangingType] = useState(false);
  const [eanQuery, setEanQuery] = useState("");
  const [eanSearching, setEanSearching] = useState(false);
  const [eanError, setEanError] = useState("");
  const [eanTicket, setEanTicket] = useState<{
    ticket_id: number;
    ticket_number: string;
    product_name: string | null;
    replacement_location: string | null;
    replacement_ean: string | null;
    forward_awb: string | null;
  } | null>(null);
  const [eanCreating, setEanCreating] = useState(false);
  const [message, setMessage] = useState("");

  const allIds = useMemo(() => tickets.map((t) => t.ticket_id), [tickets]);
  const allSelected =
    allIds.length > 0 && allIds.every((id) => selected.includes(id));

  function toggleAll(checked: boolean) {
    setSelected(checked ? allIds : []);
  }

  function toggleOne(id: number, checked: boolean) {
    setSelected((prev) =>
      checked ? [...new Set([...prev, id])] : prev.filter((x) => x !== id),
    );
  }

  async function refreshAwbStatuses() {
    const ids = selected.length > 0 ? selected : allIds;
    if (ids.length === 0) {
      setMessage("No tickets to refresh.");
      return;
    }
    setRefreshing(true);
    setMessage("");
    try {
      const res = await fetch("/api/admin/tickets/awb-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticket_ids: ids }),
      });
      const data = await res.json();
      if (!data.success) {
        setMessage(data.error ?? "Failed to refresh AWB statuses");
        return;
      }
      const next: Record<number, { forward?: string; reverse?: string }> = {};
      for (const [tid, statuses] of Object.entries(
        data.data as Record<
          string,
          {
            forward: { display_status?: string } | null;
            reverse: { display_status?: string } | null;
          }
        >,
      )) {
        next[Number(tid)] = {
          forward: statuses.forward?.display_status,
          reverse: statuses.reverse?.display_status,
        };
      }
      setStatusMap(next);

      const updates = (data.status_updates ?? {}) as Record<
        string,
        {
          status_name?: string;
          status_color?: string | null;
          changed?: boolean;
        }
      >;
      const changedCount = Object.values(updates).filter((u) => u.changed).length;
      if (changedCount > 0) {
        setMessage(
          `Refreshed AWB statuses for ${ids.length} ticket(s). Updated local status on ${changedCount}.`,
        );
        router.refresh();
      } else {
        setMessage(`Refreshed AWB statuses for ${ids.length} ticket(s).`);
      }
    } catch {
      setMessage("Failed to refresh AWB statuses");
    } finally {
      setRefreshing(false);
    }
  }

  async function runBulkForward() {
    if (selected.length === 0) return;
    setBulkLoading(true);
    setBulkResults(null);
    try {
      const res = await fetch("/api/admin/tickets/bulk-forward", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticket_ids: selected }),
      });
      const data = await res.json();
      setBulkResults(data.results ?? []);
      router.refresh();
    } catch {
      setBulkResults([
        {
          ticket_id: 0,
          ticket_number: "-",
          success: false,
          error: "Bulk forward request failed",
        },
      ]);
    } finally {
      setBulkLoading(false);
    }
  }

  async function loadPackerOrders() {
    setPackerLoading(true);
    try {
      const res = await fetch("/api/admin/tickets/packer-handover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "list",
          awb_filter: awbFilter,
          date_from: dateFrom,
          date_to: dateTo,
        }),
      });
      const data = await res.json();
      setPackerOrders(data.orders ?? []);
    } finally {
      setPackerLoading(false);
    }
  }

  async function markHandover(order: PackerOrder) {
    if (!packerName.trim()) {
      alert("Enter packer name first");
      return;
    }
    if (!order.forward_awb) return;
    const res = await fetch("/api/admin/tickets/packer-handover", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "mark",
        ticket_id: order.ticket_id,
        awb_number: order.forward_awb,
        packer_name: packerName.trim(),
      }),
    });
    const data = await res.json();
    if (!data.success) {
      alert(data.error ?? "Failed to mark handover");
      return;
    }
    await loadPackerOrders();
  }

  async function submitChangeType() {
    if (!changeTypeTicket || !selectedTypeId) return;
    setChangingType(true);
    try {
      const res = await fetch("/api/admin/tickets/change-type", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticket_id: changeTypeTicket.ticket_id,
          new_type_id: selectedTypeId,
        }),
      });
      const data = await res.json();
      if (!data.success) {
        alert(data.error ?? "Failed to change ticket type");
        return;
      }
      setChangeTypeTicket(null);
      setSelectedTypeId(null);
      router.refresh();
    } finally {
      setChangingType(false);
    }
  }

  async function searchByReplacementEan() {
    const ean = eanQuery.trim();
    if (!ean) return;
    setEanSearching(true);
    setEanError("");
    setEanTicket(null);
    try {
      const res = await fetch("/api/admin/tickets/lookup-ean", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ean }),
      });
      const data = await res.json();
      if (data.success && data.ticket) {
        setEanTicket({
          ticket_id: Number(data.ticket.ticket_id),
          ticket_number: String(data.ticket.ticket_number ?? ""),
          product_name: (data.ticket.product_name as string) ?? null,
          replacement_location:
            (data.ticket.replacement_location as string) ?? null,
          replacement_ean: (data.ticket.replacement_ean as string) ?? ean,
          forward_awb: (data.ticket.forward_awb as string) ?? null,
        });
      } else {
        setEanError(data.error ?? "No ticket found with that EAN");
      }
    } catch (err) {
      setEanError(err instanceof Error ? err.message : "Search failed");
    } finally {
      setEanSearching(false);
    }
  }

  async function createPickupForEanTicket() {
    if (!eanTicket) return;
    setEanCreating(true);
    try {
      const res = await fetch("/api/admin/tickets/bulk-forward", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticket_ids: [eanTicket.ticket_id] }),
      });
      const data = await res.json();
      const r = (data.results ?? [])[0] as BulkResult | undefined;
      if (r?.success && r.awb_number) {
        setEanTicket({ ...eanTicket, forward_awb: r.awb_number });
        router.refresh();
      } else {
        alert(r?.error || data.error || "Failed to create shipment");
      }
    } finally {
      setEanCreating(false);
    }
  }

  return (
    <>
      <div className="d-flex flex-wrap gap-2 mb-3">
        <button
          type="button"
          className="btn btn-outline-primary"
          disabled={refreshing}
          onClick={() => void refreshAwbStatuses()}
        >
          <i className={`fas fa-sync-alt me-1 ${refreshing ? "fa-spin" : ""}`} />
          Refresh AWB Statuses
        </button>
        <button
          type="button"
          className="btn btn-outline-warning"
          onClick={() => {
            setPackerOpen(true);
            void loadPackerOrders();
          }}
        >
          <i className="fas fa-box-open me-1" />
          Packer Handover
        </button>
        <button
          type="button"
          className="btn btn-outline-success"
          onClick={() => {
            setBulkResults(null);
            setEanQuery("");
            setEanTicket(null);
            setEanError("");
            setBulkOpen(true);
          }}
        >
          <i className="fas fa-truck me-1" />
          Bulk Forward ({selected.length})
        </button>
      </div>

      {message ? (
        <div className="alert alert-info py-2 mb-3">{message}</div>
      ) : null}

      <div className="card shadow">
        <div className="card-body p-0">
          {tickets.length === 0 ? (
            <div className="text-center text-muted py-5">No tickets found</div>
          ) : (
            <div className="table-responsive">
              <table className="table table-hover mb-0" id="ticketsTable">
                <thead className="table-light">
                  <tr>
                    <th style={{ width: 36 }}>
                      <input
                        type="checkbox"
                        checked={allSelected}
                        onChange={(e) => toggleAll(e.target.checked)}
                        title="Select all"
                      />
                    </th>
                    <th>Ticket # / Order ID</th>
                    <th>Customer</th>
                    <th>Order Date</th>
                    <th>
                      Request Date{" "}
                      {sortAscHref ? (
                        <Link
                          href={sortAscHref}
                          className="text-muted text-decoration-none"
                          title="Sort Ascending"
                        >
                          ↑
                        </Link>
                      ) : null}{" "}
                      {sortDescHref ? (
                        <Link
                          href={sortDescHref}
                          className="text-muted text-decoration-none"
                          title="Sort Descending"
                        >
                          ↓
                        </Link>
                      ) : null}
                    </th>
                    <th>AWB (Forward)</th>
                    <th>AWB (Reverse)</th>
                    <th>Status</th>
                    <th>Order Type</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {tickets.map((ticket) => {
                    const live = statusMap[ticket.ticket_id];
                    return (
                      <tr key={ticket.ticket_id}>
                        <td>
                          <input
                            type="checkbox"
                            checked={selected.includes(ticket.ticket_id)}
                            onChange={(e) =>
                              toggleOne(ticket.ticket_id, e.target.checked)
                            }
                          />
                        </td>
                        <td>
                          <Link
                            href={`/admin/tickets/${encodeURIComponent(ticket.ticket_number)}`}
                            className="fw-semibold text-decoration-none"
                          >
                            {ticket.order_number}
                          </Link>
                          <div className="small text-muted">
                            {ticket.ticket_number}
                          </div>
                        </td>
                        <td>
                          {`${ticket.first_name ?? ""} ${ticket.last_name ?? ""}`.trim() ||
                            "—"}
                          <div className="small text-muted">
                            {ticket.customer_email}
                          </div>
                        </td>
                        <td>
                          {formatOrderDate(ticket.order_date) ?? (
                            <span className="text-muted">N/A</span>
                          )}
                        </td>
                        <td>
                          <small>
                            {formatRequestDate(ticket.created_at) ?? (
                              <span className="text-muted">N/A</span>
                            )}
                          </small>
                        </td>
                        <td>
                          {ticket.awb_forward ? (
                            <>
                              <span className="badge bg-success">
                                {ticket.awb_forward}
                              </span>
                              {live?.forward ? (
                                <div className="small text-muted mt-1">
                                  {live.forward}
                                </div>
                              ) : null}
                            </>
                          ) : (
                            <span className="badge bg-secondary">N/A</span>
                          )}
                        </td>
                        <td>
                          {ticket.awb_reverse ? (
                            <>
                              <span className="badge bg-warning text-dark">
                                {ticket.awb_reverse}
                              </span>
                              {live?.reverse ? (
                                <div className="small text-muted mt-1">
                                  {live.reverse}
                                </div>
                              ) : null}
                            </>
                          ) : (
                            <span className="badge bg-secondary">N/A</span>
                          )}
                        </td>
                        <td>
                          <span
                            className="badge"
                            style={{
                              backgroundColor: ticket.status_color || "#6c757d",
                            }}
                          >
                            {ticket.status_name}
                          </span>
                        </td>
                        <td>{ticket.ticket_type}</td>
                        <td>
                          <div className="btn-group" role="group">
                            <Link
                              href={`/admin/tickets/${encodeURIComponent(ticket.ticket_number)}`}
                              className="btn btn-sm btn-outline-primary"
                              title="View Details"
                            >
                              <i className="fas fa-eye" />
                            </Link>
                            <button
                              type="button"
                              className="btn btn-sm btn-outline-warning"
                              title="Change Order Type"
                              onClick={() => {
                                setChangeTypeTicket(ticket);
                                setSelectedTypeId(null);
                              }}
                            >
                              <i className="fas fa-exchange-alt me-1" />
                              Type
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {bulkOpen ? (
        <Modal
          title={`Bulk Forward Shipment — ${selected.length} ticket(s)`}
          onClose={() => setBulkOpen(false)}
        >
          {!bulkResults ? (
            <>
              {selected.length > 0 ? (
                <>
                  <p>
                    Create Shipway <strong>forward</strong> shipments for the
                    selected tickets and save returned AWBs.
                  </p>
                  <div className="d-flex justify-content-end gap-2">
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => setBulkOpen(false)}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="btn btn-success"
                      disabled={bulkLoading}
                      onClick={() => void runBulkForward()}
                    >
                      {bulkLoading ? "Creating..." : "Create Forward Shipments"}
                    </button>
                  </div>
                </>
              ) : (
                <p className="text-muted">
                  Select tickets on the list to create bulk forward shipments,
                  or search by Replacement EAN below.
                </p>
              )}
            </>
          ) : (
            <>
              <div className="table-responsive mb-3">
                <table className="table table-sm">
                  <thead>
                    <tr>
                      <th>Ticket</th>
                      <th>Result</th>
                      <th>AWB</th>
                      <th>Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bulkResults.map((r) => (
                      <tr key={`${r.ticket_id}-${r.ticket_number}`}>
                        <td>{r.ticket_number}</td>
                        <td>
                          {r.success ? (
                            <span className="badge bg-success">OK</span>
                          ) : (
                            <span className="badge bg-danger">Failed</span>
                          )}
                        </td>
                        <td>{r.awb_number || "—"}</td>
                        <td className="small">
                          {r.error || r.courier_name || "—"}
                          {r.label_url ? (
                            <>
                              {" "}
                              <a
                                href={r.label_url}
                                target="_blank"
                                rel="noreferrer"
                              >
                                Label
                              </a>
                            </>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="d-flex justify-content-end">
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => {
                    setBulkOpen(false);
                    setSelected([]);
                    setEanQuery("");
                    setEanTicket(null);
                    setEanError("");
                  }}
                >
                  Done
                </button>
              </div>
            </>
          )}

          <hr className="my-4" />
          <h6 className="mb-3">
            <i className="fas fa-search me-1" /> Find Ticket by Replacement EAN
          </h6>
          <div className="row g-2 align-items-end">
            <div className="col-md-5">
              <label className="form-label small mb-1">Replacement EAN</label>
              <input
                className="form-control form-control-sm"
                value={eanQuery}
                onChange={(e) => setEanQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void searchByReplacementEan();
                  }
                }}
                placeholder="Enter replacement EAN number..."
              />
            </div>
            <div className="col-md-3">
              <button
                type="button"
                className="btn btn-outline-primary btn-sm w-100"
                disabled={eanSearching}
                onClick={() => void searchByReplacementEan()}
              >
                {eanSearching ? "Searching…" : "Search"}
              </button>
            </div>
          </div>
          {eanTicket ? (
            <div className="card card-body p-2 mt-3">
              <div className="d-flex align-items-center justify-content-between flex-wrap gap-2">
                <div>
                  <strong>{eanTicket.ticket_number}</strong>
                  <span className="ms-2 text-muted">
                    {eanTicket.product_name}
                  </span>
                  <div className="small mt-1">
                    <span className="text-muted">Location:</span>
                    <strong className="text-dark ms-1">
                      {eanTicket.replacement_location || "(none)"}
                    </strong>
                    <span className="text-muted ms-3">EAN:</span>
                    <code className="ms-1">{eanTicket.replacement_ean}</code>
                  </div>
                </div>
                <div>
                  {eanTicket.forward_awb ? (
                    <span className="badge bg-success me-1">
                      Pickup: {eanTicket.forward_awb}
                    </span>
                  ) : (
                    <>
                      <span className="badge bg-secondary me-1">
                        No pickup yet
                      </span>
                      <button
                        type="button"
                        className="btn btn-success btn-sm"
                        disabled={eanCreating}
                        onClick={() => void createPickupForEanTicket()}
                      >
                        {eanCreating ? "Creating…" : "Create Pickup"}
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          ) : null}
          {eanError ? (
            <div className="alert alert-danger py-2 mt-2 mb-0">{eanError}</div>
          ) : null}
        </Modal>
      ) : null}

      {packerOpen ? (
        <Modal
          title="Packer Handover"
          large
          onClose={() => setPackerOpen(false)}
        >
          <div className="row g-2 mb-3">
            <div className="col-md-3">
              <label className="form-label">Date From</label>
              <input
                type="date"
                className="form-control"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
              />
            </div>
            <div className="col-md-3">
              <label className="form-label">Date To</label>
              <input
                type="date"
                className="form-control"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
              />
            </div>
            <div className="col-md-3">
              <label className="form-label">AWB Filter</label>
              <input
                className="form-control"
                value={awbFilter}
                onChange={(e) => setAwbFilter(e.target.value)}
                placeholder="Search AWB"
              />
            </div>
            <div className="col-md-3">
              <label className="form-label">Packer Name</label>
              <input
                className="form-control"
                value={packerName}
                onChange={(e) => setPackerName(e.target.value)}
                placeholder="e.g. Ravi"
              />
            </div>
            <div className="col-12">
              <button
                type="button"
                className="btn btn-primary"
                disabled={packerLoading}
                onClick={() => void loadPackerOrders()}
              >
                {packerLoading ? "Loading..." : "Load Orders"}
              </button>
            </div>
          </div>

          <div className="table-responsive">
            <table className="table table-sm table-hover">
              <thead className="table-light">
                <tr>
                  <th>Ticket / Order</th>
                  <th>Forward AWB</th>
                  <th>Created</th>
                  <th>Handover</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {packerOrders.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="text-center text-muted py-4">
                      No forward AWB orders found
                    </td>
                  </tr>
                ) : (
                  packerOrders.map((o) => (
                    <tr key={o.ticket_id}>
                      <td>
                        <div className="fw-semibold">{o.order_number}</div>
                        <div className="small text-muted">{o.ticket_number}</div>
                      </td>
                      <td>
                        <span className="badge bg-success">
                          {o.forward_awb}
                        </span>
                      </td>
                      <td className="small">
                        {o.awb_created_at
                          ? formatRequestDate(o.awb_created_at)
                          : "—"}
                      </td>
                      <td className="small">
                        {o.handed_over_to ? (
                          <>
                            {o.handed_over_to}
                            <div className="text-muted">
                              {o.handed_over_at
                                ? formatRequestDate(o.handed_over_at)
                                : ""}
                            </div>
                          </>
                        ) : (
                          <span className="text-muted">Not handed over</span>
                        )}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn btn-sm btn-outline-warning"
                          disabled={Boolean(o.handed_over_to)}
                          onClick={() => void markHandover(o)}
                        >
                          Mark Handover
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Modal>
      ) : null}

      {changeTypeTicket ? (
        <Modal
          title="Change Order Type"
          onClose={() => {
            setChangeTypeTicket(null);
            setSelectedTypeId(null);
          }}
        >
          <p className="mb-2">
            Order: <strong>{changeTypeTicket.order_number}</strong>
          </p>
          <p className="mb-3">
            Current type:{" "}
            <span className="badge bg-secondary">
              {changeTypeTicket.ticket_type}
            </span>
          </p>
          <div className="alert alert-warning py-2 mb-3 small">
            <i className="fas fa-exclamation-triangle me-1" />
            Changing the type will reset the ticket status to the initial status
            of the new type and update the order identifier suffix (W↔R).
          </div>
          <div className="mb-3">
            <label className="form-label fw-semibold">Change to:</label>
            <div className="d-flex flex-wrap gap-2">
              {ticketTypes
                .filter(
                  (t) =>
                    Number(t.ticket_type_id) !==
                    Number(changeTypeTicket.ticket_type_id),
                )
                .map((t) => (
                  <button
                    key={t.ticket_type_id}
                    type="button"
                    className={`btn ${
                      selectedTypeId === Number(t.ticket_type_id)
                        ? "btn-primary"
                        : "btn-outline-primary"
                    }`}
                    onClick={() => setSelectedTypeId(Number(t.ticket_type_id))}
                  >
                    {t.type_name}
                  </button>
                ))}
            </div>
          </div>
          <div className="d-flex justify-content-end gap-2">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                setChangeTypeTicket(null);
                setSelectedTypeId(null);
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-warning"
              disabled={!selectedTypeId || changingType}
              onClick={() => void submitChangeType()}
            >
              {changingType ? "Changing…" : "Confirm Change"}
            </button>
          </div>
        </Modal>
      ) : null}
    </>
  );
}

function Modal({
  title,
  onClose,
  children,
  large,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  large?: boolean;
}) {
  return (
    <div
      className="modal fade show d-block"
      tabIndex={-1}
      style={{ backgroundColor: "rgba(0,0,0,.5)" }}
      onClick={onClose}
    >
      <div
        className={`modal-dialog modal-dialog-centered modal-dialog-scrollable ${large ? "modal-xl" : ""}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-content">
          <div className="modal-header">
            <h5 className="modal-title">{title}</h5>
            <button
              type="button"
              className="btn-close"
              aria-label="Close"
              onClick={onClose}
            />
          </div>
          <div className="modal-body">{children}</div>
        </div>
      </div>
    </div>
  );
}
