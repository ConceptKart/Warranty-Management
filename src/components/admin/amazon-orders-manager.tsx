"use client";

import { FormEvent, useEffect, useRef, useState } from "react";

type AmazonRow = {
  id: number;
  amazon_order_id: string | null;
  sku: string | null;
  amazon_title: string | null;
  order_date: string | Date | null;
  ean: string | null;
};

type View = "idle" | "results" | "not_found" | "insert";

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

function defaultDatetimeLocal() {
  const ist = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  return ist.toISOString().slice(0, 16);
}

function todayIstYmd() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

function truncate(text: string | null | undefined, max = 40) {
  const v = text ?? "—";
  if (v.length <= max) return v;
  return `${v.slice(0, max)}…`;
}

export function AmazonOrdersManager() {
  const searchRef = useRef<HTMLInputElement>(null);
  const skuRef = useRef<HTMLInputElement>(null);

  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [view, setView] = useState<View>("idle");
  const [rows, setRows] = useState<AmazonRow[]>([]);
  const [orderId, setOrderId] = useState("");
  const [sku, setSku] = useState("");
  const [orderDate, setOrderDate] = useState(defaultDatetimeLocal);
  const [syncDate, setSyncDate] = useState(todayIstYmd);
  const [insertMsg, setInsertMsg] = useState<{
    ok: boolean;
    text: string;
  } | null>(null);
  const [syncMsg, setSyncMsg] = useState<{
    ok: boolean;
    text: string;
  } | null>(null);
  const [searching, setSearching] = useState(false);
  const [inserting, setInserting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [pulseKey, setPulseKey] = useState(0);

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  useEffect(() => {
    if (view === "insert") {
      window.setTimeout(() => skuRef.current?.focus(), 80);
    }
  }, [view]);

  async function copyText(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(text);
      window.setTimeout(() => setCopied(null), 1400);
    } catch {
      // ignore
    }
  }

  async function doSearch(e?: FormEvent, overrideQ?: string) {
    e?.preventDefault();
    const q = (overrideQ ?? query).trim();
    if (!q) {
      setStatus("⚠ Please enter an Order ID to search.");
      setView("idle");
      searchRef.current?.focus();
      return;
    }

    setQuery(q);
    setSearching(true);
    setStatus("Searching…");
    setRows([]);
    setView("idle");
    setInsertMsg(null);
    setSyncMsg(null);

    try {
      const res = await fetch(
        `/api/admin/amazon-orders?q=${encodeURIComponent(q)}`,
      );
      const data = (await res.json()) as {
        found?: boolean;
        rows?: AmazonRow[];
        error?: string;
      };

      if (!res.ok || data.error) {
        setStatus(`❌ ${data.error ?? "Search failed"}`);
        setView("idle");
        return;
      }

      setPulseKey((k) => k + 1);

      if (data.found && data.rows && data.rows.length > 0) {
        setStatus("");
        setRows(data.rows);
        setView("results");
      } else {
        setStatus("");
        setRows([]);
        setOrderId(q);
        setSku("");
        setOrderDate(defaultDatetimeLocal());
        setView("not_found");
      }
    } catch {
      setStatus("❌ Request failed. Please try again.");
      setView("idle");
    } finally {
      setSearching(false);
    }
  }

  async function doInsert(e: FormEvent) {
    e.preventDefault();
    setInsertMsg(null);

    if (!orderId.trim() || !sku.trim() || !orderDate.trim()) {
      setInsertMsg({ ok: false, text: "All three fields are required." });
      return;
    }

    setInserting(true);
    try {
      const res = await fetch("/api/admin/amazon-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amazon_order_id: orderId.trim(),
          sku: sku.trim(),
          order_date: orderDate.trim(),
        }),
      });
      const data = (await res.json()) as {
        success?: boolean;
        message?: string;
        id?: number;
      };

      if (!data.success) {
        setInsertMsg({
          ok: false,
          text: data.message ?? "Insert failed.",
        });
        return;
      }

      setInsertMsg({
        ok: true,
        text:
          (data.message ?? "Order inserted successfully!") +
          (data.id ? ` (Row ID: ${data.id})` : ""),
      });
      setQuery(orderId.trim());
      window.setTimeout(() => {
        void doSearch(undefined, orderId.trim());
      }, 1000);
    } catch {
      setInsertMsg({ ok: false, text: "Request failed. Please try again." });
    } finally {
      setInserting(false);
    }
  }

  async function doSyncDay() {
    const q = query.trim();
    if (!q) {
      setSyncMsg({ ok: false, text: "Enter an Order ID first." });
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(syncDate)) {
      setSyncMsg({ ok: false, text: "Pick a valid order date (YYYY-MM-DD)." });
      return;
    }

    setSyncing(true);
    setSyncMsg(null);
    setStatus("Pulling Amazon orders from BaseLinker for that day…");

    try {
      const res = await fetch("/api/admin/amazon-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "sync_day",
          q,
          date: syncDate,
        }),
      });
      const data = (await res.json()) as {
        success?: boolean;
        found?: boolean;
        rows?: AmazonRow[];
        message?: string;
      };

      setPulseKey((k) => k + 1);
      setStatus("");

      if (!data.success) {
        setSyncMsg({
          ok: false,
          text: data.message ?? "Sync failed.",
        });
        return;
      }

      setSyncMsg({
        ok: Boolean(data.found),
        text: data.message ?? "Sync finished.",
      });

      if (data.found && data.rows && data.rows.length > 0) {
        setRows(data.rows);
        setView("results");
      } else {
        setRows([]);
        setView("not_found");
      }
    } catch {
      setSyncMsg({
        ok: false,
        text: "Request failed. Check BASELINKER_TOKEN and try again.",
      });
    } finally {
      setSyncing(false);
    }
  }

  function clearSearch() {
    setQuery("");
    setStatus("");
    setRows([]);
    setView("idle");
    setInsertMsg(null);
    setSyncMsg(null);
    searchRef.current?.focus();
  }

  return (
    <div className="amazon-orders-page">
      <div className="ao-header">
        <div className="ao-logo" aria-hidden>
          <i className="fab fa-amazon" />
        </div>
        <div>
          <h1 className="ao-title">Amazon Order Lookup</h1>
          <p className="ao-subtitle">
            Search orders · Sync day from BaseLinker · Manual insert fallback
          </p>
        </div>
      </div>

      <section className={`ao-search-wrap${searching || syncing ? " is-busy" : ""}`}>
        <div className="ao-search-label">Search by Amazon Order ID</div>
        <form
          className="ao-search-row"
          onSubmit={(e) => void doSearch(e)}
        >
          <div className="ao-input-wrap">
            <i className="fas fa-search ao-input-icon" aria-hidden />
            <input
              ref={searchRef}
              id="search-input"
              type="text"
              className="ao-input"
              placeholder="e.g. 402-1234567-8901234"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              disabled={searching || syncing}
            />
            {query ? (
              <button
                type="button"
                className="ao-clear"
                onClick={clearSearch}
                aria-label="Clear search"
              >
                <i className="fas fa-times" />
              </button>
            ) : null}
          </div>
          <button
            type="submit"
            className="ao-btn ao-btn-primary"
            disabled={searching || syncing}
          >
            {searching ? (
              <>
                <span className="ao-spinner" />
                Searching…
              </>
            ) : (
              <>
                <i className="fas fa-search" />
                Search
              </>
            )}
          </button>
        </form>
        {status ? <div className="ao-status">{status}</div> : null}
      </section>

      {view === "results" ? (
        <section className="ao-panel" key={`results-${pulseKey}`}>
          <div className="ao-section-head">
            <span className="ao-section-title">Results</span>
            <span className="ao-count">
              {rows.length} row{rows.length === 1 ? "" : "s"}
            </span>
          </div>
          <div className="ao-table-wrap">
            <table className="ao-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Order ID</th>
                  <th>SKU</th>
                  <th>Title</th>
                  <th>Order Date</th>
                  <th>EAN</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const oid = r.amazon_order_id ?? "";
                  return (
                    <tr
                      key={r.id}
                      style={{ animationDelay: `${i * 40}ms` }}
                      className="ao-row"
                    >
                      <td>{r.id}</td>
                      <td className="ao-order-id">
                        <button
                          type="button"
                          className="ao-copy-btn"
                          title="Click to copy"
                          onClick={() => void copyText(oid)}
                        >
                          {oid || "—"}
                          <i
                            className={`fas ${copied === oid ? "fa-check" : "fa-copy"} ms-1`}
                          />
                        </button>
                      </td>
                      <td className="ao-sku">{r.sku ?? "—"}</td>
                      <td title={r.amazon_title ?? ""}>
                        {truncate(r.amazon_title)}
                      </td>
                      <td>{formatIst(r.order_date)}</td>
                      <td>{r.ean ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="ao-hint mt-2 mb-0">
            Tip: click an Order ID to copy it.
          </p>
        </section>
      ) : null}

      {view === "not_found" ? (
        <section className="ao-not-found" key={`nf-${pulseKey}`}>
          <div className="ao-not-found-icon" aria-hidden>
            <i className="fas fa-search" />
          </div>
          <h2>Order Not Found</h2>
          <p>
            No local records for &quot;{query}&quot;. Prefer pulling that day
            from BaseLinker (fills product/variant IDs). Manual insert is a
            last resort.
          </p>

          <div className="ao-sync-box">
            <label className="ao-search-label" htmlFor="ao-sync-date">
              Order date (IST)
            </label>
            <div className="ao-sync-row">
              <input
                id="ao-sync-date"
                type="date"
                className="ao-input"
                value={syncDate}
                onChange={(e) => setSyncDate(e.target.value)}
                disabled={syncing}
              />
              <button
                type="button"
                className="ao-btn ao-btn-primary"
                onClick={() => void doSyncDay()}
                disabled={syncing}
              >
                {syncing ? (
                  <>
                    <span className="ao-spinner" />
                    Syncing…
                  </>
                ) : (
                  <>
                    <i className="fas fa-cloud-download-alt" />
                    Sync day from BaseLinker
                  </>
                )}
              </button>
            </div>
            {syncMsg ? (
              <div
                className={`ao-alert ${syncMsg.ok ? "ao-alert-success" : "ao-alert-error"}`}
              >
                <i
                  className={`fas ${syncMsg.ok ? "fa-check-circle" : "fa-times-circle"}`}
                />
                {syncMsg.text}
              </div>
            ) : null}
          </div>

          <div className="ao-or">or</div>

          <button
            type="button"
            className="ao-btn ao-btn-ghost"
            onClick={() => {
              setInsertMsg(null);
              setOrderId(query.trim());
              setOrderDate(defaultDatetimeLocal());
              setView("insert");
            }}
          >
            <i className="fas fa-plus" />
            Manual insert (last resort)
          </button>
        </section>
      ) : null}

      {view === "insert" ? (
        <section className="ao-form-card" key={`insert-${pulseKey}`}>
          <h3>
            <span aria-hidden>📥</span>
            Insert New Order&nbsp;
            <span className="ao-accent-text">→ amazon_order_details</span>
          </h3>

          <form onSubmit={(e) => void doInsert(e)}>
            <div className="ao-form-grid">
              <div className="ao-field ao-field-full">
                <label htmlFor="f-order-id">
                  Amazon Order ID <span className="ao-req">*</span>
                </label>
                <input
                  id="f-order-id"
                  type="text"
                  className="ao-input"
                  placeholder="402-XXXXXXX-XXXXXXX"
                  value={orderId}
                  onChange={(e) => setOrderId(e.target.value)}
                  required
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
              <div className="ao-field">
                <label htmlFor="f-sku">
                  Amazon SKU <span className="ao-req">*</span>
                </label>
                <input
                  ref={skuRef}
                  id="f-sku"
                  type="text"
                  className="ao-input"
                  placeholder="e.g. CK-HDMI-4K"
                  value={sku}
                  onChange={(e) => setSku(e.target.value)}
                  required
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
              <div className="ao-field">
                <label htmlFor="f-date">
                  Order Date <span className="ao-req">*</span>
                </label>
                <input
                  id="f-date"
                  type="datetime-local"
                  className="ao-input"
                  value={orderDate}
                  onChange={(e) => setOrderDate(e.target.value)}
                  required
                />
              </div>
            </div>

            {insertMsg ? (
              <div
                className={`ao-alert ${insertMsg.ok ? "ao-alert-success" : "ao-alert-error"}`}
              >
                <i
                  className={`fas ${insertMsg.ok ? "fa-check-circle" : "fa-times-circle"}`}
                />
                {insertMsg.text}
              </div>
            ) : null}

            <button
              type="submit"
              className="ao-btn ao-btn-success"
              disabled={inserting}
            >
              {inserting ? (
                <>
                  <span className="ao-spinner" />
                  Inserting…
                </>
              ) : (
                <>
                  <i className="fas fa-check" />
                  Confirm &amp; Insert Order
                </>
              )}
            </button>

            <div className="ao-form-back">
              <button
                type="button"
                className="ao-btn ao-btn-ghost"
                onClick={() => {
                  setInsertMsg(null);
                  setView("not_found");
                }}
              >
                ← Back to search
              </button>
            </div>
          </form>
        </section>
      ) : null}

      {view === "idle" && !searching && !status ? (
        <section className="ao-idle">
          <i className="fab fa-amazon ao-idle-icon" aria-hidden />
          <p>
            Enter an Amazon Order ID above to check{" "}
            <code>amazon_order_details</code>. If missing, sync that day from
            BaseLinker (preferred) or use manual insert as a last resort.
          </p>
        </section>
      ) : null}
    </div>
  );
}
