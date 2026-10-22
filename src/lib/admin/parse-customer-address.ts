/** Indian states shown on Assign AWB (PHP ticket-details select). */
export const INDIAN_STATES = [
  "Andhra Pradesh",
  "Arunachal Pradesh",
  "Assam",
  "Bihar",
  "Chhattisgarh",
  "Delhi",
  "Goa",
  "Gujarat",
  "Haryana",
  "Himachal Pradesh",
  "Jharkhand",
  "Karnataka",
  "Kerala",
  "Madhya Pradesh",
  "Maharashtra",
  "Manipur",
  "Meghalaya",
  "Mizoram",
  "Nagaland",
  "Odisha",
  "Punjab",
  "Rajasthan",
  "Sikkim",
  "Tamil Nadu",
  "Telangana",
  "Tripura",
  "Uttar Pradesh",
  "Uttarakhand",
  "West Bengal",
] as const;

export type ParsedCustomerAddress = {
  address: string;
  city: string;
  state: string;
  pincode: string;
};

/**
 * Split a stored customer address blob into street / city / state / PIN.
 * Amazon addresses often embed the 6-digit PIN in the last segment.
 */
export function parseCustomerAddress(rawAddress: string): ParsedCustomerAddress {
  const parts = rawAddress
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  let pincode = "";
  let state = "";
  let city = "";
  let address = rawAddress.trim();

  for (let i = parts.length - 1; i >= 0; i--) {
    const standalone = parts[i]!;
    const embedded = standalone.match(/\b(\d{6})\b/);
    if (/^\d{6}$/.test(standalone) || embedded) {
      pincode = /^\d{6}$/.test(standalone) ? standalone : embedded![1]!;
      state = parts[i - 1] ?? "";
      city = parts[i - 2] ?? "";
      address = parts.slice(0, Math.max(0, i - 2)).join(", ");
      break;
    }
  }

  if (!/^\d{6}$/.test(pincode) && parts.length >= 3) {
    const last = parts[parts.length - 1]!;
    const embedded = last.match(/\b(\d{6})\b/);
    pincode = embedded?.[1] ?? last;
    state = parts[parts.length - 2]!;
    city = parts[parts.length - 3]!;
    address = parts.slice(0, parts.length - 3).join(", ");
  }

  return { address, city, state, pincode };
}

/** PHP fillStateSelect: match option text/value case-insensitively. */
export function matchIndianState(raw: string, states: readonly string[] = INDIAN_STATES) {
  const needle = raw.trim().toLowerCase();
  if (!needle) return "";
  return (
    states.find(
      (state) =>
        state.toLowerCase() === needle ||
        state.toLowerCase().replace(/\s+/g, "") === needle.replace(/\s+/g, ""),
    ) ?? ""
  );
}
