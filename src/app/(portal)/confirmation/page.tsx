import Link from "next/link";
import { redirect } from "next/navigation";
import { PortalShell } from "@/components/portal/portal-shell";
import { getPortalSession } from "@/lib/portal/get-session";
import { getTicketForTracking } from "@/lib/portal/track-ticket";

function formatSubmitted(value: Date | null) {
  if (!value) return "—";
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

export default async function ConfirmationPage() {
  const session = await getPortalSession();
  const ticketNumber = session.ticketNumber;
  if (!ticketNumber) {
    redirect("/");
  }

  const ticket = await getTicketForTracking(ticketNumber);

  return (
    <PortalShell activeStep="done">
      <div className="card">
        <div className="success-icon">✓</div>
        <h2>Claim Submitted Successfully!</h2>

        <div className="ticket-info">
          <h3>Your Ticket Details</h3>
          <div className="ticket-number">
            <span className="label">Ticket Number:</span>
            <span className="value">{ticketNumber}</span>
          </div>

          <div className="info-grid">
            <div className="info-item">
              <span className="label">Product:</span>
              <span className="value">{ticket?.product_name ?? "N/A"}</span>
            </div>
            <div className="info-item" style={{ display: "none" }}>
              <span className="label">Issue Type:</span>
              <span className="value">{ticket?.issue_name ?? "N/A"}</span>
            </div>
            <div className="info-item">
              <span className="label">Status:</span>
              <span className="value">
                {ticket?.status_name ?? "Pending"}
                {ticket?.status_source === "live_baselinker" ? (
                  <small className="status-live-note">
                    Updated in real-time from BaseLinker
                  </small>
                ) : null}
              </span>
            </div>
            <div className="info-item">
              <span className="label">Submitted:</span>
              <span className="value">
                {formatSubmitted(ticket?.created_at ?? null)}
              </span>
            </div>
          </div>
        </div>

        <div className="next-steps">
          <h3>What Happens Next?</h3>
          <ol>
            <li>Your warranty issue has been updated in our system</li>
            <li>Our team will review your claim within 24-48 hours</li>
            <li>You&apos;ll receive an email update about the status</li>
            <li>If approved, we&apos;ll provide further instructions</li>
            <li>Keep your ticket number for future reference</li>
          </ol>
        </div>

        <div className="form-actions">
          <Link href="/" className="btn btn-primary">
            Submit Another Claim
          </Link>
        </div>
      </div>
    </PortalShell>
  );
}
