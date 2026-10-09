import Link from "next/link";
import { PortalShell } from "@/components/portal/portal-shell";
import { getTicketForTracking } from "@/lib/portal/track-ticket";

function formatDate(value: Date | null) {
  if (!value) return "—";
  // Match PHP: date('M d, Y H:i', ...)
  const d = new Date(value);
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const day = String(d.getDate()).padStart(2, "0");
  const mon = months[d.getMonth()];
  const year = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${mon} ${day}, ${year} ${hh}:${mm}`;
}

export default async function TrackTicketPage({
  searchParams,
}: {
  searchParams: Promise<{ ticket_number?: string }>;
}) {
  const sp = await searchParams;
  const ticketNumber = (sp.ticket_number ?? "").trim();
  const ticket = ticketNumber
    ? await getTicketForTracking(ticketNumber)
    : null;
  const trackingError =
    ticketNumber && !ticket
      ? "Ticket not found. Please check your ticket number and try again."
      : "";

  return (
    <PortalShell activeStep="track">
      <div className="card">
        {ticket ? (
          <>
            <h2>Ticket Status</h2>
            <div className="ticket-number">
              <span className="label">Ticket Number:</span>
              <span className="value">{ticket.ticket_number}</span>
            </div>
            <div className="info-grid">
              <div className="info-item">
                <span className="label">Product:</span>
                <span className="value">{ticket.product_name ?? "N/A"}</span>
              </div>
              <div className="info-item">
                <span className="label">Current Status:</span>
                <span className="value">
                  {ticket.status_name ?? "Pending"}
                  {ticket.status_source === "live_baselinker" ? (
                    <small className="status-live-note">
                      Updated in real-time from BaseLinker
                    </small>
                  ) : null}
                </span>
              </div>
              <div className="info-item">
                <span className="label">Created:</span>
                <span className="value">{formatDate(ticket.created_at)}</span>
              </div>
              <div className="info-item">
                <span className="label">Last Updated:</span>
                <span className="value">
                  {formatDate(ticket.updated_at ?? ticket.created_at)}
                </span>
              </div>
            </div>

            {ticket.customer_description ? (
              <div className="description-section">
                <h3>Issue Description</h3>
                <p style={{ whiteSpace: "pre-wrap" }}>
                  {ticket.customer_description}
                </p>
              </div>
            ) : null}

            <div className="form-actions">
              <Link href="/" className="btn btn-primary">
                Submit New Claim
              </Link>
              <Link href="/track" className="btn btn-secondary">
                Track Another Ticket
              </Link>
            </div>
          </>
        ) : (
          <>
            {trackingError ? (
              <div className="alert alert-error">
                <h3>Ticket Not Found</h3>
                <p>{trackingError}</p>
              </div>
            ) : (
              <h2>Track Ticket</h2>
            )}
            <form method="GET" action="/track" className="form">
              <div className="form-group">
                <label htmlFor="ticket_number">Ticket Number *</label>
                <input
                  type="text"
                  id="ticket_number"
                  name="ticket_number"
                  defaultValue={ticketNumber}
                  placeholder="Enter your ticket number (e.g., WR2025050001)"
                  required
                />
                <small>You can find this in your confirmation email</small>
              </div>
              <button type="submit" className="btn btn-secondary">
                Track Ticket
              </button>
            </form>
            <div className="form-actions">
              <Link href="/track" className="btn btn-secondary">
                Try Again
              </Link>
              <Link href="/" className="btn btn-primary">
                Submit New Claim
              </Link>
            </div>
          </>
        )}
      </div>
    </PortalShell>
  );
}
