import { PortalShell } from "@/components/portal/portal-shell";
import { VerifyOrderForm } from "@/components/portal/verify-order-form";

export default function PortalHomePage() {
  return (
    <PortalShell activeStep="input">
      <div className="card">
        <h2>Enter Your Order Details</h2>
        <p>
          Please provide your order information to check warranty/replacement
          eligibility.
        </p>
        <VerifyOrderForm />
      </div>

      <div className="card" style={{ marginTop: 30 }}>
        <h2>Track Your Existing Ticket</h2>
        <p>
          Already have a warranty ticket? Enter your ticket number to check the
          status.
        </p>
        <form method="GET" action="/track" className="form">
          <div className="form-group">
            <label htmlFor="ticket_number">Ticket Number *</label>
            <input
              type="text"
              id="ticket_number"
              name="ticket_number"
              placeholder="Enter your ticket number (e.g., WR2025050001)"
              required
            />
            <small>You can find this in your confirmation email</small>
          </div>
          <button type="submit" className="btn btn-secondary">
            Track Ticket
          </button>
        </form>
      </div>
    </PortalShell>
  );
}
