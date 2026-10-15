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
  const [shopOrderId, setShopOrderId] = useState("");
  const [busy, setBusy] = useState(false);
  const [alert, setAlert] = useState<{ ok: boolean; text: string } | null>(
    null,
  );
  const [inserted, setInserted] = useState<number | null>(null);
  const [skipped, setSkipped] = useState<number | null>(null);
  const [rows, setRows] = useState<ShopifyOrderRow[]>([]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const id = shopOrderId.trim();
    if (!id) {
      setAlert({ ok: false, text: "Please enter Shopify Order ID." });
      return;
    }

    setBusy(true);
    setAlert(null);
    setInserted(null);
    setSkipped(null);
    setRows([]);

    try {
      const res = await fetch("/api/admin/shopify-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "import_order",
          shop_order_id: id,
        }),
      });
      const data = (await res.json()) as {
        success?: boolean;
        message?: string;
        inserted?: number;
        skipped?: number;
        rows?: ShopifyOrderRow[];
      };

      const ok = Boolean(data.success);
      setAlert({
        ok,
        text: data.message ?? (ok ? "Import Completed" : "Order Not Found"),
      });
      setInserted(typeof data.inserted === "number" ? data.inserted : null);
      setSkipped(typeof data.skipped === "number" ? data.skipped : null);
      setRows(data.rows ?? []);
    } catch {
      setAlert({
        ok: false,
        text: "Request failed. Check BASELINKER_TOKEN and try again.",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="container mt-4 mt-md-5" style={{ maxWidth: 720 }}>
      <div className="card shadow">
        <div className="card-header bg-primary text-white">
          Import Shopify Order
        </div>
        <div className="card-body">
          {alert ? (
            <div
              className={`alert ${alert.ok ? "alert-success" : "alert-danger"}`}
              role="alert"
            >
              {alert.ok ? (
                <>
                  <strong>Import Completed</strong>
                  <br />
                  Inserted : {inserted ?? 0}
                  <br />
                  Skipped : {skipped ?? 0}
                </>
              ) : (
                alert.text
              )}
            </div>
          ) : null}

          <form onSubmit={(e) => void onSubmit(e)}>
            <div className="mb-3">
              <label className="form-label" htmlFor="shop_order_id">
                Shopify Order ID
              </label>
              <input
                id="shop_order_id"
                name="shop_order_id"
                type="text"
                inputMode="numeric"
                className="form-control"
                placeholder="Example : 123456"
                value={shopOrderId}
                onChange={(e) => setShopOrderId(e.target.value)}
                autoComplete="off"
                required
                disabled={busy}
              />
              <div className="form-text">
                Numeric Shopify shop order id (also accepts #CK123456). Pulls
                the order from BaseLinker and saves line items into{" "}
                <code>shopify_orders</code>. Existing{" "}
                <code>base_order_id</code> + <code>product_id</code> rows are
                skipped.
              </div>
            </div>
            <button type="submit" className="btn btn-success" disabled={busy}>
              {busy ? "Fetching…" : "Fetch & Save"}
            </button>
          </form>
        </div>
      </div>

      {rows.length > 0 ? (
        <div className="card shadow mt-3">
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
    </div>
  );
}
