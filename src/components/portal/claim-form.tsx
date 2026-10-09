"use client";

import { FormEvent, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type Customer = {
  email: string;
  phone: string;
  name: string;
  shipping_address: {
    address: string;
    city: string;
    state: string;
    zipcode: string;
    country: string;
  };
};

type Product = {
  product_id: string | number;
  name: string;
  sku: string;
};

type DuplicateInfo = {
  ticket_number?: string;
  days_remaining?: number;
};

function platformLabel(platform: string) {
  if (platform === "amazon") return "Amazon";
  if (platform === "flipkart") return "Flipkart";
  return "Website";
}

function formatDate(unix: number) {
  return new Date(unix * 1000).toLocaleDateString("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric",
  });
}

/** Letters and spaces only (names, city, state) */
function onlyAlphabets(value: string) {
  return value.replace(/[^a-zA-Z\s]/g, "");
}

/** Digits only, capped length */
function onlyDigits(value: string, maxLen: number) {
  return value.replace(/\D/g, "").slice(0, maxLen);
}

export function ClaimForm({
  platform,
  orderId,
  orderDateUnix,
  customer,
  selectedProducts,
  isAmazon,
  isReplacement = false,
  replacementDaysRemaining = 0,
  backHref = "/troubleshoot",
  skippedTroubleshooting = false,
}: {
  platform: string;
  orderId: string;
  orderDateUnix: number;
  customer: Customer;
  selectedProducts: Product[];
  isAmazon: boolean;
  isReplacement?: boolean;
  replacementDaysRemaining?: number;
  backHref?: string;
  skippedTroubleshooting?: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(isAmazon);
  const [name, setName] = useState(() => onlyAlphabets(customer.name));
  const [email, setEmail] = useState(customer.email);
  const [phone, setPhone] = useState(() => onlyDigits(customer.phone, 10));
  const [street, setStreet] = useState(customer.shipping_address.address);
  const [city, setCity] = useState(() =>
    onlyAlphabets(customer.shipping_address.city),
  );
  const [state, setState] = useState(() =>
    onlyAlphabets(customer.shipping_address.state),
  );
  const [pincode, setPincode] = useState(() =>
    onlyDigits(customer.shipping_address.zipcode, 6),
  );
  const [description, setDescription] = useState("");
  const [sourceDevice, setSourceDevice] = useState("");
  const [files, setFiles] = useState<FileList | null>(null);
  const [uploadedUrls, setUploadedUrls] = useState<string[]>([]);
  const [uploadMessage, setUploadMessage] = useState("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [duplicate, setDuplicate] = useState<DuplicateInfo | null>(null);
  const [loading, setLoading] = useState(false);

  const displayAddress = useMemo(() => {
    return [
      street,
      city,
      state,
      pincode,
      customer.shipping_address.country || "India",
    ]
      .map((p) => p.trim())
      .filter(Boolean)
      .join(", ");
  }, [street, city, state, pincode, customer.shipping_address.country]);

  const hasCustomerInfo = Boolean(name || email || phone || displayAddress);

  function onFilesChange(list: FileList | null) {
    setFiles(list);
    setUploadedUrls([]);
    setUploadMessage("");
  }

  async function directUploadFiles(): Promise<string[] | null> {
    if (!files || files.length === 0) {
      alert("Please select files first");
      return null;
    }
    if (files.length > 2) {
      setError("Maximum 2 files allowed.");
      return null;
    }

    setUploading(true);
    setUploadMessage("Uploading files... Please wait.");
    setError("");

    const urls: string[] = [];
    const fileArr = Array.from(files);

    try {
      for (let i = 0; i < fileArr.length; i++) {
        const file = fileArr[i]!;
        setUploadMessage(`Uploading file ${i + 1} of ${fileArr.length}...`);

        const formData = new FormData();
        formData.append("mediaFile", file);
        formData.append("type", "warranty");

        const res = await fetch("/api/portal/upload", {
          method: "POST",
          body: formData,
        });
        const data = await res.json();

        if (!res.ok || !data.success || !data.fileUrl) {
          throw new Error(data.message || `Upload failed for file ${i + 1}`);
        }
        urls.push(String(data.fileUrl));
      }

      setUploadedUrls(urls);
      setUploadMessage("✅ Files uploaded successfully");
      return urls;
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Upload failed. Please try again.";
      setUploadMessage(`❌ Upload Failed: ${msg}`);
      return null;
    } finally {
      setUploading(false);
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setDuplicate(null);

    if (isAmazon && (!name.trim() || !email.trim() || !phone.trim() || !street.trim())) {
      setError(
        "Please complete the customer information section before submitting your warranty claim.",
      );
      setEditing(true);
      return;
    }
    if (name.trim() && !/^[a-zA-Z\s]+$/.test(name.trim())) {
      setError("Name must contain only alphabets.");
      setEditing(true);
      return;
    }
    if (phone.trim() && !/^\d{10}$/.test(phone.trim())) {
      setError("Phone number must be exactly 10 digits.");
      setEditing(true);
      return;
    }
    if (city.trim() && !/^[a-zA-Z\s]+$/.test(city.trim())) {
      setError("City must contain only alphabets.");
      setEditing(true);
      return;
    }
    if (state.trim() && !/^[a-zA-Z\s]+$/.test(state.trim())) {
      setError("State must contain only alphabets.");
      setEditing(true);
      return;
    }
    if (pincode.trim() && !/^\d+$/.test(pincode.trim())) {
      setError("Pincode must contain only numbers.");
      setEditing(true);
      return;
    }
    if (!email.trim()) {
      setError("Email address is required.");
      return;
    }
    if (description.trim().length < 40) {
      setError("Issue description must be at least 40 characters long");
      return;
    }
    if (sourceDevice.trim().length < 3) {
      setError("Please specify the device and model used with the product");
      return;
    }
    if (!files || files.length === 0) {
      setError("Please upload at least one photo or video of the issue");
      return;
    }
    if (files.length > 2) {
      setError("Maximum 2 files allowed.");
      return;
    }

    let urlsToSubmit = uploadedUrls;
    if (urlsToSubmit.length === 0) {
      setLoading(true);
      const uploaded = await directUploadFiles();
      setLoading(false);
      if (!uploaded?.length) {
        setError("File upload failed. Please try uploading files manually first.");
        return;
      }
      urlsToSubmit = uploaded;
    }

    if (urlsToSubmit.length === 0) {
      setError("Please upload at least one photo or video of the issue");
      return;
    }

    const formData = new FormData();
    formData.set("customer_email", email.trim());
    formData.set("edit_email", email.trim());
    formData.set("edit_name", name.trim());
    formData.set("edit_phone", phone.trim());
    formData.set("edit_shipping_street", street.trim());
    formData.set("edit_shipping_city", city.trim());
    formData.set("edit_shipping_state", state.trim());
    formData.set("edit_shipping_pincode", pincode.trim());
    formData.set(
      "edit_shipping_address",
      [
        street,
        city,
        state,
        pincode,
        customer.shipping_address.country || "India",
      ]
        .map((p) => p.trim())
        .filter(Boolean)
        .join(", "),
    );
    formData.set("issue_description", description.trim());
    formData.set("source_device", sourceDevice.trim());
    formData.set("baselinker_field_6397", urlsToSubmit[0] ?? "");
    formData.set("baselinker_field_6398", urlsToSubmit[1] ?? "");
    formData.set("uploaded_urls", JSON.stringify(urlsToSubmit));

    setLoading(true);
    try {
      const res = await fetch("/api/portal/claim", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (!data.success) {
        if (data.duplicate) {
          setDuplicate({
            ticket_number: data.ticket_number,
            days_remaining: data.days_remaining,
          });
        }
        setError(data.error ?? "Unable to submit claim");
        return;
      }
      router.push(data.redirect ?? "/confirmation");
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      {duplicate ? (
        <div
          style={{
            background: "#fff3cd",
            border: "1px solid #ffc107",
            borderRadius: 8,
            padding: 20,
            marginBottom: 20,
          }}
        >
          <h4 style={{ color: "#856404", margin: "0 0 12px 0" }}>
            ⚠ Ticket Already Raised
          </h4>
          <p style={{ margin: "0 0 12px 0" }}>
            A warranty ticket has already been submitted for this order:
          </p>
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: 14,
            }}
          >
            <tbody>
              <tr>
                <td
                  style={{
                    padding: "6px 0",
                    fontWeight: 600,
                    color: "#856404",
                    width: 160,
                  }}
                >
                  Ticket Number:
                </td>
                <td style={{ padding: "6px 0", fontFamily: "monospace" }}>
                  {duplicate.ticket_number ?? "—"}
                </td>
              </tr>
              <tr>
                <td
                  style={{
                    padding: "6px 0",
                    fontWeight: 600,
                    color: "#856404",
                  }}
                >
                  Time Remaining:
                </td>
                <td style={{ padding: "6px 0" }}>
                  {Number(duplicate.days_remaining ?? 0)} day(s) until a new
                  claim is allowed
                </td>
              </tr>
            </tbody>
          </table>
          <p style={{ margin: "12px 0 0 0", fontSize: 13, color: "#856404" }}>
            Please wait before submitting another ticket for the same order.
          </p>
        </div>
      ) : null}

      <p>
        {skippedTroubleshooting
          ? "Please provide details about your issue to help us process your warranty claim."
          : "Since the troubleshooting steps didn't resolve your issue, please provide additional details for your warranty claim."}
      </p>

      <div className="order-summary">
        <h3>Order Details</h3>
        <div className="order-info">
          <div className="info-row">
            <span className="label">Order Number:</span>
            <span className="value">{orderId}</span>
          </div>
          <div className="info-row">
            <span className="label">Order Date:</span>
            <span className="value">{formatDate(orderDateUnix)}</span>
          </div>
          <div className="info-row">
            <span className="label">Platform:</span>
            <span className="value">{platformLabel(platform)}</span>
          </div>
        </div>
        {!isAmazon && isReplacement ? (
          <div className="warranty-status">
            <div className="status-badge status-valid">
              ✓ 10-Day Replacement Window ({replacementDaysRemaining} days
              remaining)
            </div>
            <div className="replacement-priority-notice">
              <small>
                <strong>Note:</strong> This claim will be processed as a
                replacement request within the 10-day window.
              </small>
            </div>
          </div>
        ) : null}
      </div>

      <div className="customer-info-section" style={{ marginTop: 20 }}>
        <h3>
          Customer Information
          {isAmazon ? (
            <span
              style={{
                color: "#dc3545",
                fontSize: "0.8em",
                fontWeight: "normal",
                marginLeft: 8,
              }}
            >
              * Required for {platformLabel(platform)} orders
            </span>
          ) : null}
        </h3>

        {isAmazon ? (
          <div className="alert alert-info" style={{ marginBottom: 20 }}>
            <h4>Customer Information Required</h4>
            <p>
              Amazon orders require you to enter your contact and shipping
              details. Please fill in all required fields below.
            </p>
          </div>
        ) : !hasCustomerInfo ? (
          <div className="alert alert-warning" style={{ marginBottom: 20 }}>
            <h4>Customer Information Missing</h4>
            <p>
              No customer information was found in your order. Please provide
              your contact details below.
            </p>
          </div>
        ) : null}

        {!editing && hasCustomerInfo && !isAmazon ? (
          <div className="customer-info-display" id="customer-info-display">
            <div className="customer-info">
              {name ? (
                <div className="info-row">
                  <span className="label">Name:</span>
                  <span className="value">{name}</span>
                </div>
              ) : null}
              {email ? (
                <div className="info-row">
                  <span className="label">Email:</span>
                  <span className="value">{email}</span>
                </div>
              ) : null}
              {phone ? (
                <div className="info-row">
                  <span className="label">Phone:</span>
                  <span className="value">{phone}</span>
                </div>
              ) : null}
              {displayAddress ? (
                <div className="info-row">
                  <span className="label">Shipping Address:</span>
                  <span className="value">{displayAddress}</span>
                </div>
              ) : null}
            </div>
            <div className="customer-info-actions" style={{ marginTop: 12 }}>
              <p className="info-confirmation">Is this information correct?</p>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setEditing(true)}
              >
                Edit Information
              </button>
            </div>
          </div>
        ) : null}

        {editing || isAmazon || !hasCustomerInfo ? (
          <div className="customer-info-edit" id="customer-info-edit">
            {!isAmazon ? (
              <div className="alert alert-info" style={{ marginBottom: 20 }}>
                <strong>Edit Customer Information:</strong> Update your contact
                details below.
              </div>
            ) : null}

            <div className="form-group">
              <label htmlFor="edit-name">
                Name {isAmazon ? <span style={{ color: "#dc3545" }}>*</span> : null}
              </label>
              <input
                id="edit-name"
                type="text"
                value={name}
                onChange={(e) => setName(onlyAlphabets(e.target.value))}
                placeholder="Enter your full name"
                pattern="[A-Za-z\s]+"
                title="Name must contain only alphabets"
                required={isAmazon}
              />
            </div>
            <div className="form-group">
              <label htmlFor="edit-email">
                Email <span style={{ color: "#dc3545" }}>*</span>
              </label>
              <input
                id="edit-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="your.email@example.com"
                required
              />
            </div>
            <div className="form-group">
              <label htmlFor="edit-phone">
                Phone {isAmazon ? <span style={{ color: "#dc3545" }}>*</span> : null}
              </label>
              <input
                id="edit-phone"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(onlyDigits(e.target.value, 10))}
                placeholder="+1234567890"
                inputMode="numeric"
                maxLength={10}
                pattern="\d{10}"
                title="Phone number must be 10 digits"
                required={isAmazon}
              />
            </div>
            <div style={{ marginBottom: 20 }}>
              <label
                style={{
                  display: "block",
                  fontWeight: 600,
                  color: "#495057",
                  fontSize: "0.9rem",
                  marginBottom: 6,
                }}
              >
                Shipping Address{" "}
                {isAmazon ? <span style={{ color: "#dc3545" }}>*</span> : null}
              </label>
              <input
                id="edit-shipping-address"
                type="text"
                value={street}
                onChange={(e) => setStreet(e.target.value)}
                placeholder="House / Flat / Street / Locality"
                required={isAmazon}
              />
            </div>
            <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
              <div style={{ flex: 2, minWidth: 0 }}>
                <label
                  style={{
                    display: "block",
                    fontWeight: 600,
                    color: "#495057",
                    fontSize: "0.9rem",
                    marginBottom: 6,
                  }}
                >
                  City {isAmazon ? <span style={{ color: "#dc3545" }}>*</span> : null}
                </label>
                <input
                  id="edit-shipping-city"
                  type="text"
                  value={city}
                  onChange={(e) => setCity(onlyAlphabets(e.target.value))}
                  placeholder="City"
                  pattern="[A-Za-z\s]+"
                  title="City must contain only alphabets"
                  required={isAmazon}
                />
              </div>
              <div style={{ flex: 2, minWidth: 0 }}>
                <label
                  style={{
                    display: "block",
                    fontWeight: 600,
                    color: "#495057",
                    fontSize: "0.9rem",
                    marginBottom: 6,
                  }}
                >
                  State {isAmazon ? <span style={{ color: "#dc3545" }}>*</span> : null}
                </label>
                <input
                  id="edit-shipping-state"
                  type="text"
                  value={state}
                  onChange={(e) => setState(onlyAlphabets(e.target.value))}
                  placeholder="State"
                  pattern="[A-Za-z\s]+"
                  title="State must contain only alphabets"
                  required={isAmazon}
                />
              </div>
              <div style={{ flex: 1, minWidth: 90 }}>
                <label
                  style={{
                    display: "block",
                    fontWeight: 600,
                    color: "#495057",
                    fontSize: "0.9rem",
                    marginBottom: 6,
                  }}
                >
                  Pincode{" "}
                  {isAmazon ? <span style={{ color: "#dc3545" }}>*</span> : null}
                </label>
                <input
                  id="edit-shipping-pincode"
                  type="text"
                  value={pincode}
                  onChange={(e) => setPincode(onlyDigits(e.target.value, 6))}
                  placeholder="6-digit"
                  inputMode="numeric"
                  maxLength={6}
                  pattern="\d{6}"
                  title="Pincode must contain only numbers"
                  required={isAmazon}
                />
              </div>
            </div>
            <div className="customer-edit-actions" style={{ marginBottom: 16 }}>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => setEditing(false)}
              >
                Save Changes
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                style={{ marginLeft: 8 }}
                onClick={() => {
                  setName(onlyAlphabets(customer.name));
                  setEmail(customer.email);
                  setPhone(onlyDigits(customer.phone, 10));
                  setStreet(customer.shipping_address.address);
                  setCity(onlyAlphabets(customer.shipping_address.city));
                  setState(onlyAlphabets(customer.shipping_address.state));
                  setPincode(onlyDigits(customer.shipping_address.zipcode, 6));
                  setEditing(false);
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : null}
      </div>

      <form onSubmit={onSubmit} className="form" style={{ marginTop: 10 }}>
        <h3>Claim Details</h3>

        <div className="form-group">
          <label>Selected Products</label>
          {selectedProducts.length === 0 ? (
            <div className="alert alert-warning">
              <p>
                No products were selected. Please{" "}
                <Link href="/issue">go back to issue selection</Link>.
              </p>
            </div>
          ) : (
            <div style={{ maxWidth: 800 }}>
              {selectedProducts.map((product) => (
                <div
                  key={String(product.product_id)}
                  className="selected-product-item"
                  style={{
                    background: "#f8f9fa",
                    border: "1px solid #dee2e6",
                    borderRadius: 6,
                    padding: 12,
                    marginBottom: 8,
                  }}
                >
                  <h4
                    style={{
                      margin: 0,
                      color: "#495057",
                      fontSize: "1rem",
                    }}
                  >
                    {product.name}
                  </h4>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="form-group">
          <label htmlFor="issue_description">Describe the Issue in Detail *</label>
          <textarea
            id="issue_description"
            name="issue_description"
            rows={6}
            maxLength={400}
            required
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Please provide detailed information about the issue you're experiencing. Include what you tried from the troubleshooting steps and what didn't work..."
          />
          <small>
            Minimum 40 characters required, maximum 400 characters. Please be as
            detailed as possible to help us resolve your issue quickly.
          </small>
        </div>

        <div className="form-group">
          <label htmlFor="source_device">
            Specify the device and model used with the product{" "}
            <span style={{ color: "#dc3545" }}>*</span>
          </label>
          <input
            id="source_device"
            name="source_device"
            type="text"
            required
            value={sourceDevice}
            onChange={(e) => setSourceDevice(e.target.value)}
            placeholder="e.g., Samsung Galaxy S21, iPhone 15 Pro, MacBook Pro 2023"
          />
          <small>
            Please specify the device (brand and model) you are using this
            product with. This helps us troubleshoot your issue more
            effectively.
          </small>
        </div>

        <div className="form-group">
          <label htmlFor="attachments">
            Upload Photos/Videos <span style={{ color: "#dc3545" }}>*</span>
          </label>
          <div className="file-upload-container">
            <input
              id="attachments"
              name="attachments[]"
              type="file"
              multiple
              accept=".jpg,.jpeg,.png,.gif,.mp4,.avi,.mov,.wmv"
              data-max-files="2"
              data-max-size="10485760"
              onChange={(e) => onFilesChange(e.target.files)}
            />
            <div className="file-upload-info">
              <div className="upload-requirements">
                <strong>File guidelines:</strong>
                <ul>
                  <li>Maximum 2 files allowed</li>
                  <li>Maximum 10MB per file</li>
                  <li>Supported formats: JPG, JPEG, PNG | MP4, MOV</li>
                </ul>
              </div>
              {files && files.length > 0 ? (
                <div className="file-preview">
                  <h4>Selected Files:</h4>
                  <div id="file-list">
                    {Array.from(files).map((f) => (
                      <div key={f.name + f.size} className="file-item">
                        <div className="file-info">
                          <div className="file-name">{f.name}</div>
                          <div className="file-size">
                            {(f.size / (1024 * 1024)).toFixed(2)} MB
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
          {files && files.length > 0 ? (
            <button
              type="button"
              id="upload-files-btn"
              className="btn btn-primary btn-sm"
              style={{ marginTop: 10 }}
              disabled={uploading}
              onClick={() => void directUploadFiles()}
            >
              {uploading ? "Uploading..." : "Upload Files"}
            </button>
          ) : null}
          {uploadMessage ? (
            <div
              id="upload-message"
              style={{
                marginTop: 10,
                padding: 10,
                borderRadius: 4,
                color: uploadMessage.startsWith("✅") ? "#28a745" : "#007bff",
              }}
            >
              {uploadMessage}
            </div>
          ) : null}
          <input
            type="hidden"
            id="baselinker_field_6397"
            name="baselinker_field_6397"
            value={uploadedUrls[0] ?? ""}
            readOnly
          />
          <input
            type="hidden"
            id="baselinker_field_6398"
            name="baselinker_field_6398"
            value={uploadedUrls[1] ?? ""}
            readOnly
          />
          <input
            type="hidden"
            id="uploaded_urls"
            name="uploaded_urls"
            value={uploadedUrls.length ? JSON.stringify(uploadedUrls) : ""}
            readOnly
          />
        </div>

        {error && !duplicate ? (
          <div className="alert alert-error">{error}</div>
        ) : null}
        {error && duplicate ? (
          <div className="alert alert-warning">{error}</div>
        ) : null}

        <div className="form-actions">
          <Link href={backHref} className="btn btn-secondary">
            {skippedTroubleshooting
              ? "Back to Issue Selection"
              : "Back to Troubleshooting"}
          </Link>
          <button
            type="submit"
            className="btn btn-primary"
            id="submit-warranty-claim"
            disabled={loading || selectedProducts.length === 0}
          >
            Submit Claim
          </button>
        </div>
      </form>
    </>
  );
}
