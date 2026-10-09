"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ReplacementEanModal } from "@/components/admin/replacement-ean-modal";

type StatusOption = {
  status_id: number;
  status_name: string;
  status_code: string;
};

type TicketTypeOption = {
  ticket_type_id: number;
  type_name: string;
};

export function TicketActions({
  ticketId,
  ticketNumber,
  baselinkerOrderId,
  currentStatusId,
  statuses,
  customerEmail,
  ticketTypeId,
  ticketTypeName,
  ticketTypes,
  orderNumber,
  canManageStatuses = true,
  canEditTickets = true,
  canAddComments = true,
}: {
  ticketId: number;
  ticketNumber: string;
  baselinkerOrderId: string;
  currentStatusId: number;
  statuses: StatusOption[];
  customerEmail: string;
  ticketTypeId: number;
  ticketTypeName: string;
  ticketTypes: TicketTypeOption[];
  orderNumber: string;
  canManageStatuses?: boolean;
  canEditTickets?: boolean;
  canAddComments?: boolean;
}) {
  const router = useRouter();
  const [statusOpen, setStatusOpen] = useState(false);
  const [commentOpen, setCommentOpen] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
  const [replacementOpen, setReplacementOpen] = useState(false);
  const [changeTypeOpen, setChangeTypeOpen] = useState(false);
  const [selectedTypeId, setSelectedTypeId] = useState<number | null>(null);
  const [changingType, setChangingType] = useState(false);
  const [statusId, setStatusId] = useState(String(currentStatusId));
  const [emailTemplate, setEmailTemplate] = useState("");
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [comment, setComment] = useState("");
  const [emailTo, setEmailTo] = useState(customerEmail);
  const [emailSubject, setEmailSubject] = useState(
    "Update on Your Warranty/Replacement Request from Concept Kart",
  );
  const [emailBody, setEmailBody] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const selectedCode = useMemo(() => {
    return (
      statuses.find((s) => String(s.status_id) === statusId)?.status_code ?? ""
    );
  }, [statusId, statuses]);

  const unitReplacedStatusId = useMemo(() => {
    return (
      statuses.find((s) => s.status_code === "unit_replaced")?.status_id ?? 0
    );
  }, [statuses]);

  const otherTypes = useMemo(() => {
    return ticketTypes.filter(
      (t) => Number(t.ticket_type_id) !== Number(ticketTypeId),
    );
  }, [ticketTypes, ticketTypeId]);

  async function submitChangeType() {
    if (!selectedTypeId) return;
    setChangingType(true);
    setError("");
    try {
      const res = await fetch("/api/admin/tickets/change-type", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticket_id: ticketId,
          new_type_id: selectedTypeId,
        }),
      });
      const data = await res.json();
      if (!data.success) {
        setError(data.error ?? "Failed to change ticket type");
        return;
      }
      setChangeTypeOpen(false);
      setSelectedTypeId(null);
      router.refresh();
    } finally {
      setChangingType(false);
    }
  }

  async function submitStatus(e: FormEvent) {
    e.preventDefault();

    if (selectedCode === "unit_replaced") {
      setStatusOpen(false);
      setReplacementOpen(true);
      return;
    }

    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/tickets/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticket_id: ticketId,
          status_id: Number(statusId),
          reason,
          notes,
        }),
      });
      const data = await res.json();
      if (!data.success) {
        setError(data.error ?? "Failed to update status");
        return;
      }

      let msg = "Status updated successfully.";
      if (selectedCode === "accepted") {
        const emailRes = await fetch("/api/admin/tickets/email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "accepted",
            ticket_id: ticketId,
            email_template: emailTemplate,
          }),
        });
        const emailData = await emailRes.json();
        if (emailData.sent) {
          const label =
            emailTemplate === "website_cable"
              ? "Website IEM/Cable"
              : emailTemplate === "amazon_cable"
                ? "Amazon IEM/Cable"
                : "Default";
          msg += `\n\nEmail notification sent to customer.\nTemplate: ${label}`;
        } else if (emailData.error) {
          msg += `\n\nEmail could not be sent: ${emailData.error}`;
        }

        if (data.shipway_return?.success && data.shipway_return.awb_number) {
          msg += `\n\nReturn shipment created. AWB: ${data.shipway_return.awb_number}`;
          if (data.shipway_return.courier_name) {
            msg += ` (${data.shipway_return.courier_name})`;
          }
        } else if (data.shipway_return?.error) {
          msg += `\n\nReturn shipment could not be created: ${data.shipway_return.error}`;
        } else if (data.shipway_return?.warning) {
          msg += `\n\n${data.shipway_return.warning}`;
        }
      } else if (data.email_sent) {
        msg += "\n\nEmail notification sent to customer.";
      } else if (data.email_error) {
        msg += `\n\nEmail notification could not be sent: ${data.email_error}`;
      }

      alert(msg);
      setStatusOpen(false);
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  async function submitComment(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/tickets/comment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticket_id: ticketId,
          comment_text: comment,
          is_internal: true,
        }),
      });
      const data = await res.json();
      if (!data.success) {
        setError(data.error ?? "Failed to add comment");
        return;
      }
      setComment("");
      setCommentOpen(false);
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  async function submitEmail(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/tickets/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "custom",
          ticket_id: ticketId,
          to_email: emailTo,
          subject: emailSubject,
          body: emailBody,
        }),
      });
      const data = await res.json();
      if (!data.success && !data.sent) {
        setError(data.error ?? "Failed to send email");
        return;
      }
      setEmailBody("");
      setEmailOpen(false);
      alert("Email sent successfully.");
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <div className="admin-page-actions">
        {canManageStatuses ? (
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setStatusOpen(true)}
          >
            <i className="fas fa-sync-alt me-1" />
            Update Status
          </button>
        ) : null}
        {canEditTickets ? (
          <button
            type="button"
            className="btn btn-warning"
            onClick={() => {
              setSelectedTypeId(null);
              setError("");
              setChangeTypeOpen(true);
            }}
          >
            <i className="fas fa-exchange-alt me-1" />
            Change Type
          </button>
        ) : null}
        {canAddComments ? (
          <button
            type="button"
            className="btn btn-success"
            onClick={() => setCommentOpen(true)}
          >
            <i className="fas fa-comment me-1" />
            Add Internal Comment
          </button>
        ) : null}
        <button
          type="button"
          className="btn btn-info text-white"
          onClick={() => {
            setEmailTo(customerEmail);
            setEmailOpen(true);
          }}
        >
          <i className="fas fa-envelope me-1" />
          Send Email
        </button>
      </div>

      {statusOpen ? (
        <BootstrapModal
          title="Update Status"
          onClose={() => setStatusOpen(false)}
        >
          <form onSubmit={submitStatus}>
            <div className="mb-3">
              <label className="form-label">Status</label>
              <select
                className="form-select"
                value={statusId}
                onChange={(e) => setStatusId(e.target.value)}
                required
              >
                {statuses.map((status) => (
                  <option key={status.status_id} value={status.status_id}>
                    {status.status_name}
                    {status.status_id === currentStatusId ? " (Current)" : ""}
                  </option>
                ))}
              </select>
            </div>

            {selectedCode === "accepted" ? (
              <div className="alert alert-light border mb-3">
                <p className="fw-semibold mb-2">Email Template</p>
                <p className="small text-muted mb-2">
                  Select the email template to send to the customer when the
                  ticket is accepted.
                </p>
                <div className="form-check mb-2">
                  <input
                    className="form-check-input"
                    type="radio"
                    name="email_template"
                    id="tpl_default"
                    checked={emailTemplate === ""}
                    onChange={() => setEmailTemplate("")}
                  />
                  <label className="form-check-label" htmlFor="tpl_default">
                    <strong>Default</strong>
                    <span className="d-block small text-muted">
                      Simple notification that pickup has been scheduled
                    </span>
                  </label>
                </div>
                <div className="form-check mb-2">
                  <input
                    className="form-check-input"
                    type="radio"
                    name="email_template"
                    id="tpl_website"
                    checked={emailTemplate === "website_cable"}
                    onChange={() => setEmailTemplate("website_cable")}
                  />
                  <label className="form-check-label" htmlFor="tpl_website">
                    <strong>Website — IEM/Cable</strong>
                    <span className="d-block small text-muted">
                      6-month cable warranty info + packaging video note
                    </span>
                  </label>
                </div>
                <div className="form-check">
                  <input
                    className="form-check-input"
                    type="radio"
                    name="email_template"
                    id="tpl_amazon"
                    checked={emailTemplate === "amazon_cable"}
                    onChange={() => setEmailTemplate("amazon_cable")}
                  />
                  <label className="form-check-label" htmlFor="tpl_amazon">
                    <strong>Amazon — IEM/Cable</strong>
                    <span className="d-block small text-muted">
                      No cable warranty for Amazon orders + packaging video note
                    </span>
                  </label>
                </div>
              </div>
            ) : null}

            <div className="mb-3">
              <label className="form-label">Reason</label>
              <input
                className="form-control"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </div>
            <div className="mb-3">
              <label className="form-label">Notes</label>
              <textarea
                className="form-control"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
              />
            </div>
            {error ? <div className="alert alert-danger py-2">{error}</div> : null}
            <div className="d-flex justify-content-end gap-2">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setStatusOpen(false)}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={loading}
              >
                {loading ? "Saving…" : "Update Status"}
              </button>
            </div>
          </form>
        </BootstrapModal>
      ) : null}

      {commentOpen ? (
        <BootstrapModal
          title="Add Internal Comment"
          onClose={() => setCommentOpen(false)}
        >
          <form onSubmit={submitComment}>
            <div className="mb-3">
              <label className="form-label">Comment</label>
              <textarea
                className="form-control"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                rows={4}
                required
                placeholder="Enter your internal comment here..."
              />
            </div>
            {error ? <div className="alert alert-danger py-2">{error}</div> : null}
            <div className="d-flex justify-content-end gap-2">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setCommentOpen(false)}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn btn-success"
                disabled={loading}
              >
                {loading ? "Saving…" : "Add Comment"}
              </button>
            </div>
          </form>
        </BootstrapModal>
      ) : null}

      {emailOpen ? (
        <BootstrapModal
          title={
            <>
              <i className="fas fa-envelope me-2" />
              Send Custom Email
            </>
          }
          onClose={() => setEmailOpen(false)}
        >
          <form onSubmit={submitEmail}>
            <div className="mb-3">
              <label className="form-label">To</label>
              <input
                type="email"
                className="form-control"
                value={emailTo}
                onChange={(e) => setEmailTo(e.target.value)}
                required
              />
            </div>
            <div className="mb-3">
              <label className="form-label">Subject</label>
              <input
                type="text"
                className="form-control"
                value={emailSubject}
                onChange={(e) => setEmailSubject(e.target.value)}
                required
              />
            </div>
            <div className="mb-3">
              <label className="form-label">Message</label>
              <textarea
                className="form-control"
                value={emailBody}
                onChange={(e) => setEmailBody(e.target.value)}
                rows={7}
                required
              />
            </div>
            {error ? <div className="alert alert-danger py-2">{error}</div> : null}
            <div className="d-flex justify-content-end gap-2">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setEmailOpen(false)}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn btn-info text-white"
                disabled={loading}
              >
                {loading ? "Sending…" : "Send Email"}
              </button>
            </div>
          </form>
        </BootstrapModal>
      ) : null}

      {replacementOpen && unitReplacedStatusId ? (
        <ReplacementEanModal
          ticketId={ticketId}
          ticketNumber={ticketNumber}
          baselinkerOrderId={baselinkerOrderId}
          unitReplacedStatusId={unitReplacedStatusId}
          onClose={() => setReplacementOpen(false)}
        />
      ) : null}

      {changeTypeOpen ? (
        <BootstrapModal
          title="Change Order Type"
          onClose={() => setChangeTypeOpen(false)}
        >
          <p className="mb-2">
            Order: <strong>{orderNumber || ticketNumber}</strong>
          </p>
          <p className="mb-3">
            Current type:{" "}
            <span className="badge bg-secondary">{ticketTypeName}</span>
          </p>
          <div className="alert alert-warning py-2 mb-3 small">
            Changing the type resets status to the new type&apos;s initial
            status and updates the claim suffix (W↔R).
          </div>
          <div className="mb-3">
            <label className="form-label fw-semibold">Change to:</label>
            <div className="d-flex flex-wrap gap-2">
              {otherTypes.map((t) => (
                <button
                  key={t.ticket_type_id}
                  type="button"
                  className={`btn ${
                    selectedTypeId === Number(t.ticket_type_id)
                      ? "btn-primary"
                      : "btn-outline-primary"
                  }`}
                  onClick={() => setSelectedTypeId(Number(t.ticket_type_id))}
                >
                  {t.type_name}
                </button>
              ))}
            </div>
          </div>
          {error ? <div className="alert alert-danger py-2">{error}</div> : null}
          <div className="d-flex justify-content-end gap-2">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setChangeTypeOpen(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-warning"
              disabled={!selectedTypeId || changingType}
              onClick={() => void submitChangeType()}
            >
              {changingType ? "Changing…" : "Confirm Change"}
            </button>
          </div>
        </BootstrapModal>
      ) : null}
    </>
  );
}

function BootstrapModal({
  title,
  onClose,
  children,
}: {
  title: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="modal fade show d-block"
      tabIndex={-1}
      role="dialog"
      style={{ backgroundColor: "rgba(0,0,0,.5)" }}
      onClick={onClose}
    >
      <div
        className="modal-dialog modal-dialog-centered modal-dialog-scrollable"
        role="document"
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
