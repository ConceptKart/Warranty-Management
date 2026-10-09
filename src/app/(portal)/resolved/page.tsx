import Link from "next/link";
import { PortalShell } from "@/components/portal/portal-shell";

export default function ResolvedPage() {
  return (
    <PortalShell activeStep="resolved">
      <div className="card">
        <div className="success-icon">✓</div>
        <h2>Great! Your Issue Has Been Resolved</h2>

        <div className="success-message">
          <p>
            We&apos;re glad the troubleshooting steps helped resolve your issue.
            No warranty claim is needed at this time.
          </p>

          <div className="next-steps">
            <h3>What&apos;s Next?</h3>
            <ul>
              <li>Keep your order information handy for future reference</li>
              <li>
                If you experience the same issue again, you can return to this
                troubleshooting guide
              </li>
              <li>
                For any other issues, feel free to start a new support request
              </li>
            </ul>
          </div>
        </div>

        <div className="form-actions">
          <Link href="/" className="btn btn-primary">
            Submit Another Request
          </Link>
        </div>
      </div>
    </PortalShell>
  );
}
