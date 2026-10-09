"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { AwbStatusResult } from "@/lib/admin/external-shipment-sync";
import { AssignAwbButton } from "@/components/admin/assign-awb-button";

function formatIst(value: string | null | undefined) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return (
    d.toLocaleString("en-GB", {
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

function badgeClass(status: AwbStatusResult | null) {
  if (!status) return "bg-secondary";
  const display = status.display_status ?? "N/A";
  const mapped = status.mapped_status ?? "";
  if (display === "N/A") return "bg-secondary";
  if (["delivered", "return_delivered"].includes(mapped)) return "bg-success";
  if (["in_transit", "return_in_transit"].includes(mapped)) return "bg-primary";
  if (
    [
      "out_for_delivery",
      "out_for_pickup",
      "return_out_for_pickup",
      "return_pickup_generated",
      "awb_assigned_forward",
      "awb_assigned_return",
      "reached_at_destination_hub",
    ].includes(mapped)
  ) {
    return "bg-info text-dark";
  }
  if (["undelivered", "pickup_exception", "return_cancelled"].includes(mapped)) {
    return "bg-danger";
  }
  if (mapped === "delayed") return "bg-warning text-dark";
  return "bg-info text-dark";
}

function StatusBadge({ status }: { status: AwbStatusResult | null }) {
  if (!status) {
    return <span className="badge bg-secondary">Unknown</span>;
  }
  return (
    <>
      <span className={`badge ${badgeClass(status)}`}>
        {status.display_status}
      </span>
      {status.needs_action ? (
        <span className="badge bg-warning text-dark ms-1">
          <i className="fas fa-exclamation-triangle me-1" />
          Action Needed
        </span>
      ) : null}
    </>
  );
}

function ShipmentSection({
  title,
  iconClass,
  awb,
  status,
}: {
  title: string;
  iconClass: string;
  awb: string;
  status: AwbStatusResult | null;
}) {
  return (
    <div className="mb-3">
      <h6 className="mb-2">
        <i className={`${iconClass} me-1`} />
        {title}
      </h6>
      <div className="row mb-1">
        <div className="col-4">
          <strong>AWB:</strong>
        </div>
        <div className="col-8">
          <span className="badge bg-success">{awb}</span>
        </div>
      </div>
      {status?.courier ? (
        <div className="row mb-1">
          <div className="col-4">
            <strong>Courier:</strong>
          </div>
          <div className="col-8">{status.courier}</div>
        </div>
      ) : null}
      <div className="row mb-1">
        <div className="col-4">
          <strong>Status:</strong>
        </div>
        <div className="col-8">
          <StatusBadge status={status} />
        </div>
      </div>
      {status?.last_updated ? (
        <div className="row">
          <div className="col-4">
            <strong>Updated:</strong>
          </div>
          <div className="col-8">
            <small className="text-muted">{formatIst(status.last_updated)}</small>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function ShipmentTrackingCard({
  ticketId,
  forwardAwb,
  reverseAwb,
  courierPartner,
  initialForward,
  initialReverse,
  customerAddress = "",
  canAssignAwb = true,
}: {
  ticketId: number;
  forwardAwb: string | null;
  reverseAwb: string | null;
  courierPartner: string | null;
  initialForward: AwbStatusResult | null;
  initialReverse: AwbStatusResult | null;
  customerAddress?: string;
  canAssignAwb?: boolean;
}) {
  const router = useRouter();
  const [forward, setForward] = useState(initialForward);
  const [reverse, setReverse] = useState(initialReverse);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const hasAnyAwb = Boolean(forwardAwb?.trim() || reverseAwb?.trim());

  async function refreshTracking() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/tickets/tracking", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticket_id: ticketId }),
      });
      const data = await res.json();
      if (!data.success) {
        setError(data.error ?? "Failed to refresh tracking");
        return;
      }
      setForward(data.forward ?? null);
      setReverse(data.reverse ?? null);
      if (data.case_completed) {
        router.refresh();
      }
    } catch {
      setError("Failed to refresh tracking");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card shadow mb-4">
      <div className="card-header d-flex justify-content-between align-items-center">
        <span>
          <i className="fas fa-shipping-fast me-2" />
          Shipment Tracking
        </span>
        <div className="d-flex gap-2">
          {hasAnyAwb ? (
            <button
              type="button"
              className="btn btn-sm btn-outline-primary"
              disabled={loading}
              onClick={() => void refreshTracking()}
            >
              <i className={`fas fa-sync-alt me-1 ${loading ? "fa-spin" : ""}`} />
              {loading ? "Refreshing..." : "Refresh"}
            </button>
          ) : null}
          {canAssignAwb ? (
            <AssignAwbButton
              ticketId={ticketId}
              hasAnyAwb={hasAnyAwb}
              defaultAddress={customerAddress}
            />
          ) : null}
        </div>
      </div>
      <div className="card-body">
        {!hasAnyAwb ? (
          <div className="text-center py-3">
            <p className="text-muted mb-0">No AWB number assigned yet</p>
          </div>
        ) : (
          <>
            {error ? <div className="alert alert-danger py-2">{error}</div> : null}
            {forwardAwb ? (
              <div
                className={
                  reverseAwb ? "mb-3 pb-3 border-bottom" : "mb-0"
                }
              >
                <ShipmentSection
                  title="Forward Shipment"
                  iconClass="fas fa-truck text-success"
                  awb={forwardAwb}
                  status={forward}
                />
              </div>
            ) : null}
            {reverseAwb ? (
              <ShipmentSection
                title="Return Shipment"
                iconClass="fas fa-undo-alt text-warning"
                awb={reverseAwb}
                status={reverse}
              />
            ) : null}
            {courierPartner && !forward?.courier && !reverse?.courier ? (
              <div className="small text-muted border-top pt-2">
                Courier on ticket: {courierPartner}
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
