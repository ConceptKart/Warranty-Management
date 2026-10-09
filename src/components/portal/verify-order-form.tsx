"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export function VerifyOrderForm() {
  const router = useRouter();
  const [platform, setPlatform] = useState("website");
  const [orderNumber, setOrderNumber] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  function helpFor(platformValue: string) {
    if (platformValue === "amazon") {
      return {
        placeholder: "Enter Amazon Order ID (e.g., 404-4126168-9374732)",
        help: (
          <>
            <strong>Amazon Order ID:</strong> Find this in your Amazon order
            confirmation email or My Orders page. Format: XXX-XXXXXXX-XXXXXXX
          </>
        ),
      };
    }
    if (platformValue === "website") {
      return {
        placeholder: "Enter order number (e.g. #CK10001)",
        help: null as React.ReactNode,
      };
    }
    return {
      placeholder: "Enter your order number",
      help: "Select a platform above to see the required order number format.",
    };
  }

  const help = helpFor(platform);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/portal/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platform,
          order_number: orderNumber,
        }),
      });
      const data = await res.json();
      if (!data.success) {
        setError(data.error ?? "Unable to verify order");
        return;
      }
      router.push(data.redirect ?? "/issue");
      router.refresh();
    } catch {
      setError("Unable to verify order. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="form">
      {error ? (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      ) : null}

      <div className="form-group">
        <label htmlFor="platform">Where did you purchase? *</label>
        <select
          id="platform"
          name="platform"
          required
          value={platform}
          onChange={(e) => setPlatform(e.target.value)}
        >
          <option value="">Select platform</option>
          <option value="website">conceptkart.com</option>
          <option value="amazon">Amazon</option>
        </select>
      </div>

      <div className="form-group">
        <label htmlFor="order_number">Platform Order ID / Order Number *</label>
        <input
          type="text"
          id="order_number"
          name="order_number"
          required
          value={orderNumber}
          onChange={(e) => setOrderNumber(e.target.value)}
          placeholder={help.placeholder}
          inputMode="email"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
        />
        <small id="order-help-text">{help.help}</small>
      </div>

      <button type="submit" className="btn btn-primary" disabled={loading}>
        Verify Order
      </button>
    </form>
  );
}
