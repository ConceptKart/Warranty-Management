"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export function EditCustomerButton({
  ticketId,
  customerName,
  customerEmail,
  phone,
  address,
}: {
  ticketId: number;
  customerName: string;
  customerEmail: string;
  phone: string;
  address: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [phoneValue, setPhoneValue] = useState(phone);
  const [addressValue, setAddressValue] = useState(address);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/tickets/customer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticket_id: ticketId,
          phone: phoneValue,
          address: addressValue,
        }),
      });
      const data = await res.json();
      if (!data.success) {
        setError(data.error ?? "Failed to update customer");
        return;
      }
      setOpen(false);
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="btn btn-sm btn-outline-primary"
        onClick={() => {
          setPhoneValue(phone);
          setAddressValue(address);
          setOpen(true);
        }}
      >
        <i className="fas fa-edit me-1" />
        Edit
      </button>

      {open ? (
        <div
          className="modal fade show d-block"
          tabIndex={-1}
          role="dialog"
          style={{ backgroundColor: "rgba(0,0,0,.5)" }}
          onClick={() => setOpen(false)}
        >
          <div
            className="modal-dialog modal-dialog-centered"
            role="document"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">
                  <i className="fas fa-user-edit me-2" />
                  Edit Customer Information
                </h5>
                <button
                  type="button"
                  className="btn-close"
                  aria-label="Close"
                  onClick={() => setOpen(false)}
                />
              </div>
              <form onSubmit={onSubmit}>
                <div className="modal-body">
                  <div className="mb-3">
                    <label className="form-label">Name</label>
                    <input
                      type="text"
                      className="form-control"
                      value={customerName}
                      disabled
                    />
                    <div className="form-text">
                      Name cannot be changed here. Edit in Baselinker if needed.
                    </div>
                  </div>
                  <div className="mb-3">
                    <label className="form-label">Email</label>
                    <input
                      type="email"
                      className="form-control"
                      value={customerEmail}
                      disabled
                    />
                    <div className="form-text">
                      Email cannot be changed here. Edit in Baselinker if needed.
                    </div>
                  </div>
                  <div className="mb-3">
                    <label className="form-label" htmlFor="edit_phone">
                      Phone <span className="text-danger">*</span>
                    </label>
                    <input
                      type="tel"
                      className="form-control"
                      id="edit_phone"
                      value={phoneValue}
                      onChange={(e) => setPhoneValue(e.target.value)}
                      required
                    />
                  </div>
                  <div className="mb-3">
                    <label className="form-label" htmlFor="edit_address">
                      Address <span className="text-danger">*</span>
                    </label>
                    <textarea
                      className="form-control"
                      id="edit_address"
                      rows={3}
                      value={addressValue}
                      onChange={(e) => setAddressValue(e.target.value)}
                      required
                    />
                  </div>
                  {error ? (
                    <div className="alert alert-danger py-2">{error}</div>
                  ) : null}
                </div>
                <div className="modal-footer">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => setOpen(false)}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="btn btn-primary"
                    disabled={loading}
                  >
                    {loading ? "Saving…" : "Save Changes"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
