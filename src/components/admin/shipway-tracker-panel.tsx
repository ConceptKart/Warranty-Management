"use client";

import { FormEvent, useState } from "react";

type TrackResult = {
  number: string;
  type: "awb" | "rma" | "invalid";
  timestamp: string;
  found: boolean;
  status: string;
  order_id?: string | null;
  courier?: string | null;
  source?: string;
  error?: string;
  validation_error?: boolean;
  endpoints_tested: Array<{
    endpoint: string;
    params: Record<string, string>;
    http_code: number;
    success: boolean;
    found_exact_match?: boolean;
    extracted_status?: string;
  }>;
};

export function ShipwayTrackerPanel() {
  const [number, setNumber] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TrackResult | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const q = number.trim();
    if (!q) {
      setError("Please enter an AWB or RMA number.");
      setResult(null);
      return;
    }

    setBusy(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch("/api/admin/shipway-tracker", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ number: q }),
      });
      const data = (await res.json()) as TrackResult & { error?: string };
      if (!res.ok && data.error) {
        setError(data.error);
        return;
      }
      if (data.validation_error || data.error) {
        setError(data.error ?? "Invalid input");
      }
      setResult(data);
    } catch {
      setError("Request failed. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="st-page">
      <div className="st-header">
        <div className="st-logo" aria-hidden>
          <i className="fas fa-search-location" />
        </div>
        <div>
          <h1 className="st-title">Shipway Tracker</h1>
          <p className="st-subtitle">
            Look up live AWB or RMA status from Shipway
          </p>
        </div>
      </div>

      <section className={`st-search-wrap${busy ? " is-busy" : ""}`}>
        <form className="st-search-row" onSubmit={(e) => void onSubmit(e)}>
          <div className="st-field">
            <label htmlFor="st-number">AWB or RMA number</label>
            <input
              id="st-number"
              className="st-input"
              type="text"
              value={number}
              onChange={(e) => setNumber(e.target.value)}
              placeholder="e.g. 123456789012 or 628408.CK143057-E"
              autoComplete="off"
              spellCheck={false}
              disabled={busy}
            />
          </div>
          <button type="submit" className="st-btn" disabled={busy}>
            {busy ? (
              <>
                <span className="st-spinner" />
                Tracking…
              </>
            ) : (
              <>
                <i className="fas fa-search" />
                Track
              </>
            )}
          </button>
        </form>
        <p className="st-hint">
          AWB: digits (e.g. <code>90592796383</code>) · RMA:{" "}
          <code>number.CODE-LETTER</code>
        </p>
      </section>

      {error ? (
        <div className="st-alert st-alert-error">
          <i className="fas fa-times-circle" />
          {error}
        </div>
      ) : null}

      {result && !result.validation_error ? (
        <section className="st-result">
          <div className="st-result-top">
            <div>
              <div className="st-label">Number</div>
              <div className="st-value">
                <code>{result.number}</code>
                <span className="st-type">{result.type.toUpperCase()}</span>
              </div>
            </div>
            <div>
              <div className="st-label">Status</div>
              <div
                className={`st-status ${result.found ? "is-found" : "is-miss"}`}
              >
                {result.status}
              </div>
            </div>
            <div>
              <div className="st-label">Checked (IST)</div>
              <div className="st-value">{result.timestamp}</div>
            </div>
            {result.order_id ? (
              <div>
                <div className="st-label">Order / ticket</div>
                <div className="st-value">{result.order_id}</div>
              </div>
            ) : null}
            {result.courier ? (
              <div>
                <div className="st-label">Courier</div>
                <div className="st-value">{result.courier}</div>
              </div>
            ) : null}
            {result.source ? (
              <div>
                <div className="st-label">Source</div>
                <div className="st-value">{result.source}</div>
              </div>
            ) : null}
          </div>

          {result.endpoints_tested.length > 0 ? (
            <details className="st-endpoints">
              <summary>
                Endpoints tested ({result.endpoints_tested.length})
              </summary>
              <ul>
                {result.endpoints_tested.map((ep, idx) => (
                  <li key={`${ep.endpoint}-${idx}`}>
                    <strong>{ep.endpoint}</strong>
                    <span className="st-muted">
                      {" "}
                      · HTTP {ep.http_code}
                      {ep.found_exact_match
                        ? ` · match → ${ep.extracted_status}`
                        : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
