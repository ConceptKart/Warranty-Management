"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type OriginalProduct = {
  product_name: string;
  product_sku: string;
  ean: string;
};

type LookedUpProduct = {
  product_id: number | string | null;
  variant_id: number | string | null;
  name: string;
  sku: string;
  ean: string;
};

type Warehouse = {
  warehouse_key: string;
  warehouse_id: number;
  stock: number;
  locations: string[];
};

const WAREHOUSE_NAMES: Record<string, string> = {
  "9000461": "Main Warehouse",
  "9001939": "Secondary Warehouse",
};

function formatWarehouse(id: number) {
  return WAREHOUSE_NAMES[String(id)] || `Warehouse ${id}`;
}

export function ReplacementEanModal({
  ticketId,
  ticketNumber,
  baselinkerOrderId,
  unitReplacedStatusId,
  onClose,
}: {
  ticketId: number;
  ticketNumber: string;
  baselinkerOrderId: string;
  unitReplacedStatusId: number;
  onClose: () => void;
}) {
  const router = useRouter();
  const [original, setOriginal] = useState<OriginalProduct | null>(null);
  const [ean, setEan] = useState("");
  const [loadingInfo, setLoadingInfo] = useState(true);
  const [lookingUp, setLookingUp] = useState(false);
  const [product, setProduct] = useState<LookedUpProduct | null>(null);
  const [source, setSource] = useState("");
  const [lookupError, setLookupError] = useState("");
  const [notFound, setNotFound] = useState("");
  const [stockLoading, setStockLoading] = useState(false);
  const [stockError, setStockError] = useState("");
  const [warehouseId, setWarehouseId] = useState<number | null>(null);
  const [locationName, setLocationName] = useState("");
  const [stockInfo, setStockInfo] = useState("");
  const [replacing, setReplacing] = useState(false);
  const [replaceMsg, setReplaceMsg] = useState<{
    ok: boolean;
    text: string;
  } | null>(null);
  const [canSave, setCanSave] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/admin/tickets/replacement-ean", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "get_replacement_product_info",
            ticket_id: ticketId,
          }),
        });
        const data = await res.json();
        if (cancelled) return;
        if (data.success && data.original_product) {
          setOriginal(data.original_product);
        } else {
          setError(data.error ?? "Failed to load product info");
        }
      } finally {
        if (!cancelled) setLoadingInfo(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ticketId]);

  async function lookupProduct() {
    const trimmed = ean.trim();
    if (!trimmed) {
      setLookupError("Please enter an EAN code");
      return;
    }
    setLookingUp(true);
    setLookupError("");
    setNotFound("");
    setProduct(null);
    setCanSave(false);
    setReplaceMsg(null);
    setStockError("");
    setStockInfo("");
    setWarehouseId(null);
    setLocationName("");
    try {
      const res = await fetch("/api/admin/tickets/replacement-ean", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "fetch_product_by_ean", ean: trimmed }),
      });
      const data = await res.json();
      if (!data.success || !data.product) {
        setNotFound(data.error ?? "Product not found");
        return;
      }
      setProduct(data.product);
      setSource(data.source === "database" ? "Local DB" : "BaseLinker");
      await loadStock(data.product.product_id, data.product.variant_id);
    } catch (err) {
      setLookupError(
        err instanceof Error ? err.message : "Error searching for product",
      );
    } finally {
      setLookingUp(false);
    }
  }

  async function loadStock(
    productId: number | string | null,
    variantId: number | string | null,
  ) {
    setStockLoading(true);
    setStockError("");
    try {
      const res = await fetch("/api/admin/tickets/unit-replace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "get_stock",
          product_id: productId,
          variant_id: variantId,
        }),
      });
      const data = await res.json();
      const warehouses = (data.warehouses ?? []) as Warehouse[];
      if (!data.success || warehouses.length === 0) {
        setStockError(
          data.error || "No stock information available for this product.",
        );
        return;
      }

      let totalLocations = 0;
      for (const wh of warehouses) {
        totalLocations += wh.locations?.length ?? 0;
      }
      if (totalLocations === 0) {
        setStockError(
          "No stock with valid locations available for this product.",
        );
        return;
      }

      const sorted = [...warehouses].sort((a, b) => {
        const stockDiff = Math.abs(a.stock - b.stock);
        const isSimilar = stockDiff < Math.max(a.stock, b.stock) * 0.1;
        if (isSimilar && a.warehouse_id === 9001939) return -1;
        if (isSimilar && b.warehouse_id === 9001939) return 1;
        return b.stock - a.stock;
      });
      const selected = sorted[0];
      const loc =
        selected.locations[
          Math.floor(Math.random() * selected.locations.length)
        ];
      setWarehouseId(selected.warehouse_id);
      setLocationName(loc);
      setStockInfo(
        `Auto-assigned Warehouse: ${formatWarehouse(selected.warehouse_id)} | Location: ${loc} | Available Stock: ${selected.stock}`,
      );
    } catch (err) {
      setStockError(
        err instanceof Error ? err.message : "Error loading stock",
      );
    } finally {
      setStockLoading(false);
    }
  }

  async function doReplaceUnit() {
    if (!product || !warehouseId || !locationName) {
      alert("No warehouse/location selected. Please lookup a product first.");
      return;
    }
    setReplacing(true);
    setReplaceMsg(null);
    try {
      const res = await fetch("/api/admin/tickets/unit-replace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "replace_unit",
          product_id: product.product_id,
          variant_id: product.variant_id,
          warehouse_id: warehouseId,
          location_name: locationName,
          ticket_id: ticketId,
          ticket_number: ticketNumber,
          order_id: baselinkerOrderId,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setReplaceMsg({ ok: true, text: data.message ?? "Unit replaced" });
        setCanSave(true);
      } else {
        setReplaceMsg({
          ok: false,
          text: data.error ?? "Failed to create IGI document",
        });
      }
    } catch (err) {
      setReplaceMsg({
        ok: false,
        text: err instanceof Error ? err.message : "Replace failed",
      });
    } finally {
      setReplacing(false);
    }
  }

  async function saveAndContinue(e: FormEvent) {
    e.preventDefault();
    if (!product || !ean.trim()) {
      alert("Please enter an EAN code");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const saveRes = await fetch("/api/admin/tickets/replacement-ean", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "save_replacement_ean",
          ticket_id: ticketId,
          ean: ean.trim(),
          product_id: product.product_id,
          variant_id: product.variant_id,
          warehouse_id: warehouseId,
          location_name: locationName,
        }),
      });
      const saveData = await saveRes.json();
      if (!saveData.success) {
        setError(saveData.error ?? "Failed to save replacement EAN");
        return;
      }

      const statusRes = await fetch("/api/admin/tickets/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticket_id: ticketId,
          status_id: unitReplacedStatusId,
          reason: "Unit replaced",
          notes: `Replacement EAN: ${ean.trim()}`,
        }),
      });
      const statusData = await statusRes.json();
      if (statusData.success) {
        alert(
          `Status updated to Unit Replaced. Replacement product saved: ${ean.trim()}`,
        );
      } else {
        alert(
          `Replacement EAN saved but status update failed: ${statusData.error || "Unknown error"}`,
        );
      }
      onClose();
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="modal fade show d-block"
      tabIndex={-1}
      style={{ backgroundColor: "rgba(0,0,0,.5)" }}
      onClick={onClose}
    >
      <div
        className="modal-dialog modal-lg modal-dialog-centered modal-dialog-scrollable"
        onClick={(ev) => ev.stopPropagation()}
      >
        <div className="modal-content">
          <div className="modal-header bg-info text-white">
            <h5 className="modal-title">
              <i className="fas fa-barcode me-2" />
              Replacement Product Information
            </h5>
            <button
              type="button"
              className="btn-close btn-close-white"
              aria-label="Close"
              onClick={onClose}
            />
          </div>
          <div className="modal-body">
            {loadingInfo ? (
              <div className="text-center py-4 text-muted">Loading…</div>
            ) : (
              <>
                <div className="alert alert-secondary mb-3">
                  <h6 className="mb-2">
                    <i className="fas fa-box me-1" /> Original Product
                  </h6>
                  <div className="row">
                    <div className="col-md-6">
                      <small className="text-muted">Product:</small>
                      <div>{original?.product_name || "—"}</div>
                    </div>
                    <div className="col-md-3">
                      <small className="text-muted">SKU:</small>
                      <div>{original?.product_sku || "—"}</div>
                    </div>
                    <div className="col-md-3">
                      <small className="text-muted">EAN:</small>
                      <div>{original?.ean || "—"}</div>
                    </div>
                  </div>
                </div>

                <div className="card mb-3">
                  <div className="card-header bg-primary text-white py-2">
                    <h6 className="mb-0">
                      <i className="fas fa-search me-1" /> Enter Replacement
                      Product EAN
                    </h6>
                  </div>
                  <div className="card-body">
                    <div className="row">
                      <div className="col-md-8">
                        <label className="form-label">Product EAN Code</label>
                        <input
                          className="form-control"
                          value={ean}
                          onChange={(ev) => setEan(ev.target.value)}
                          onKeyDown={(ev) => {
                            if (ev.key === "Enter") {
                              ev.preventDefault();
                              void lookupProduct();
                            }
                          }}
                          placeholder="Enter 8-14 digit EAN code"
                          maxLength={50}
                        />
                        <div className="form-text">
                          Enter the EAN of the replacement product. The system
                          will look up product/variant IDs from BaseLinker.
                        </div>
                      </div>
                      <div className="col-md-4 d-flex align-items-end">
                        <button
                          type="button"
                          className="btn btn-primary w-100"
                          disabled={lookingUp}
                          onClick={() => void lookupProduct()}
                        >
                          {lookingUp ? (
                            "Searching…"
                          ) : (
                            <>
                              <i className="fas fa-search me-1" /> Lookup Product
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                {lookingUp ? (
                  <div className="text-center py-3 text-muted">
                    Searching BaseLinker inventory…
                  </div>
                ) : null}

                {lookupError ? (
                  <div className="alert alert-danger py-2">{lookupError}</div>
                ) : null}
                {notFound ? (
                  <div className="alert alert-warning">
                    <i className="fas fa-exclamation-triangle me-2" />
                    {notFound}
                  </div>
                ) : null}

                {product ? (
                  <div className="alert alert-success">
                    <div className="d-flex justify-content-between align-items-center">
                      <div>
                        <strong>{product.name || "—"}</strong>
                        <div className="small mt-1">
                          SKU: {product.sku || "—"} | EAN: {product.ean || "—"}
                        </div>
                      </div>
                      <div className="text-end">
                        <div className="badge bg-info mb-1">{source}</div>
                        <div className="small">
                          Product ID: <code>{product.product_id ?? "—"}</code>
                          {product.variant_id ? (
                            <>
                              {" "}
                              | Variant ID: <code>{product.variant_id}</code>
                            </>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </div>
                ) : null}

                {product ? (
                  <div className="mt-3">
                    <hr />
                    <h6 className="mb-2">
                      <i className="fas fa-warehouse me-1" /> Unit Replacement
                    </h6>
                    {stockLoading ? (
                      <div className="text-muted py-2">
                        Loading available stock…
                      </div>
                    ) : null}
                    {stockError ? (
                      <div className="alert alert-danger py-2">{stockError}</div>
                    ) : null}
                    {stockInfo ? (
                      <div className="alert alert-info py-2 mb-2">{stockInfo}</div>
                    ) : null}
                    {replaceMsg ? (
                      <div
                        className={`alert py-2 ${replaceMsg.ok ? "alert-success" : "alert-danger"}`}
                      >
                        {replaceMsg.text}
                      </div>
                    ) : null}
                    <button
                      type="button"
                      className={`btn w-100 ${canSave ? "btn-success" : "btn-warning"}`}
                      disabled={
                        replacing ||
                        !warehouseId ||
                        !locationName ||
                        stockLoading ||
                        Boolean(stockError)
                      }
                      onClick={() => void doReplaceUnit()}
                    >
                      {replacing
                        ? "Creating IGI Document…"
                        : canSave
                          ? "Unit Replaced"
                          : "Replace Unit (Create IGI Document)"}
                    </button>
                  </div>
                ) : null}

                <div className="alert alert-info mb-0 mt-3">
                  <i className="fas fa-info-circle me-1" />
                  <strong>Note:</strong> Enter the replacement product EAN, then
                  create an IGI document to record the stock reduction. Save
                  continues with status update to Unit Replaced.
                </div>

                {error ? (
                  <div className="alert alert-danger py-2 mt-3">{error}</div>
                ) : null}
              </>
            )}
          </div>
          <div className="modal-footer">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-success"
              disabled={!canSave || saving}
              onClick={(ev) => void saveAndContinue(ev)}
            >
              {saving ? "Saving…" : "Save & Continue"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
