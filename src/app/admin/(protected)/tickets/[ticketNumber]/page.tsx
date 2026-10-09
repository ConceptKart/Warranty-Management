import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getTicketDetails } from "@/lib/admin/ticket-details";
import { getFilterOptions } from "@/lib/admin/tickets";
import { PrioritySelect } from "@/components/admin/priority-select";
import { TicketActions } from "@/components/admin/ticket-actions";
import { EditCustomerButton } from "@/components/admin/edit-customer-button";
import { ShipmentTrackingCard } from "@/components/admin/shipment-tracking-card";
import { EmailLogCard } from "@/components/admin/email-log-card";
import { getSession } from "@/lib/auth/get-session";
import { hasPermission } from "@/lib/auth/permissions";

function formatIst(value: Date | string | null | undefined) {
  if (!value) return "N/A";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
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

function formatDateShort(value: Date | string | null | undefined) {
  if (!value) return "N/A";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  });
}

function resolveAttachmentUrl(remoteUrl: string | null, filePath: string) {
  const url = remoteUrl || filePath || "";
  if (!url) return "";
  if (/^https?:\/\//i.test(url)) return url;
  return url;
}

function parseSelectedProducts(
  json: string | null,
  fallbackName: string | null,
  fallbackSku: string | null,
) {
  if (json) {
    try {
      const decoded = JSON.parse(json);
      if (Array.isArray(decoded) && decoded.length > 0) return decoded;
    } catch {
      // fall through
    }
  }
  return [
    {
      name: fallbackName ?? "—",
      sku: fallbackSku ?? "—",
      quantity: 1,
    },
  ];
}

export default async function TicketDetailsPage({
  params,
}: {
  params: Promise<{ ticketNumber: string }>;
}) {
  const session = await getSession();
  if (!session.adminUser) redirect("/admin/login");
  const role = session.adminUser.role;
  const canManageStatuses = hasPermission(role, "manage_statuses");
  const canEditTickets = hasPermission(role, "edit_tickets");
  const canAddComments = hasPermission(role, "add_internal_comments");
  const canViewComments = hasPermission(role, "view_internal_comments");
  const canAssignAwb = hasPermission(role, "assign_awb");

  const { ticketNumber: raw } = await params;
  const ticketNumber = decodeURIComponent(raw);
  const [ticket, options] = await Promise.all([
    getTicketDetails(ticketNumber),
    getFilterOptions(),
  ]);

  if (!ticket) notFound();

  const selectedProducts = parseSelectedProducts(
    ticket.selected_products_json,
    ticket.product_name,
    ticket.product_sku,
  );

  return (
    <>
      <nav aria-label="breadcrumb" className="mb-4">
        <ol className="breadcrumb">
          <li className="breadcrumb-item">
            <Link href="/admin">Dashboard</Link>
          </li>
          <li className="breadcrumb-item">
            <Link href="/admin/tickets">Tickets</Link>
          </li>
          <li className="breadcrumb-item active">{ticket.ticket_number}</li>
        </ol>
      </nav>

      <div className="card shadow mb-4">
        <div className="card-body">
          <div className="admin-page-header mb-0">
            <div className="min-w-0">
              <h4 className="mb-2 text-break">
                Ticket {ticket.ticket_number}
              </h4>
              <div className="d-flex flex-wrap align-items-center gap-2 mb-2">
                <span className="badge bg-info text-dark">
                  {ticket.ticket_type}
                </span>
                <span
                  className="badge"
                  style={{ backgroundColor: ticket.status_color || "#6c757d" }}
                >
                  {ticket.status_name}
                </span>
                <PrioritySelect
                  ticketId={ticket.ticket_id}
                  currentPriority={ticket.priority}
                />
              </div>
              <p className="text-muted small mb-0">
                Created: {formatIst(ticket.created_at)}
                {ticket.updated_at &&
                String(ticket.updated_at) !== String(ticket.created_at)
                  ? ` | Updated: ${formatIst(ticket.updated_at)}`
                  : ""}
              </p>
            </div>
            <TicketActions
              ticketId={Number(ticket.ticket_id)}
              ticketNumber={ticket.ticket_number}
              baselinkerOrderId={ticket.baselinker_order_id || ""}
              currentStatusId={Number(ticket.status_id)}
              statuses={ticket.available_statuses.map((s) => ({
                status_id: Number(s.status_id),
                status_name: s.status_name,
                status_code: s.status_code,
              }))}
              customerEmail={ticket.customer_email || ""}
              ticketTypeId={Number(ticket.ticket_type_id)}
              ticketTypeName={ticket.ticket_type || ""}
              ticketTypes={options.ticket_types.map((t) => ({
                ticket_type_id: Number(t.ticket_type_id),
                type_name: t.type_name,
              }))}
              orderNumber={ticket.order_number || ""}
              canManageStatuses={canManageStatuses}
              canEditTickets={canEditTickets}
              canAddComments={canAddComments}
            />
          </div>
        </div>
      </div>

      <div className="row">
        <div className="col-lg-8">
          <Card title="Issue Details" icon="fas fa-exclamation-circle">
            <Row label="Issue Type" value={ticket.issue_name} />
            <div className="detail-row">
              <div className="detail-label">Description:</div>
              <div className="detail-value">
                <div className="border rounded bg-light p-3 text-break whitespace-pre-wrap">
                  {ticket.customer_description}
                </div>
              </div>
            </div>
            {ticket.source_device ? (
              <Row label="Source Device" value={ticket.source_device} />
            ) : null}
            {ticket.internal_notes ? (
              <div className="detail-row">
                <div className="detail-label">Internal Notes:</div>
                <div className="detail-value">
                  <div className="border border-warning rounded bg-warning-subtle p-3 text-break whitespace-pre-wrap">
                    {ticket.internal_notes}
                  </div>
                </div>
              </div>
            ) : null}
            {ticket.resolution_details ? (
              <div className="detail-row mb-0">
                <div className="detail-label">Resolution:</div>
                <div className="detail-value">
                  <div className="border border-success rounded bg-success-subtle p-3 text-break whitespace-pre-wrap">
                    {ticket.resolution_details}
                  </div>
                </div>
              </div>
            ) : null}
          </Card>

          {ticket.attachments.length > 0 ? (
            <Card
              title={`Attachments (${ticket.attachments.length})`}
              icon="fas fa-paperclip"
            >
              <div className="row g-3">
                {ticket.attachments.map((attachment) => {
                  const url = resolveAttachmentUrl(
                    attachment.remote_url,
                    attachment.file_path,
                  );
                  return (
                    <div
                      key={attachment.attachment_id}
                      className="col-md-6"
                    >
                      <div className="border rounded p-3">
                        <div className="fw-semibold">
                          {attachment.original_filename}
                        </div>
                        <div className="small text-muted">
                          {attachment.file_type} ·{" "}
                          {Math.round(attachment.file_size / 1024)} KB
                        </div>
                        {url ? (
                          <a
                            href={url}
                            target="_blank"
                            rel="noreferrer"
                            className="btn btn-sm btn-outline-primary mt-2"
                          >
                            <i className="fas fa-external-link-alt me-1" />
                            Open
                          </a>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          ) : null}

          {canViewComments ? (
            <Card title="Comments & Communication" icon="fas fa-comments">
              {ticket.comments.length === 0 ? (
                <p className="text-muted mb-0">No comments yet.</p>
              ) : (
                <div className="d-flex flex-column gap-3">
                  {ticket.comments.map((comment) => (
                    <div key={comment.comment_id} className="border rounded p-3">
                      <div className="d-flex flex-wrap align-items-center gap-2 small text-muted mb-1">
                        <strong className="text-dark">{comment.author_name}</strong>
                        <span>{formatIst(comment.created_at)}</span>
                        {comment.is_internal ? (
                          <span className="badge bg-warning text-dark">
                            Internal
                          </span>
                        ) : (
                          <span className="badge bg-info text-dark">
                            Customer Visible
                          </span>
                        )}
                      </div>
                      <p className="mb-0 whitespace-pre-wrap">
                        {comment.comment_text}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          ) : null}

          <Card title="Status History" icon="fas fa-history">
            {ticket.status_history.length === 0 ? (
              <p className="text-center text-muted mb-0">
                No status changes recorded.
              </p>
            ) : (
              <div className="d-flex flex-column gap-3">
                {ticket.status_history.map((item) => (
                  <div key={item.history_id} className="border rounded p-3">
                    <div className="fw-semibold">
                      {item.old_status_name ?? "—"} → {item.new_status_name}
                    </div>
                    <div className="small text-muted">
                      {item.changed_by} · {formatIst(item.changed_at)}
                    </div>
                    {item.change_reason ? (
                      <div className="small mt-1">{item.change_reason}</div>
                    ) : null}
                    {item.notes ? (
                      <div className="small mt-1">{item.notes}</div>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </Card>

          <EmailLogCard
            logs={ticket.email_logs.map((log) => ({
              log_id: log.log_id,
              recipient_email: log.recipient_email,
              subject: log.subject || "",
              status_code: log.status_code || "",
              sent: Boolean(log.sent),
              error_message: log.error_message,
              body_html: log.body_html,
              sent_at_label: formatIst(log.sent_at),
            }))}
          />
        </div>

        <div className="col-lg-4">
          <Card
            title="Customer Information"
            icon="fas fa-user"
            headerAction={
              <EditCustomerButton
                ticketId={ticket.ticket_id}
                customerName={
                  `${ticket.first_name ?? ""} ${ticket.last_name ?? ""}`.trim() ||
                  "N/A"
                }
                customerEmail={ticket.customer_email || ""}
                phone={ticket.phone || ""}
                address={ticket.address || ""}
              />
            }
          >
            <Row
              label="Name"
              value={
                `${ticket.first_name ?? ""} ${ticket.last_name ?? ""}`.trim() ||
                "N/A"
              }
            />
            <Row label="Email" value={ticket.customer_email || "N/A"} />
            <Row label="Phone" value={ticket.phone || "N/A"} />
            <div className="detail-row mb-0">
              <div className="detail-label">Address:</div>
              <div className="detail-value whitespace-pre-wrap">
                {ticket.address || "N/A"}
              </div>
            </div>
          </Card>

          <Card title="Order Information" icon="fas fa-shopping-cart">
            <Row label="Order #" value={ticket.order_number} />
            <Row label="Platform" value={ticket.source_platform} />
            <Row label="Order Date" value={formatDateShort(ticket.order_date)} />
            {ticket.delivery_date ? (
              <Row
                label="Delivered"
                value={formatDateShort(ticket.delivery_date)}
              />
            ) : null}
            <Row label="Status" value={ticket.order_status} />
          </Card>

          <Card title="Product Information" icon="fas fa-box">
            {selectedProducts.length === 1 ? (
              <>
                <Row label="Name" value={selectedProducts[0].name ?? "—"} />
                <Row label="SKU" value={selectedProducts[0].sku ?? "—"} />
                {Number(selectedProducts[0].quantity ?? 1) > 1 ? (
                  <Row
                    label="Quantity"
                    value={String(selectedProducts[0].quantity)}
                  />
                ) : null}
              </>
            ) : (
              <div className="table-responsive">
                <table className="table table-sm mb-0">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Product Name</th>
                      <th>SKU</th>
                      <th className="text-center">Qty</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedProducts.map((sp, i) => (
                      <tr key={i}>
                        <td>{i + 1}</td>
                        <td>{sp.name ?? "—"}</td>
                        <td>
                          <code className="small">{sp.sku ?? "—"}</code>
                        </td>
                        <td className="text-center">
                          {Number(sp.quantity ?? 1)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {ticket.replacement_ean ? (
              <div className="border-top pt-3 mt-3">
                <div className="fw-semibold text-success mb-1">
                  Replacement Unit Assigned
                </div>
                <div className="row g-2 small">
                  <div className="col-4">
                    <div className="text-muted">EAN</div>
                    <code>{ticket.replacement_ean}</code>
                  </div>
                  {ticket.replacement_location ? (
                    <div className="col-4">
                      <div className="text-muted">Location</div>
                      <div style={{ fontFamily: "monospace" }}>
                        {ticket.replacement_location}
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}
          </Card>

          {ticket.previous_claims.length > 0 ? (
            <div className="card shadow mb-4">
              <div className="card-header">
                <span>
                  <i className="fas fa-history me-2" />
                  Previous Claims for This Order
                </span>
              </div>
              <div className="card-body p-0">
                <ul className="list-group list-group-flush">
                  {ticket.previous_claims.map((pc) => (
                    <li
                      key={Number(pc.ticket_id)}
                      className="list-group-item"
                    >
                      <div className="d-flex justify-content-between align-items-start gap-2 mb-2">
                        <code className="small">{pc.ticket_number}</code>
                        <Link
                          href={`/admin/tickets/${encodeURIComponent(pc.ticket_number)}`}
                          className="btn btn-sm btn-outline-secondary flex-shrink-0"
                        >
                          View
                        </Link>
                      </div>
                      <div className="d-flex flex-wrap align-items-center gap-2 small">
                        <span className="text-muted">
                          {pc.type_name ?? "—"}
                        </span>
                        <span
                          className="badge"
                          style={{
                            backgroundColor: pc.status_color ?? "#6c757d",
                            color: "#fff",
                          }}
                        >
                          {pc.status_name ?? "—"}
                        </span>
                        <span className="text-muted ms-auto">
                          {formatDateShort(pc.created_at)}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ) : null}

          <ShipmentTrackingCard
            ticketId={ticket.ticket_id}
            forwardAwb={ticket.tracking.forward_awb}
            reverseAwb={ticket.tracking.reverse_awb}
            courierPartner={ticket.courier_partner}
            initialForward={ticket.tracking.forward}
            initialReverse={ticket.tracking.reverse}
            customerAddress={ticket.address || ""}
            canAssignAwb={canAssignAwb}
          />
        </div>
      </div>
    </>
  );
}

function Card({
  title,
  icon,
  headerAction,
  children,
}: {
  title: string;
  icon?: string;
  headerAction?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="card shadow mb-4">
      <div className="card-header d-flex justify-content-between align-items-center">
        <span>
          {icon ? <i className={`${icon} me-2`} /> : null}
          {title}
        </span>
        {headerAction}
      </div>
      <div className="card-body">{children}</div>
    </div>
  );
}

function Row({
  label,
  value,
}: {
  label: string;
  value: string | null | undefined;
}) {
  return (
    <div className="detail-row">
      <div className="detail-label">{label}:</div>
      <div className="detail-value">{value || "N/A"}</div>
    </div>
  );
}
