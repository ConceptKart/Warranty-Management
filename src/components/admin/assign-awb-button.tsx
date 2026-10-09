"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

const INDIAN_STATES = [
  "Andhra Pradesh",
  "Arunachal Pradesh",
  "Assam",
  "Bihar",
  "Chhattisgarh",
  "Delhi",
  "Goa",
  "Gujarat",
  "Haryana",
  "Himachal Pradesh",
  "Jharkhand",
  "Karnataka",
  "Kerala",
  "Madhya Pradesh",
  "Maharashtra",
  "Manipur",
  "Meghalaya",
  "Mizoram",
  "Nagaland",
  "Odisha",
  "Punjab",
  "Rajasthan",
  "Sikkim",
  "Tamil Nadu",
  "Telangana",
  "Tripura",
  "Uttar Pradesh",
  "Uttarakhand",
  "West Bengal",
];

type Mode = "return" | "forward" | "manual";

type AwbSuccess = {
  message: string;
  awb_number?: string;
  courier_name?: string;
  rma_no?: string;
  shipping_url?: string;
  email_sent?: boolean;
  email_error?: string;
};

type AwbErrorExtra = {
  awb_number?: string;
  courier_name?: string;
  shipping_url?: string;
};

export function AssignAwbButton({
  ticketId,
  hasAnyAwb,
  defaultAddress = "",
}: {
  ticketId: number;
  hasAnyAwb: boolean;
  defaultAddress?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("return");
  const [manualType, setManualType] = useState<"forward" | "reverse">("forward");
  const [awb, setAwb] = useState("");
  const [courier, setCourier] = useState("");
  const [address, setAddress] = useState(defaultAddress);
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [zipcode, setZipcode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [errorExtra, setErrorExtra] = useState<AwbErrorExtra | null>(null);
  const [success, setSuccess] = useState<AwbSuccess | null>(null);

  const isManual = mode === "manual";
  const submitLabel = useMemo(() => {
    if (loading) {
      if (mode === "return") return "Creating Return Shipment on Shipway…";
      if (mode === "forward") return "Creating Forward Shipment on Shipway…";
      return "Assigning AWB…";
    }
    if (mode === "return") return "Create Return Shipment";
    if (mode === "forward") return "Create Forward Shipment";
    return "Assign AWB";
  }, [loading, mode]);

  function resetFormFields() {
    setAwb("");
    setCourier("");
    setCity("");
    setState("");
    setZipcode("");
    setError("");
    setErrorExtra(null);
    setSuccess(null);
    setMode("return");
    setManualType("forward");
  }

  function closeModal() {
    setOpen(false);
    resetFormFields();
  }

  function doneAndReload() {
    setOpen(false);
    resetFormFields();
    router.refresh();
  }

  // Match PHP: auto-reload ~3s after success (user can still click Print Label first)
  useEffect(() => {
    if (!success) return;
    const timer = window.setTimeout(() => {
      doneAndReload();
    }, 3000);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when success appears
  }, [success]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    setErrorExtra(null);
    setSuccess(null);
    try {
      const payload =
        mode === "manual"
          ? {
              ticket_id: ticketId,
              shipment_mode:
                manualType === "reverse" ? "manual_reverse" : "manual_forward",
              awb_number: awb,
              courier_partner: courier,
            }
          : {
              ticket_id: ticketId,
              shipment_mode: mode,
              customer_address: address,
              customer_city: city,
              customer_state: state,
              customer_zipcode: zipcode,
            };

      const res = await fetch("/api/admin/tickets/awb", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as AwbSuccess &
        AwbErrorExtra & {
          success?: boolean;
          error?: string;
        };

      if (!data.success) {
        setError(data.error ?? "Failed to process AWB request");
        if (data.awb_number) {
          setErrorExtra({
            awb_number: data.awb_number,
            courier_name: data.courier_name,
            shipping_url: data.shipping_url,
          });
        }
        return;
      }

      setSuccess({
        message: data.message || "Success",
        awb_number: data.awb_number,
        courier_name: data.courier_name,
        rma_no: data.rma_no,
        shipping_url: data.shipping_url,
        email_sent: data.email_sent,
        email_error: data.email_error,
      });
    } catch {
      setError("Failed to process AWB request");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="btn btn-sm btn-primary"
        onClick={() => {
          resetFormFields();
          setAddress(defaultAddress);
          setOpen(true);
        }}
      >
        <i className="fas fa-plus me-1" />
        {hasAnyAwb ? "Add AWB" : "Assign AWB"}
      </button>

      {open ? (
        <div
          className="modal fade show d-block"
          tabIndex={-1}
          role="dialog"
          style={{ backgroundColor: "rgba(0,0,0,.5)" }}
          onClick={() => {
            if (!success) closeModal();
          }}
        >
          <div
            className="modal-dialog modal-dialog-centered modal-lg modal-dialog-scrollable"
            role="document"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">
                  <i className="fas fa-shipping-fast me-2" />
                  {success
                    ? "Shipment Created"
                    : "Create Shipment / Assign AWB"}
                </h5>
                <button
                  type="button"
                  className="btn-close"
                  aria-label="Close"
                  onClick={() => (success ? doneAndReload() : closeModal())}
                />
              </div>

              {success ? (
                <>
                  <div className="modal-body">
                    <div className="alert alert-success mb-3">
                      <i className="fas fa-check-circle me-2" />
                      <strong>Success!</strong>
                      <br />
                      {success.message}
                    </div>

                    {success.awb_number ? (
                      <div className="card border-success">
                        <div className="card-body">
                          <h6 className="card-title text-success">
                            <i className="fas fa-shipping-fast me-2" />
                            Shipment Details
                          </h6>
                          <table className="table table-sm mb-0">
                            <tbody>
                              <tr>
                                <td className="fw-bold" style={{ width: 140 }}>
                                  AWB Number:
                                </td>
                                <td>
                                  <span className="badge bg-primary fs-6">
                                    {success.awb_number}
                                  </span>
                                </td>
                              </tr>
                              {success.courier_name ? (
                                <tr>
                                  <td className="fw-bold">Courier:</td>
                                  <td>
                                    <span className="badge bg-info text-dark">
                                      {success.courier_name}
                                    </span>
                                  </td>
                                </tr>
                              ) : null}
                              {success.rma_no ? (
                                <tr>
                                  <td className="fw-bold">RMA No:</td>
                                  <td>
                                    <code>{success.rma_no}</code>
                                  </td>
                                </tr>
                              ) : null}
                              {success.shipping_url ? (
                                <tr>
                                  <td className="fw-bold">Shipping Label:</td>
                                  <td>
                                    <a
                                      href={success.shipping_url}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="btn btn-sm btn-outline-danger"
                                    >
                                      <i className="fas fa-print me-1" />
                                      Print Label (PDF)
                                    </a>
                                  </td>
                                </tr>
                              ) : null}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    ) : null}

                    {success.email_sent ? (
                      <div className="alert alert-info mt-2 mb-0 py-2">
                        <i className="fas fa-envelope me-1" />
                        Email notification sent to customer.
                      </div>
                    ) : null}
                    {success.email_error ? (
                      <div className="alert alert-warning mt-2 mb-0 py-2">
                        <i className="fas fa-exclamation-triangle me-1" />
                        Email could not be sent: {success.email_error}
                      </div>
                    ) : null}
                  </div>
                  <div className="modal-footer">
                    <button
                      type="button"
                      className="btn btn-success"
                      onClick={doneAndReload}
                    >
                      <i className="fas fa-check me-1" />
                      Done - Reload Page
                    </button>
                  </div>
                </>
              ) : (
                <form onSubmit={onSubmit}>
                  <div className="modal-body">
                    <div className="mb-3">
                      <label className="form-label fw-bold">Shipment Type</label>
                      <div className="d-flex flex-wrap gap-3">
                        <div className="form-check">
                          <input
                            className="form-check-input"
                            type="radio"
                            id="modeReturn"
                            checked={mode === "return"}
                            onChange={() => setMode("return")}
                          />
                          <label
                            className="form-check-label"
                            htmlFor="modeReturn"
                          >
                            <strong>Return Shipment</strong>
                            <small className="text-muted d-block">
                              Customer → Office (Shipway)
                            </small>
                          </label>
                        </div>
                        <div className="form-check">
                          <input
                            className="form-check-input"
                            type="radio"
                            id="modeForward"
                            checked={mode === "forward"}
                            onChange={() => setMode("forward")}
                          />
                          <label
                            className="form-check-label"
                            htmlFor="modeForward"
                          >
                            <strong>Forward Shipment</strong>
                            <small className="text-muted d-block">
                              Office → Customer (Shipway)
                            </small>
                          </label>
                        </div>
                        <div className="form-check">
                          <input
                            className="form-check-input"
                            type="radio"
                            id="modeManual"
                            checked={mode === "manual"}
                            onChange={() => setMode("manual")}
                          />
                          <label
                            className="form-check-label"
                            htmlFor="modeManual"
                          >
                            <strong>Manual AWB</strong>
                            <small className="text-muted d-block">
                              Enter AWB directly
                            </small>
                          </label>
                        </div>
                      </div>
                    </div>

                    <hr />

                    {!isManual ? (
                      <>
                        <div
                          className={`alert ${mode === "return" ? "alert-warning" : "alert-success"} mb-3`}
                        >
                          {mode === "return"
                            ? "A reverse pickup will be created on Shipway from the customer address."
                            : "A forward delivery will be created on Shipway to the customer address."}
                        </div>
                        <div className="mb-3">
                          <label className="form-label">
                            Address <span className="text-danger">*</span>
                          </label>
                          <textarea
                            className="form-control"
                            rows={2}
                            required
                            value={address}
                            onChange={(e) => setAddress(e.target.value)}
                          />
                        </div>
                        <div className="row">
                          <div className="col-md-4 mb-3">
                            <label className="form-label">
                              City <span className="text-danger">*</span>
                            </label>
                            <input
                              className="form-control"
                              required
                              value={city}
                              onChange={(e) => setCity(e.target.value)}
                            />
                          </div>
                          <div className="col-md-4 mb-3">
                            <label className="form-label">
                              State <span className="text-danger">*</span>
                            </label>
                            <select
                              className="form-select"
                              required
                              value={state}
                              onChange={(e) => setState(e.target.value)}
                            >
                              <option value="">Select State</option>
                              {INDIAN_STATES.map((s) => (
                                <option key={s} value={s}>
                                  {s}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="col-md-4 mb-3">
                            <label className="form-label">
                              Pincode <span className="text-danger">*</span>
                            </label>
                            <input
                              className="form-control"
                              required
                              maxLength={6}
                              value={zipcode}
                              onChange={(e) =>
                                setZipcode(
                                  e.target.value.replace(/\D/g, "").slice(0, 6),
                                )
                              }
                            />
                          </div>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="mb-3">
                          <label className="form-label">Manual Type</label>
                          <select
                            className="form-select"
                            value={manualType}
                            onChange={(e) =>
                              setManualType(
                                e.target.value === "reverse"
                                  ? "reverse"
                                  : "forward",
                              )
                            }
                          >
                            <option value="forward">Forward AWB</option>
                            <option value="reverse">Return AWB</option>
                          </select>
                        </div>
                        <div className="mb-3">
                          <label className="form-label">
                            AWB Number <span className="text-danger">*</span>
                          </label>
                          <input
                            className="form-control"
                            required
                            value={awb}
                            onChange={(e) => setAwb(e.target.value)}
                          />
                        </div>
                        <div className="mb-1">
                          <label className="form-label">
                            Courier Partner{" "}
                            <span className="text-danger">*</span>
                          </label>
                          <input
                            className="form-control"
                            required
                            value={courier}
                            onChange={(e) => setCourier(e.target.value)}
                          />
                        </div>
                      </>
                    )}

                    {error ? (
                      <div className="alert alert-danger mt-3 mb-0">
                        <i className="fas fa-exclamation-triangle me-2" />
                        <strong>AWB Assignment Failed</strong>
                        <br />
                        {error}
                        {errorExtra?.awb_number ? (
                          <div className="mt-2 p-2 bg-light rounded border">
                            <strong>AWB created on Shipway:</strong>{" "}
                            <code>{errorExtra.awb_number}</code>
                            {errorExtra.courier_name
                              ? ` — ${errorExtra.courier_name}`
                              : ""}
                            {errorExtra.shipping_url ? (
                              <>
                                <br />
                                <a
                                  href={errorExtra.shipping_url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="btn btn-sm btn-outline-danger mt-1"
                                >
                                  <i className="fas fa-print me-1" />
                                  Print Label
                                </a>
                              </>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                  <div className="modal-footer">
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={closeModal}
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="btn btn-primary"
                      disabled={loading}
                    >
                      {loading ? (
                        <>
                          <i className="fas fa-spinner fa-spin me-1" />
                          {submitLabel}
                        </>
                      ) : (
                        submitLabel
                      )}
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
