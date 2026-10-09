import { prisma } from "@/lib/db";

export type TroubleshootingResolution = {
  step_number: number;
  description: string;
};

export type TroubleshootingIssue = {
  id: string;
  issue_type: string;
  category: string;
  troubleshooting_steps?: string;
  resolutions: TroubleshootingResolution[];
};

function cleanTroubleshootingStep(text: string) {
  if (!text) return "";
  let cleaned = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  // Normalize HTML line breaks from guide content into newlines
  cleaned = cleaned.replace(/<br\s*\/?>/gi, "\n");
  cleaned = cleaned.replace(/<\/p>/gi, "\n").replace(/<p[^>]*>/gi, "");
  cleaned = cleaned.replace(/<[^>]+>/g, "");
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n").trim();
  return cleaned;
}

function parseTroubleshootingSteps(stepsText: string): TroubleshootingResolution[] {
  const text = cleanTroubleshootingStep(stepsText);
  if (!text) return [];
  return [{ step_number: 1, description: text }];
}

async function getCategoryBasedIssueDetails(
  issueId: string,
): Promise<TroubleshootingIssue | null> {
  const actualId = Number(issueId.replace(/^category_/, ""));
  if (!Number.isFinite(actualId)) return null;

  const rows = await prisma.$queryRaw<
    Array<{
      id: number;
      issue_name: string;
      category: string | null;
      troubleshooting_steps: string | null;
    }>
  >`
    SELECT id, issue_name, category, troubleshooting_steps
    FROM category_issues
    WHERE id = ${actualId}
    LIMIT 1
  `;
  const issue = rows[0];
  if (!issue) return null;

  return {
    id: issueId,
    issue_type: issue.issue_name,
    category: issue.category ?? "General",
    troubleshooting_steps: issue.troubleshooting_steps ?? "",
    resolutions: parseTroubleshootingSteps(issue.troubleshooting_steps ?? ""),
  };
}

function getEanCategoryIssueDetails(
  issueId: string,
  selectedEanIssue:
    | {
        issue: string;
        troubleshoot_steps: string;
        category_name?: string;
      }
    | undefined,
): TroubleshootingIssue | null {
  if (!selectedEanIssue?.issue) {
    // Fallback: still allow flow with a generic message if session lost the steps
    if (issueId.startsWith("ean_category_")) {
      return {
        id: issueId,
        issue_type: "Selected product issue",
        category: "Product Specific",
        resolutions: [
          {
            step_number: 1,
            description:
              "Please review common checks for your product (power, connections, alternate device). If the issue continues, proceed to submit a warranty claim.",
          },
        ],
      };
    }
    return null;
  }

  const steps = selectedEanIssue.troubleshoot_steps ?? "";
  return {
    id: issueId,
    issue_type: selectedEanIssue.issue || "Unknown Issue",
    category: selectedEanIssue.category_name || "Product Specific",
    troubleshooting_steps: steps,
    resolutions: parseTroubleshootingSteps(steps),
  };
}

async function getLegacyTroubleshootingIssueDetails(
  issueId: string,
): Promise<TroubleshootingIssue | null> {
  const numericId = Number(issueId);
  if (!Number.isFinite(numericId)) return null;

  const issues = await prisma.$queryRaw<
    Array<{
      id: number;
      issue_type: string;
      category: string | null;
      subcategory: string | null;
    }>
  >`
    SELECT id, issue_type, category, subcategory
    FROM troubleshooting_issues
    WHERE id = ${numericId}
    LIMIT 1
  `;
  const issue = issues[0];
  if (!issue) return null;

  const resolutions = await prisma.$queryRaw<TroubleshootingResolution[]>`
    SELECT step_number, description
    FROM troubleshooting_resolutions
    WHERE issue_id = ${numericId}
    ORDER BY step_number
  `;

  return {
    id: String(issue.id),
    issue_type: issue.issue_type,
    category: issue.category ?? "General",
    resolutions: resolutions.map((r) => ({
      step_number: Number(r.step_number),
      description: cleanTroubleshootingStep(String(r.description ?? "")),
    })),
  };
}

/** Port of WarrantyController::getTroubleshootingIssueDetails */
export async function getTroubleshootingIssueDetails(
  issueId: string,
  selectedEanIssue?: {
    issue: string;
    troubleshoot_steps: string;
    category_name?: string;
  },
): Promise<TroubleshootingIssue | null> {
  if (!issueId) return null;

  if (issueId === "not_listed") {
    return {
      id: "not_listed",
      issue_type: "Issue not listed above",
      category: "Other",
      resolutions: [],
    };
  }

  if (issueId === "category_not_working") {
    return {
      id: "category_not_working",
      issue_type: "Not Working",
      category: "General",
      resolutions: [
        {
          step_number: 1,
          description:
            "Apologies for the inconvenience caused. Please proceed further by providing us with more information about the issues you are facing",
        },
      ],
    };
  }

  if (issueId.startsWith("ean_category_")) {
    return getEanCategoryIssueDetails(issueId, selectedEanIssue);
  }

  if (issueId.startsWith("category_")) {
    return getCategoryBasedIssueDetails(issueId);
  }

  return getLegacyTroubleshootingIssueDetails(issueId);
}
