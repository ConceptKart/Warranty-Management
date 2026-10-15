"use client";

import { FormEvent, useState } from "react";

type ShopifyOrderRow = {
  id: number;
  shopify_order_id: string | null;
  sku: string | null;
  order_date: string | Date | null;
  awb_number: string | null;
  customer_name: string | null;
  qty: number | null;
};

type AlertState = { ok: boolean; text: string } | null;

function formatIst(value: string | Date | null | undefined) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function ShopifyImportForm() {
  const [directOrder, setDirectOrder] = useState("");
  const [directBusy, setDirectBusy] = useState(false);
  const [directAlert, setDirectAlert] = useState<AlertState>(null);
  const [directInserted, setDirectInserted] = useState<number | null>(null);
  const [directSkipped, setDirectSkipped] = useState<number | null>(null);
  const [directOrderId, setDirectOrderId] = useState<string | null>(null);
  const [rows, setRows] = useState<ShopifyOrderRow[]>([]);

  const [ckOrderId, setCkOrderId] = useState("");
  const [statusBusy, setStatusBusy] = useState(false);
  const [statusAlert, setStatusAlert] = useState<AlertState>(null);
  const [statusMeta, setStatusMeta] = useState<{
    order_id: string | null;
    awb: string | null;
    status: string | null;
  } | null>(null);

  async function onDirectImport(e: FormEvent) {
    e.preventDefault();
    const id = directOrder.trim();
    if (!id) {
      setDirectAlert({
        ok: false,
        text: "Please enter Shopify Order ID or Order Number.",
      });
      return;
    }

    setDirectBusy(true);
    setDirectAlert(null);
    setDirectInserted(null);
    setDirectSkipped(null);
    setDirectOrderId(null);
    setRows([]);

    try {
      const res = await fetch("/api/admin/shopify-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "import_shopify_direct",
          shopify_direct_order: id,
        }),
      });
      const data = (await res.json()) as {
        success?: boolean;
        message?: string;
        inserted?: number;
        skipped?: number;
        shopify_order_id?: string | null;
        rows?: ShopifyOrderRow[];
      };
      const ok = Boolean(data.success);
      setDirectAlert({
        ok,
        text:
          data.message ??
          (ok ? "Direct Shopify Import Completed" : "Order Not Found in Shopify Store."),
      });
      setDirectInserted(typeof data.inserted === "number" ? data.inserted : null);
      setDirectSkipped(typeof data.skipped === "number" ? data.skipped : null);
      setDirectOrderId(data.shopify_order_id ?? null);
      setRows(data.rows ?? []);
    } catch {
      setDirectAlert({
        ok: false,
        text: "Request failed. Check SHOPIFY_ACCESS_TOKEN and try again.",
      });
    } finally {
      setDirectBusy(false);
    }
  }

  async function onUpdateStatus(e: FormEvent) {
    e.preventDefault();
    const id = ckOrderId.trim();
    if (!id) {
      setStatusAlert({ ok: false, text: "Please enter CK Order ID." });
      return;
    }

    setStatusBusy(true);
    setStatusAlert(null);
    setStatusMeta(null);

    try {
      const res = await fetch("/api/admin/shopify-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update_status",
          ck_order_id: id,
        }),
      });
      const data = (await res.json()) as {
        success?: boolean;
        message?: string;
        order_id?: string | null;
        awb?: string | null;
        status?: string | null;
      };
      const ok = Boolean(data.success);
      setStatusAlert({
        ok,
        text: data.message ?? (ok ? "Status Updated Successfully" : "Order not found."),
      });
      setStatusMeta({
        order_id: data.order_id ?? null,
        awb: data.awb ?? null,
        status: data.status ?? null,
      });
    } catch {
      setStatusAlert({
        ok: false,
        text: "Request failed. Check Shipway credentials and try again.",
      });
    } finally {
      setStatusBusy(false);
    }
  }

  return (
    <div className="container mt-4 mt-md-5 pb-5" style={{ maxWidth: 720 }}>
      <div className="card shadow mb-4">
        <div className="card-header bg-primary text-white fw-bold">
          Import Shopify Order
        </div>
        <div className="card-body">
          {directAlert ? (
            <div
              className={`alert ${directAlert.ok ? "alert-success" : "alert-danger"}`}
              role="alert"
            >
              {directAlert.ok ? (
                <>
                  <strong>Direct Shopify Import Completed</strong>
                  <br />
                  {directOrderId ? (
                    <>
                      Order: {directOrderId}
                      <br />
                    </>
                  ) : null}
                  Inserted : {directInserted ?? 0}
                  <br />
                  Skipped : {directSkipped ?? 0}
                </>
              ) : (
                directAlert.text
              )}
            </div>
          ) : null}
          <form onSubmit={(e) => void onDirectImport(e)}>
            <div className="mb-3">
              <label className="form-label" htmlFor="shopify_direct_order">
                Shopify Order ID
              </label>
              <input
                id="shopify_direct_order"
                name="shopify_direct_order"
                type="text"
                className="form-control"
                placeholder="Example: 282379 or #CK282379"
                value={directOrder}
                onChange={(e) => setDirectOrder(e.target.value)}
                autoComplete="off"
                required
                disabled={directBusy}
              />
            </div>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={directBusy}
            >
              {directBusy ? "Fetching…" : "Fetch & Save"}
            </button>
          </form>
        </div>
      </div>

      {rows.length > 0 ? (
        <div className="card shadow mb-4">
          <div className="card-header">Saved rows</div>
          <div className="table-responsive">
            <table className="table table-sm mb-0">
              <thead>
                <tr>
                  <th>Shopify ID</th>
                  <th>SKU</th>
                  <th>Date</th>
                  <th>AWB</th>
                  <th>Customer</th>
                  <th>Qty</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td>{row.shopify_order_id ?? "—"}</td>
                    <td>{row.sku ?? "—"}</td>
                    <td>{formatIst(row.order_date)}</td>
                    <td>{row.awb_number || "—"}</td>
                    <td>{row.customer_name ?? "—"}</td>
                    <td>{row.qty ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <div className="card shadow">
        <div className="card-header bg-success text-white fw-bold">
          Update Shipment Status
        </div>
        {statusAlert ? (
          <div
            className={`alert ${statusAlert.ok ? "alert-success" : "alert-danger"} mb-0`}
            style={{ margin: "20px 20px 0 20px" }}
            role="alert"
          >
            {statusAlert.ok ? (
              <>
                Status Updated Successfully
                <br />
                <br />
                Order ID : {statusMeta?.order_id ?? "—"}
                <br />
                AWB : {statusMeta?.awb ?? "—"}
                <br />
                Status : {statusMeta?.status ?? "—"}
              </>
            ) : (
              statusAlert.text
            )}
          </div>
        ) : null}
        <div className="card-body">
          <form onSubmit={(e) => void onUpdateStatus(e)}>
            <div className="mb-3">
              <label className="form-label" htmlFor="ck_order_id">
                CK Order ID
              </label>
              <input
                id="ck_order_id"
                name="ck_order_id"
                type="text"
                className="form-control"
                placeholder="Example : #CK282379 or CK282379"
                value={ckOrderId}
                onChange={(e) => setCkOrderId(e.target.value)}
                autoComplete="off"
                required
                disabled={statusBusy}
              />
            </div>
            <button
              type="submit"
              className="btn btn-success"
              disabled={statusBusy}
            >
              {statusBusy ? "Checking…" : "Check & Update"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
