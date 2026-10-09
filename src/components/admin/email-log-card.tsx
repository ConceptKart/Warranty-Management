"use client";

import { Fragment, useEffect, useState } from "react";

export type EmailLogRow = {
  log_id: number;
  recipient_email: string;
  subject: string;
  status_code: string;
  sent: boolean;
  error_message: string | null;
  body_html: string | null;
  sent_at_label: string;
};

/**
 * Port of public/admin/ticket-details.php Email Log + preview modal.
 */
export function EmailLogCard({ logs }: { logs: EmailLogRow[] }) {
  const [preview, setPreview] = useState<{
    subject: string;
    html: string;
  } | null>(null);

  useEffect(() => {
    if (!preview) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setPreview(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [preview]);

  return (
    <>
      <div className="card mb-4">
        <div className="card-header d-flex justify-content-between align-items-center">
          <h5 className="mb-0">
            <i className="fas fa-envelope me-2" />
            Email Log
          </h5>
          <span className="badge bg-secondary">{logs.length}</span>
        </div>
        <div className="card-body p-0">
          {logs.length === 0 ? (
            <p className="text-muted small mb-0 p-3">
              No emails sent for this ticket yet.
            </p>
          ) : (
            <div className="table-responsive">
              <table
                className="table table-sm table-hover mb-0"
                style={{ fontSize: "0.8rem" }}
              >
                <thead className="table-light">
                  <tr>
                    <th style={{ width: 36 }} />
                    <th>Trigger</th>
                    <th>Subject</th>
                    <th>Recipient</th>
                    <th>Sent At</th>
                    <th style={{ width: 52 }} />
                  </tr>
                </thead>
                <tbody>
                  {logs.map((el) => (
                    <Fragment key={el.log_id}>
                      <tr>
                        <td className="text-center">
                          {el.sent ? (
                            <i
                              className="fas fa-check-circle text-success"
                              title="Sent"
                            />
                          ) : (
                            <i
                              className="fas fa-times-circle text-danger"
                              title={el.error_message || "Failed"}
                            />
                          )}
                        </td>
                        <td>
                          <span className="badge bg-light text-dark border">
                            {el.status_code || "—"}
                          </span>
                        </td>
                        <td
                          className="text-truncate"
                          style={{ maxWidth: 180 }}
                          title={el.subject || undefined}
                        >
                          {el.subject || "—"}
                        </td>
                        <td
                          className="text-truncate"
                          style={{ maxWidth: 130 }}
                          title={el.recipient_email}
                        >
                          {el.recipient_email}
                        </td>
                        <td className="text-nowrap text-muted">
                          {el.sent_at_label}
                        </td>
                        <td className="text-center">
                          {el.body_html ? (
                            <button
                              type="button"
                              className="btn btn-outline-secondary btn-sm py-0 px-1"
                              title="Preview email"
                              onClick={() =>
                                setPreview({
                                  subject: el.subject || "Email Preview",
                                  html: el.body_html!,
                                })
                              }
                            >
                              <i
                                className="fas fa-eye"
                                style={{ fontSize: "0.75rem" }}
                              />
                            </button>
                          ) : null}
                        </td>
                      </tr>
                      {!el.sent && el.error_message ? (
                        <tr className="table-danger">
                          <td colSpan={6} className="py-1 px-3">
                            <small className="text-danger">
                              <i className="fas fa-exclamation-triangle me-1" />
                              {el.error_message}
                            </small>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {preview ? (
        <div
          className="modal fade show d-block"
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          aria-labelledby="emailPreviewModalLabel"
          style={{ background: "rgba(0,0,0,0.45)" }}
          onClick={() => setPreview(null)}
        >
          <div
            className="modal-dialog modal-xl modal-dialog-scrollable"
            role="document"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-content">
              <div className="modal-header py-2">
                <h6 className="modal-title mb-0" id="emailPreviewModalLabel">
                  <i className="fas fa-envelope me-2 text-muted" />
                  {preview.subject || "Email Preview"}
                </h6>
                <button
                  type="button"
                  className="btn-close"
                  aria-label="Close"
                  onClick={() => setPreview(null)}
                />
              </div>
              <div className="modal-body p-0">
                <iframe
                  title="Email preview"
                  srcDoc={preview.html}
                  sandbox="allow-same-origin"
                  style={{ width: "100%", height: 600, border: "none" }}
                />
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
