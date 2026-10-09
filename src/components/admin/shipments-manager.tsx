"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import type { ReadyTicket, TrackingEvent } from "@/lib/admin/shipments";

type ShipmentRow = {
  shipment_id: number;
  ticket_id: number;
  awb_number: string;
  courier_partner: string;
  shipment_type: string;
  shipment_status: string | null;
  tracking_url: string | null;
  created_at: Date | string | null;
  ticket_number: string;
  priority: string | null;
  customer_name: string | null;
  customer_email: string | null;
  customer_phone: string | null;
  product_name: string | null;
};

const COURIERS = [
  "BlueDart",
  "DTDC",
  "Delhivery",
  "Ecom Express",
  "Shipway Default",
];

const STATUS_OPTIONS = [
  "created",
  "picked_up",
  "in_transit",
  "out_for_delivery",
  "delivered",
  "exception",
  "returned",
];

function priorityBadge(priority: string | null) {
  if (priority === "urgent") return "dark";
  if (priority === "high") return "danger";
  return "secondary";
}

function formatCreated(value: Date | string | null) {
  if (!value) return { date: "—", time: "" };
  const d = new Date(value);
  return {
    date: d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    }),
    time: d.toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }),
  };
}

function labelStatus(status: string | null) {
  if (!status) return "—";
  return status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function ShipmentsManager({
  shipments,
  readyTickets,
  total,
}: {
  shipments: ShipmentRow[];
  readyTickets: ReadyTicket[];
  total: number;
}) {
  const router = useRouter();
  const [assignOpen, setAssignOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [trackingOpen, setTrackingOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const [ticketId, setTicketId] = useState("");
  const [awbNumber, setAwbNumber] = useState("");
  const [courier, setCourier] = useState("");
  const [shipmentType, setShipmentType] = useState<"forward" | "reverse">(
    "forward",
  );

  const [statusAwb, setStatusAwb] = useState("");
  const [statusCode, setStatusCode] = useState("in_transit");
  const [statusMessage, setStatusMessage] = useState("");
  const [location, setLocation] = useState("");
  const [remarks, setRemarks] = useState("");

  const [trackingHtml, setTrackingHtml] = useState<ReactNode>(null);

  async function submitAssign() {
    if (!ticketId || !awbNumber.trim() || !courier) {
      alert("Ticket, AWB number, and courier are required");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch("/api/admin/shipments/assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticket_id: Number(ticketId),
          awb_number: awbNumber.trim(),
          courier_partner: courier,
          shipment_type: shipmentType,
        }),
      });
      const data = await res.json();
      if (!data.success) {
        alert(data.message ?? "Failed to assign AWB");
        return;
      }
      setAssignOpen(false);
      setAwbNumber("");
      setTicketId("");
      setCourier("");
      setMessage(data.message ?? "AWB assigned");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function submitStatus() {
    if (!statusAwb || !statusCode || !statusMessage.trim()) {
      alert("Status message is required");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/admin/shipments/update-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          awb_number: statusAwb,
          status_code: statusCode,
          status_message: statusMessage.trim(),
          location,
          remarks,
        }),
      });
      const data = await res.json();
      if (!data.success) {
        alert(data.message ?? "Failed to update status");
        return;
      }
      setStatusOpen(false);
      setStatusMessage("");
      setLocation("");
      setRemarks("");
      setMessage("Status updated successfully");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function viewTracking(awb: string) {
    setTrackingOpen(true);
    setTrackingHtml(
      <div className="text-center py-4">
        <div className="spinner-border" role="status" />
      </div>,
    );
    try {
      const res = await fetch(
        `/api/admin/shipments/tracking?awb=${encodeURIComponent(awb)}`,
      );
      const data = await res.json();
      if (!data.success) {
        setTrackingHtml(
          <div className="alert alert-danger">
            {data.error ?? "Error loading tracking data"}
          </div>,
        );
        return;
      }
      setTrackingHtml(
        <TrackingView shipment={data.shipment} history={data.history ?? []} />,
      );
    } catch (error) {
      setTrackingHtml(
        <div className="alert alert-danger">
          Error loading tracking data:{" "}
          {error instanceof Error ? error.message : "Unknown error"}
        </div>,
      );
    }
  }

  return (
    <>
      <div className="d-flex justify-content-between align-items-center mb-4 flex-wrap gap-2">
        <h2 className="mb-0">
          <i className="fas fa-shipping-fast me-2" />
          Shipment Management
        </h2>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => setAssignOpen(true)}
        >
          <i className="fas fa-plus me-1" />
          Assign AWB Number
        </button>
      </div>

      {message ? (
        <div className="alert alert-success py-2">{message}</div>
      ) : null}

      <div className="card">
        <div className="card-header">
          <h5 className="mb-0">
            Shipments ({total.toLocaleString("en-IN")} total)
          </h5>
        </div>
        <div className="card-body p-0">
          <div className="table-responsive">
            <table className="table table-hover mb-0">
              <thead className="table-light">
                <tr>
                  <th>AWB Number</th>
                  <th>Ticket</th>
                  <th>Customer</th>
                  <th>Product</th>
                  <th>Courier</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {shipments.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="text-center py-4">
                      <i className="fas fa-box-open fa-3x text-muted mb-3 d-block" />
                      <p className="text-muted mb-0">No shipments found</p>
                    </td>
                  </tr>
                ) : (
                  shipments.map((s) => {
                    const created = formatCreated(s.created_at);
                    return (
                      <tr key={s.shipment_id}>
                        <td>
                          <strong>{s.awb_number}</strong>
                          {s.tracking_url ? (
                            <>
                              <br />
                              <a
                                href={s.tracking_url}
                                target="_blank"
                                rel="noreferrer"
                                className="small text-primary"
                              >
                                <i className="fas fa-external-link-alt" /> Track
                              </a>
                            </>
                          ) : null}
                        </td>
                        <td>
                          <Link
                            href={`/admin/tickets/${encodeURIComponent(s.ticket_number)}`}
                            className="text-decoration-none"
                          >
                            {s.ticket_number}
                          </Link>
                          <br />
                          <span
                            className={`badge bg-${priorityBadge(s.priority)} small`}
                          >
                            {(s.priority ?? "medium").replace(/^\w/, (c) =>
                              c.toUpperCase(),
                            )}
                          </span>
                        </td>
                        <td>
                          <strong>{s.customer_name?.trim() || "—"}</strong>
                          <br />
                          <small className="text-muted">
                            {s.customer_email}
                          </small>
                          {s.customer_phone ? (
                            <>
                              <br />
                              <small className="text-muted">
                                {s.customer_phone}
                              </small>
                            </>
                          ) : null}
                        </td>
                        <td>{s.product_name || "—"}</td>
                        <td>
                          <span className="badge bg-info">
                            {s.courier_partner}
                          </span>
                        </td>
                        <td>
                          <span
                            className={`badge bg-${s.shipment_type === "forward" ? "success" : "warning"}`}
                          >
                            {s.shipment_type === "forward"
                              ? "Forward"
                              : "Reverse"}
                          </span>
                        </td>
                        <td>
                          <span
                            className={`shipment-status status-${s.shipment_status ?? "created"}`}
                          >
                            {labelStatus(s.shipment_status)}
                          </span>
                        </td>
                        <td>
                          <small>{created.date}</small>
                          <br />
                          <small className="text-muted">{created.time}</small>
                        </td>
                        <td>
                          <div className="btn-group btn-group-sm">
                            <button
                              type="button"
                              className="btn btn-outline-primary"
                              title="View tracking"
                              onClick={() => void viewTracking(s.awb_number)}
                            >
                              <i className="fas fa-route" />
                            </button>
                            <button
                              type="button"
                              className="btn btn-outline-success"
                              title="Update status"
                              onClick={() => {
                                setStatusAwb(s.awb_number);
                                setStatusOpen(true);
                              }}
                            >
                              <i className="fas fa-edit" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {assignOpen ? (
        <Modal title="Assign AWB Number" onClose={() => setAssignOpen(false)}>
          <div className="row g-3">
            <div className="col-md-6">
              <label className="form-label">Ticket</label>
              <select
                className="form-select"
                value={ticketId}
                onChange={(e) => setTicketId(e.target.value)}
                required
              >
                <option value="">Select Ticket</option>
                {readyTickets.map((t) => (
                  <option key={t.ticket_id} value={t.ticket_id}>
                    {t.ticket_number} —{" "}
                    {`${t.first_name ?? ""} ${t.last_name ?? ""}`.trim() ||
                      "Customer"}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-md-6">
              <label className="form-label">AWB Number</label>
              <input
                className="form-control"
                value={awbNumber}
                onChange={(e) => setAwbNumber(e.target.value)}
                placeholder="Enter AWB"
                required
              />
            </div>
            <div className="col-md-6">
              <label className="form-label">Courier Partner</label>
              <select
                className="form-select"
                value={courier}
                onChange={(e) => setCourier(e.target.value)}
                required
              >
                <option value="">Select Courier</option>
                {COURIERS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-md-6">
              <label className="form-label">Shipment Type</label>
              <select
                className="form-select"
                value={shipmentType}
                onChange={(e) =>
                  setShipmentType(e.target.value as "forward" | "reverse")
                }
              >
                <option value="forward">Forward (To Customer)</option>
                <option value="reverse">Reverse (From Customer)</option>
              </select>
            </div>
          </div>
          <div className="d-flex justify-content-end gap-2 mt-4">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setAssignOpen(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy}
              onClick={() => void submitAssign()}
            >
              {busy ? "Saving..." : "Assign AWB Number"}
            </button>
          </div>
        </Modal>
      ) : null}

      {statusOpen ? (
        <Modal
          title="Update Shipment Status"
          onClose={() => setStatusOpen(false)}
        >
          <div className="row g-3">
            <div className="col-12">
              <label className="form-label">AWB</label>
              <input className="form-control" value={statusAwb} readOnly />
            </div>
            <div className="col-12">
              <label className="form-label">Status Code</label>
              <select
                className="form-select"
                value={statusCode}
                onChange={(e) => setStatusCode(e.target.value)}
              >
                {STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {labelStatus(s)}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-12">
              <label className="form-label">Status Message</label>
              <input
                className="form-control"
                value={statusMessage}
                onChange={(e) => setStatusMessage(e.target.value)}
                required
              />
            </div>
            <div className="col-12">
              <label className="form-label">Location</label>
              <input
                className="form-control"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
              />
            </div>
            <div className="col-12">
              <label className="form-label">Remarks</label>
              <textarea
                className="form-control"
                rows={2}
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
              />
            </div>
          </div>
          <div className="d-flex justify-content-end gap-2 mt-4">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setStatusOpen(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy}
              onClick={() => void submitStatus()}
            >
              {busy ? "Updating..." : "Update Status"}
            </button>
          </div>
        </Modal>
      ) : null}

      {trackingOpen ? (
        <Modal
          title="Shipment Tracking"
          large
          onClose={() => setTrackingOpen(false)}
        >
          {trackingHtml}
        </Modal>
      ) : null}

      <style>{`
        .shipment-status {
          padding: 4px 8px;
          border-radius: 4px;
          font-size: 0.8em;
          font-weight: bold;
        }
        .status-created {
          background: #e3f2fd;
          color: #1976d2;
        }
        .status-picked_up {
          background: #fff3e0;
          color: #f57c00;
        }
        .status-in_transit {
          background: #e8f5e8;
          color: #388e3c;
        }
        .status-out_for_delivery {
          background: #fff8e1;
          color: #f9a825;
        }
        .status-delivered {
          background: #e8f5e8;
          color: #2e7d32;
        }
        .status-exception,
        .status-returned {
          background: #ffebee;
          color: #d32f2f;
        }
      `}</style>
    </>
  );
}

function TrackingView({
  shipment,
  history,
}: {
  shipment: {
    awb_number: string;
    ticket_id: number;
    ticket_number: string;
    customer_name: string | null;
    product_name: string | null;
    courier_partner: string;
    shipment_type: string;
    shipment_status: string | null;
    estimated_delivery: Date | string | null;
    actual_delivery: Date | string | null;
    tracking_url: string | null;
  };
  history: TrackingEvent[];
}) {
  return (
    <>
      <div className="row">
        <div className="col-md-6">
          <h6>
            <i className="fas fa-info-circle me-2" />
            Shipment Details
          </h6>
          <table className="table table-sm">
            <tbody>
              <tr>
                <td>
                  <strong>AWB Number:</strong>
                </td>
                <td>{shipment.awb_number}</td>
              </tr>
              <tr>
                <td>
                  <strong>Ticket:</strong>
                </td>
                <td>
                  <Link
                    href={`/admin/tickets/${encodeURIComponent(shipment.ticket_number)}`}
                    target="_blank"
                  >
                    {shipment.ticket_number}
                  </Link>
                </td>
              </tr>
              <tr>
                <td>
                  <strong>Customer:</strong>
                </td>
                <td>{shipment.customer_name}</td>
              </tr>
              <tr>
                <td>
                  <strong>Product:</strong>
                </td>
                <td>{shipment.product_name || "—"}</td>
              </tr>
              <tr>
                <td>
                  <strong>Courier:</strong>
                </td>
                <td>{shipment.courier_partner}</td>
              </tr>
              <tr>
                <td>
                  <strong>Type:</strong>
                </td>
                <td>
                  <span
                    className={`badge bg-${shipment.shipment_type === "forward" ? "success" : "warning"}`}
                  >
                    {shipment.shipment_type === "forward"
                      ? "Forward"
                      : "Reverse"}
                  </span>
                </td>
              </tr>
              <tr>
                <td>
                  <strong>Current Status:</strong>
                </td>
                <td>
                  <span className="badge bg-primary">
                    {labelStatus(shipment.shipment_status)}
                  </span>
                </td>
              </tr>
              {shipment.estimated_delivery ? (
                <tr>
                  <td>
                    <strong>Est. Delivery:</strong>
                  </td>
                  <td>
                    {new Date(shipment.estimated_delivery).toLocaleString()}
                  </td>
                </tr>
              ) : null}
              {shipment.actual_delivery ? (
                <tr>
                  <td>
                    <strong>Delivered:</strong>
                  </td>
                  <td className="text-success">
                    <i className="fas fa-check-circle me-1" />
                    {new Date(shipment.actual_delivery).toLocaleString()}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
          {shipment.tracking_url ? (
            <a
              href={shipment.tracking_url}
              target="_blank"
              rel="noreferrer"
              className="btn btn-outline-primary btn-sm"
            >
              <i className="fas fa-external-link-alt me-1" />
              Track on Courier Website
            </a>
          ) : null}
        </div>
        <div className="col-md-6">
          <h6>
            <i className="fas fa-route me-2" />
            Tracking Timeline
          </h6>
          {history.length === 0 ? (
            <div className="alert alert-info">
              <i className="fas fa-info-circle me-2" />
              No tracking events found for this shipment.
            </div>
          ) : (
            <div style={{ maxHeight: 400, overflowY: "auto" }}>
              {history.map((event, index) => (
                <div key={event.tracking_id} className="d-flex mb-3">
                  <div className="flex-shrink-0">
                    <div
                      className={`${
                        event.is_delivered
                          ? "bg-success"
                          : event.is_exception
                            ? "bg-danger"
                            : "bg-primary"
                      } text-white rounded-circle d-flex align-items-center justify-content-center`}
                      style={{ width: 32, height: 32 }}
                    >
                      <i
                        className={`fas ${
                          event.is_delivered
                            ? "fa-check"
                            : event.is_exception
                              ? "fa-exclamation"
                              : "fa-circle"
                        } fa-sm`}
                      />
                    </div>
                  </div>
                  <div className="flex-grow-1 ms-3">
                    <div className="d-flex justify-content-between align-items-start">
                      <div>
                        <h6 className="mb-1">{event.status_message}</h6>
                        {event.location ? (
                          <p className="mb-1 text-muted">
                            <i className="fas fa-map-marker-alt me-1" />
                            {event.location}
                          </p>
                        ) : null}
                        {event.remarks ? (
                          <p className="mb-1 small text-muted">
                            {event.remarks}
                          </p>
                        ) : null}
                      </div>
                      <small className="text-muted">
                        {event.formatted_timestamp}
                      </small>
                    </div>
                    {event.courier_status ? (
                      <span className="badge bg-secondary small">
                        {event.courier_status}
                      </span>
                    ) : null}
                    {index < history.length - 1 ? (
                      <div
                        className="mt-2"
                        style={{
                          borderLeft: "2px solid #dee2e6",
                          height: 12,
                          marginLeft: 0,
                        }}
                      />
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {history.length > 0 ? (
        <div className="mt-4">
          <h6>
            <i className="fas fa-list me-2" />
            Detailed Tracking Events
          </h6>
          <div className="table-responsive">
            <table className="table table-sm table-striped">
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Status</th>
                  <th>Location</th>
                  <th>Courier Status</th>
                  <th>Remarks</th>
                  <th>Flags</th>
                </tr>
              </thead>
              <tbody>
                {history.map((event) => (
                  <tr key={`row-${event.tracking_id}`}>
                    <td>{event.formatted_timestamp}</td>
                    <td>
                      <span
                        className={`badge bg-${
                          event.is_delivered
                            ? "success"
                            : event.is_exception
                              ? "danger"
                              : "primary"
                        }`}
                      >
                        {event.status_code}
                      </span>
                    </td>
                    <td>{event.location || "-"}</td>
                    <td>{event.courier_status || "-"}</td>
                    <td>{event.remarks || "-"}</td>
                    <td>
                      {event.is_delivered ? (
                        <span className="badge bg-success me-1">Delivered</span>
                      ) : null}
                      {event.is_exception ? (
                        <span className="badge bg-danger">Exception</span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
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
        className={`modal-dialog modal-dialog-centered modal-dialog-scrollable ${large ? "modal-lg" : ""}`}
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
