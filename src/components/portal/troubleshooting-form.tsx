"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type Resolution = {
  step_number: number;
  description: string;
};

export function TroubleshootingForm({
  issueType,
  category,
  resolutions,
}: {
  issueType: string;
  category: string;
  resolutions: Resolution[];
}) {
  const router = useRouter();
  const [resolved, setResolved] = useState<"yes" | "no" | "">("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (!resolved) {
      setError("Please select whether your issue was resolved");
      return;
    }
    setLoading(true);
    try {
      if (resolved === "yes") {
        router.push("/resolved");
      } else {
        router.push("/claim");
      }
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <h2>Troubleshooting: {issueType}</h2>
      <p className="issue-category">
        Category: <strong>{category}</strong>
      </p>

      <div className="troubleshooting-steps">
        {resolutions.length === 1 ? (
          <div className="troubleshooting-guide">
            <h3>Troubleshooting Guide</h3>
            <div className="guide-content">{resolutions[0]!.description}</div>
          </div>
        ) : resolutions.length > 1 ? (
          <>
            <h3 className="steps-heading">
              Please follow these troubleshooting steps:
            </h3>
            {resolutions.map((resolution) => (
              <div
                key={resolution.step_number}
                className="troubleshooting-step"
              >
                <h4>Step {resolution.step_number}</h4>
                <div className="step-content">{resolution.description}</div>
              </div>
            ))}
          </>
        ) : (
          <p>
            No specific troubleshooting steps available for this issue. Please
            contact our support team for assistance.
          </p>
        )}
      </div>

      <form onSubmit={onSubmit} className="form" style={{ marginTop: 30 }}>
        <div className="resolution-check">
          <h3>Did these steps resolve your issue?</h3>
          <div className="form-group">
            <div className="radio-group">
              <label className="radio-option">
                <input
                  type="radio"
                  name="issue_resolved"
                  value="yes"
                  checked={resolved === "yes"}
                  onChange={() => setResolved("yes")}
                  required
                />
                <span className="radio-label">✓ Yes, my issue is resolved</span>
              </label>
              <label className="radio-option">
                <input
                  type="radio"
                  name="issue_resolved"
                  value="no"
                  checked={resolved === "no"}
                  onChange={() => setResolved("no")}
                  required
                />
                <span className="radio-label">✗ No, I still need help</span>
              </label>
            </div>
          </div>
        </div>

        {error ? <div className="alert alert-error">{error}</div> : null}

        <div className="form-actions">
          <Link href="/issue" className="btn btn-secondary">
            Back to Issue Selection
          </Link>
          <button type="submit" className="btn btn-primary" disabled={loading}>
            Continue
          </button>
        </div>
      </form>
    </>
  );
}
