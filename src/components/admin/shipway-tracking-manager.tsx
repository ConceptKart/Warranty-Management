"use client";

import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import type {
  ApiStatRow,
  PendingShipment,
} from "@/lib/admin/shipway-tracking";

function labelStatus(status: string | null | undefined) {
  if (!status) return "—";
  return status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

type HistoryEvent = {
  status_code?: string;
  status_message?: string;
  location?: string;
  formatted_timestamp?: string;
  timestamp?: string;
};

export function ShipwayTrackingManager({
  statusCounts,
  activeCache,
  apiStats,
  pending,
}: {
  statusCounts: Array<{ shipment_status: string; count: number }>;
  activeCache: number;
  apiStats: ApiStatRow[];
  pending: PendingShipment[];
}) {
  const router = useRouter();
  const [awb, setAwb] = useState("");
  const [loading, setLoading] = useState(false);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [result, setResult] = useState<ReactNode>(null);
  const [bulkMessage, setBulkMessage] = useState("");

  async function callAction(
    action: string,
    extra: Record<string, unknown> = {},
  ) {
    const res = await fetch("/api/admin/shipway-tracking", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, awb_number: awb.trim(), ...extra }),
    });
    return res.json();
  }

  async function validateAwb() {
    if (!awb.trim()) {
      alert("Please enter an AWB number");
      return;
    }
    setLoading(true);
    try {
      const data = await callAction("validate_awb");
      setResult(
        data.valid ? (
          <div className="text-success">
            <strong>✓ Valid AWB format</strong>
          </div>
        ) : (
          <div className="text-danger">
            <strong>✗ Invalid AWB format</strong>
          </div>
        ),
      );
    } finally {
      setLoading(false);
    }
  }

  async function fetchTracking() {
    if (!awb.trim()) {
      alert("Please enter an AWB number");
      return;
    }
    setLoading(true);
    setResult(
      <div className="text-primary">Loading tracking information...</div>,
    );
    try {
      const data = await callAction("fetch_tracking");
      if (!data.success) {
        setResult(
          <div className="text-danger">
            Error: {data.error ?? "Failed"}
          </div>,
        );
        return;
      }
      setResult(
        <div>
          <div className="mb-2">
            <span className="badge bg-secondary">{data.source ?? ""}</span>
            {data.cached ? (
              <>
                {" "}
                <span className="badge bg-info">cached</span>
              </>
            ) : null}
          </div>
          <pre className="tracking-json mb-0 small">
            {JSON.stringify(data.data, null, 2)}
          </pre>
        </div>,
      );
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  async function getHistory() {
    if (!awb.trim()) {
      alert("Please enter an AWB number");
      return;
    }
    setLoading(true);
    setResult(<div className="text-primary">Loading history...</div>);
    try {
      const data = await callAction("get_shipment_history");
      if (!data.success) {
        setResult(
          <div className="text-danger">
            Error: {data.error ?? "Failed"}
          </div>,
        );
        return;
      }
      const history = (data.data?.tracking_history ?? []) as HistoryEvent[];
      const info = data.data?.shipment_info ?? {};
      setResult(
        <div>
          <div className="mb-3">
            <strong>{info.awb_number ?? awb}</strong>
            {" — "}
            {labelStatus(info.shipment_status)} / {info.courier_partner ?? ""}
          </div>
          {history.length === 0 ? (
            <div className="alert alert-info mb-0">
              No tracking events found.
            </div>
          ) : (
            <div className="tracking-timeline">
              {history.map((e, i) => (
                <div
                  key={`${e.timestamp ?? i}-${e.status_code ?? i}`}
                  className="tracking-timeline-item"
                >
                  <div className="fw-semibold text-primary">
                    {e.formatted_timestamp || String(e.timestamp ?? "")}
                  </div>
                  <div className="text-success fw-semibold">
                    {e.status_message || e.status_code || ""}
                  </div>
                  {e.location ? (
                    <div className="text-muted small">{e.location}</div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </div>,
      );
    } finally {
      setLoading(false);
    }
  }

  async function updateSingle(targetAwb: string) {
    setBulkLoading(true);
    setBulkMessage(`Updating ${targetAwb}...`);
    try {
      const res = await fetch("/api/admin/shipway-tracking", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "fetch_tracking",
          awb_number: targetAwb,
        }),
      });
      const data = await res.json();
      setBulkMessage(
        data.success
          ? `Updated ${targetAwb}`
          : `Failed ${targetAwb}: ${data.error ?? "error"}`,
      );
      router.refresh();
    } finally {
      setBulkLoading(false);
    }
  }

  async function bulkUpdateAll() {
    if (pending.length === 0) return;
    setBulkLoading(true);
    setBulkMessage("Updating all pending shipments...");
    try {
      const res = await fetch("/api/admin/shipway-tracking", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "bulk_update",
          awb_numbers: pending.map((p) => p.awb_number),
        }),
      });
      const data = await res.json();
      if (!data.success) {
        setBulkMessage(data.error ?? "Bulk update failed");
        return;
      }
      const r = data.data;
      setBulkMessage(
        `Done: ${r.success}/${r.total} succeeded, ${r.failed} failed.`,
      );
      router.refresh();
    } finally {
      setBulkLoading(false);
    }
  }

  return (
    <div className="tracking-page">
      <div className="admin-page-header">
        <div>
          <h4 className="mb-1">
            <i className="fas fa-satellite-dish me-2" />
            Shipway Tracking Management
          </h4>
          <p className="text-muted mb-0">
            Monitor and manage shipment tracking with Shipway API integration
          </p>
        </div>
      </div>

      <div className="row g-2 g-md-3 mb-3">
        {statusCounts.map((s) => (
          <div className="col-6 col-md-4 col-xl-2" key={s.shipment_status}>
            <div className="card tracking-stat-card h-100">
              <div className="card-body text-center py-3 px-2">
                <div className="tracking-stat-value">{s.count}</div>
                <div className="tracking-stat-label">
                  {labelStatus(s.shipment_status)}
                </div>
              </div>
            </div>
          </div>
        ))}
        <div className="col-6 col-md-4 col-xl-2">
          <div className="card tracking-stat-card h-100">
            <div className="card-body text-center py-3 px-2">
              <div className="tracking-stat-value">{activeCache}</div>
              <div className="tracking-stat-label">Active Cache Entries</div>
            </div>
          </div>
        </div>
      </div>

      <div className="row g-3 mb-3">
        <div className="col-lg-6">
          <div className="card shadow-sm h-100">
            <div className="card-header py-3">
              <h5 className="mb-0">
                <i className="fas fa-search me-2" />
                Track Individual Shipment
              </h5>
            </div>
            <div className="card-body">
              <input
                type="text"
                className="form-control mb-3"
                placeholder="Enter AWB Number (e.g., BD1234567890)"
                maxLength={25}
                value={awb}
                onChange={(e) => setAwb(e.target.value)}
              />
              <div className="d-flex flex-wrap gap-2 mb-3">
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={loading}
                  onClick={() => void validateAwb()}
                >
                  Validate AWB
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={loading}
                  onClick={() => void fetchTracking()}
                >
                  Fetch Tracking
                </button>
                <button
                  type="button"
                  className="btn btn-info text-white"
                  disabled={loading}
                  onClick={() => void getHistory()}
                >
                  Get History
                </button>
              </div>
              {result ? (
                <div className="tracking-result-panel">{result}</div>
              ) : null}
            </div>
          </div>
        </div>

        <div className="col-lg-6">
          <div className="card shadow-sm h-100">
            <div className="card-header py-3">
              <h5 className="mb-0">
                <i className="fas fa-boxes me-2" />
                Bulk Operations
              </h5>
            </div>
            <div className="card-body">
              <p className="mb-3">
                Shipments needing updates: <strong>{pending.length}</strong>
              </p>
              {pending.length > 0 ? (
                <>
                  <button
                    type="button"
                    className="btn btn-warning mb-3"
                    disabled={bulkLoading}
                    onClick={() => void bulkUpdateAll()}
                  >
                    {bulkLoading ? "Updating..." : "Update All Pending"}
                  </button>
                  {bulkMessage ? (
                    <div className="alert alert-info py-2 mb-3">
                      {bulkMessage}
                    </div>
                  ) : null}
                  <div className="table-responsive tracking-pending-table">
                    <table className="table table-sm table-hover mb-0">
                      <thead className="table-light">
                        <tr>
                          <th>AWB Number</th>
                          <th>Courier</th>
                          <th>Status</th>
                          <th>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pending.slice(0, 10).map((s) => (
                          <tr key={s.shipment_id}>
                            <td>{s.awb_number}</td>
                            <td>{s.courier_partner}</td>
                            <td>
                              <span className="badge bg-secondary">
                                {labelStatus(s.shipment_status)}
                              </span>
                            </td>
                            <td>
                              <button
                                type="button"
                                className="btn btn-sm btn-primary"
                                disabled={bulkLoading}
                                onClick={() => void updateSingle(s.awb_number)}
                              >
                                Update
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : (
                <p className="text-success mb-0">
                  ✓ All shipments are up to date!
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      {apiStats.length > 0 ? (
        <div className="card shadow-sm">
          <div className="card-header py-3">
            <h5 className="mb-0">
              <i className="fas fa-chart-bar me-2" />
              API Usage Statistics (Last 7 Days)
            </h5>
          </div>
          <div className="card-body p-0">
            <div className="table-responsive">
              <table className="table table-hover mb-0">
                <thead className="table-light">
                  <tr>
                    <th>Date</th>
                    <th>Total Calls</th>
                    <th>Successful</th>
                    <th>Failed</th>
                    <th>Success Rate</th>
                    <th>Avg Response Time</th>
                  </tr>
                </thead>
                <tbody>
                  {apiStats.map((stat) => {
                    const rate =
                      stat.total_calls > 0
                        ? (
                            (stat.successful_calls / stat.total_calls) *
                            100
                          ).toFixed(1)
                        : "0.0";
                    return (
                      <tr key={stat.date}>
                        <td>{stat.date}</td>
                        <td>{stat.total_calls}</td>
                        <td className="text-success">
                          {stat.successful_calls}
                        </td>
                        <td className="text-danger">{stat.failed_calls}</td>
                        <td>{rate}%</td>
                        <td>{Math.round(stat.avg_response_time ?? 0)}ms</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
