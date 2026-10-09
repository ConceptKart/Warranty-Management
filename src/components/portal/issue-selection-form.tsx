"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { validateSelectedProductsWarranty } from "@/lib/portal/validate-selected-products-warranty";

type Product = {
  product_id: string | number;
  name: string;
  sku: string;
  quantity: number;
  warranty_status: string;
  warranty_months: number;
  warranty_expiry: string | null;
  warranty_days_remaining: number;
};

type EanIssue = {
  issue: string;
  troubleshoot_steps: string;
  category_id?: number | null;
  category_name?: string;
};

type IssueOption = {
  value: string;
  label: string;
  group: string;
};

function warrantyLabel(product: Product, isReplacement: boolean) {
  if (product.warranty_status === "active") {
    return {
      text: `✓ Warranty Valid (${product.warranty_days_remaining} days remaining)`,
      className: "warranty-active",
    };
  }
  if (product.warranty_status === "expired_by_date") {
    if (isReplacement) {
      return {
        text: "✗ Warranty Expired — still eligible via 10-day replacement",
        className: "warranty-expired",
      };
    }
    return { text: "✗ Warranty Expired", className: "warranty-expired" };
  }
  if (product.warranty_months === 0) {
    if (isReplacement) {
      return {
        text: "No product warranty listed — covered by 10-day replacement",
        className: "warranty-none",
      };
    }
    return {
      text: "We don't provide warranty on this product",
      className: "warranty-none",
    };
  }
  return {
    text: "Warranty information unavailable",
    className: "warranty-none",
  };
}

/** Stable per-row key even when product_id is duplicated (0 / shared catalog id). */
function lineKey(product: Product, index: number) {
  return `${String(product.product_id)}::${product.sku || "sku"}::${index}`;
}

export function IssueSelectionForm({
  products,
  isReplacement = false,
  isAmazon = false,
}: {
  products: Product[];
  isReplacement?: boolean;
  isAmazon?: boolean;
}) {
  const router = useRouter();
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [issueId, setIssueId] = useState("");
  const [eanIssues, setEanIssues] = useState<EanIssue[]>([]);
  const [issuesLoading, setIssuesLoading] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const selectedProducts = useMemo(
    () =>
      products.filter((p, idx) => selectedKeys.has(lineKey(p, idx))),
    [products, selectedKeys],
  );

  const warrantyGate = useMemo(
    () =>
      validateSelectedProductsWarranty({
        products: selectedProducts,
        isAmazon,
        isReplacement,
      }),
    [selectedProducts, isAmazon, isReplacement],
  );

  const primarySku = selectedProducts[0]?.sku ?? "";

  useEffect(() => {
    if (!primarySku) {
      setEanIssues([]);
      setIssueId("");
      setIssuesLoading(false);
      return;
    }

    let cancelled = false;
    setIssuesLoading(true);
    setIssueId("");
    setError("");

    fetch(`/api/portal/ean-issues?sku=${encodeURIComponent(primarySku)}`)
      .then(async (res) => {
        const data = await res.json();
        if (cancelled) return;
        if (!data.success) {
          setEanIssues([]);
          return;
        }
        setEanIssues(Array.isArray(data.issues) ? data.issues : []);
      })
      .catch(() => {
        if (!cancelled) setEanIssues([]);
      })
      .finally(() => {
        if (!cancelled) setIssuesLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [primarySku]);

  const options: IssueOption[] = useMemo(() => {
    if (selectedProducts.length === 0) return [];

    const hasCategories = eanIssues.some((i) => i.category_name);
    const list: IssueOption[] = [];

    if (eanIssues.length === 0 && !issuesLoading) {
      list.push({
        value: "category_not_working",
        label: "Not Working",
        group: "General Issues",
      });
    } else if (hasCategories) {
      eanIssues.forEach((issue, index) => {
        list.push({
          value: `ean_category_${index}`,
          label: issue.issue || "Unknown Issue",
          group: issue.category_name || "Other",
        });
      });
    } else {
      eanIssues.forEach((issue, index) => {
        list.push({
          value: `ean_category_${index}`,
          label: issue.issue || "Unknown Issue",
          group: "Product Issues",
        });
      });
    }

    list.push({
      value: "not_listed",
      label: "Issue not listed above",
      group: "Other",
    });
    return list;
  }, [eanIssues, issuesLoading, selectedProducts.length]);

  const grouped = useMemo(() => {
    const map = new Map<string, IssueOption[]>();
    for (const opt of options) {
      const arr = map.get(opt.group) ?? [];
      arr.push(opt);
      map.set(opt.group, arr);
    }
    return Array.from(map.entries());
  }, [options]);

  function toggleProduct(product: Product, index: number) {
    const key = lineKey(product, index);
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
        setQuantities((q) => ({
          ...q,
          [key]: q[key] ?? 1,
        }));
      }
      return next;
    });
  }

  function setQty(product: Product, index: number, value: number) {
    const key = lineKey(product, index);
    const max = Math.max(1, product.quantity || 1);
    const next = Math.min(max, Math.max(1, value));
    setQuantities((q) => ({ ...q, [key]: next }));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (selectedProducts.length === 0) {
      setError("Please select a product");
      return;
    }
    if (!issueId) {
      setError("Please select an issue type");
      return;
    }

    const gate = validateSelectedProductsWarranty({
      products: selectedProducts,
      isAmazon,
      isReplacement,
    });
    if (!gate.ok) {
      setError(gate.message);
      return;
    }

    const first = selectedProducts[0]!;
    setLoading(true);
    try {
      const eanIndex = issueId.startsWith("ean_category_")
        ? Number(issueId.replace("ean_category_", ""))
        : NaN;
      const selectedEanIssue =
        Number.isFinite(eanIndex) && eanIssues[eanIndex]
          ? {
              issue: eanIssues[eanIndex]!.issue,
              troubleshoot_steps: eanIssues[eanIndex]!.troubleshoot_steps,
              category_name: eanIssues[eanIndex]!.category_name,
            }
          : null;

      const selected_products_json = JSON.stringify(
        products.flatMap((p, idx) => {
          const key = lineKey(p, idx);
          if (!selectedKeys.has(key)) return [];
          return [
            {
              product_id: p.product_id,
              name: p.name,
              sku: p.sku,
              quantity: quantities[key] ?? 1,
            },
          ];
        }),
      );

      const res = await fetch("/api/portal/issue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          issue_type_id: issueId,
          selected_product: String(first.product_id),
          selected_products_json,
          selected_ean_issue: selectedEanIssue,
        }),
      });

      const text = await res.text();
      let data: { success?: boolean; error?: string; redirect?: string } = {};
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        setError("Unable to continue. Please try again.");
        return;
      }

      if (!data.success) {
        setError(data.error ?? "Unable to continue");
        return;
      }
      router.push(data.redirect ?? "/troubleshoot");
      router.refresh();
    } catch {
      setError("Unable to continue. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  const issueSelectDisabled =
    selectedProducts.length === 0 || issuesLoading;
  const submitDisabled =
    loading || issueSelectDisabled || !issueId || !warrantyGate.ok;

  return (
    <form onSubmit={(e) => void onSubmit(e)} className="form">
      {error || !warrantyGate.ok ? (
        <div className="alert alert-error" style={{ marginBottom: 16 }}>
          {error || warrantyGate.message}
        </div>
      ) : null}

      <h3>
        Select the products you are facing issue with and we will provide you
        troubleshooting steps
      </h3>
      <p>
        Choose the products from your order that are experiencing issues.
        We&apos;ll guide you through troubleshooting steps to help resolve them.
      </p>

      <div className="form-group">
        <label htmlFor="product-selection">Select Products *</label>
        <div id="product-selection" className="product-selection-container">
          <div className="product-grid">
            {products.map((product, idx) => {
              const key = lineKey(product, idx);
              const checked = selectedKeys.has(key);
              const warranty = warrantyLabel(product, isReplacement);
              const qty = quantities[key] ?? 1;
              const maxQty = Math.max(1, product.quantity || 1);
              const inputId = `product_${idx}`;

              return (
                <div
                  key={key}
                  className={`product-card${checked ? " selected" : ""}`}
                  onClick={() => toggleProduct(product, idx)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      toggleProduct(product, idx);
                    }
                  }}
                >
                  <div className="product-card-header">
                    <div
                      className="product-checkbox-container"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        type="checkbox"
                        id={inputId}
                        className="product-checkbox"
                        checked={checked}
                        onChange={() => toggleProduct(product, idx)}
                      />
                      <label
                        htmlFor={inputId}
                        className="product-checkbox-label"
                      >
                        <span className="checkbox-custom" />
                      </label>
                    </div>
                    <div className="product-info">
                      <h4 className="product-name">{product.name}</h4>
                      <div className={`product-warranty-info ${warranty.className}`}>
                        {warranty.text}
                      </div>
                    </div>
                  </div>

                  {checked ? (
                    <div
                      className="quantity-controls"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <label className="quantity-label">Quantity:</label>
                      <div className="quantity-input-group">
                        <button
                          type="button"
                          className="quantity-btn"
                          onClick={() => setQty(product, idx, qty - 1)}
                          aria-label="Decrease quantity"
                        >
                          −
                        </button>
                        <input
                          type="number"
                          className="quantity-input"
                          min={1}
                          max={maxQty}
                          value={qty}
                          onChange={(e) =>
                            setQty(product, idx, Number(e.target.value) || 1)
                          }
                        />
                        <button
                          type="button"
                          className="quantity-btn"
                          onClick={() => setQty(product, idx, qty + 1)}
                          aria-label="Increase quantity"
                        >
                          +
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
        <small>
          Select one or more products that are experiencing issues and specify
          quantities
        </small>
      </div>

      <div className="form-group">
        <label htmlFor="issue_type_id">Issue Type *</label>
        <select
          id="issue_type_id"
          name="issue_type_id"
          value={issueId}
          onChange={(e) => setIssueId(e.target.value)}
          required
          disabled={issueSelectDisabled}
        >
          <option value="">
            {selectedProducts.length === 0
              ? "Please select a product first to see available issues"
              : issuesLoading
                ? "Loading issues…"
                : "Select an issue type"}
          </option>
          {grouped.map(([group, opts]) => (
            <optgroup key={group} label={group}>
              {opts.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <small
          id="issue-help-text"
          style={{
            color: "#6c757d",
            display: selectedProducts.length > 0 ? "block" : "none",
          }}
        >
          Issues are customized based on your product category
        </small>
      </div>

      <div className="form-actions">
        <Link href="/" className="btn btn-secondary">
          Back
        </Link>
        <button
          type="submit"
          className="btn btn-primary"
          id="submit-btn"
          disabled={submitDisabled}
          title={!warrantyGate.ok ? warrantyGate.message : undefined}
        >
          {issueId === "not_listed"
            ? "Continue"
            : "Get Troubleshooting Steps"}
        </button>
      </div>
    </form>
  );
}
