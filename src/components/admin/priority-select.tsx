"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function PrioritySelect({
  ticketId,
  currentPriority,
}: {
  ticketId: number;
  currentPriority: string;
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function onChange(priority: string) {
    setSaving(true);
    setSaved(false);
    try {
      const res = await fetch("/api/admin/tickets/priority", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticket_id: ticketId, priority }),
      });
      const data = await res.json();
      if (data.success) {
        setSaved(true);
        router.refresh();
        setTimeout(() => setSaved(false), 1500);
      } else {
        alert(data.error ?? "Failed to update priority");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <span className="d-inline-flex align-items-center gap-1">
      <label
        htmlFor="prioritySelect"
        className="mb-0 small text-muted"
      >
        Priority:
      </label>
      <select
        id="prioritySelect"
        className="form-select form-select-sm border-0 bg-transparent fw-semibold"
        style={{ width: "auto", cursor: "pointer" }}
        defaultValue={currentPriority}
        disabled={saving}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="medium">Medium</option>
        <option value="high">High</option>
        <option value="urgent">Urgent</option>
      </select>
      {saved ? (
        <span style={{ fontSize: 11, color: "#198754" }}>Saved</span>
      ) : null}
    </span>
  );
}
