import { redirect } from "next/navigation";
import { PortalShell } from "@/components/portal/portal-shell";
import { TroubleshootingForm } from "@/components/portal/troubleshooting-form";
import { getPortalSession } from "@/lib/portal/get-session";
import { getTroubleshootingIssueDetails } from "@/lib/portal/troubleshooting";

export default async function TroubleshootPage() {
  const session = await getPortalSession();
  if (!session.orderData || !session.selectedIssueId) {
    redirect("/");
  }

  if (session.selectedIssueId === "not_listed") {
    redirect("/claim");
  }

  const issue = await getTroubleshootingIssueDetails(
    session.selectedIssueId,
    session.selectedEanIssue,
  );

  if (!issue) {
    redirect("/issue");
  }

  return (
    <PortalShell activeStep="fix">
      <div className="card">
        <TroubleshootingForm
          issueType={issue.issue_type}
          category={issue.category}
          resolutions={issue.resolutions}
        />
      </div>
    </PortalShell>
  );
}
