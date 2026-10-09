/**
 * Port of public/js/script.js validateSelectedProductsWarranty.
 * Blocks Website warranty claims when any selected product is expired
 * or has no warranty. Amazon and 10-day replacement always allowed.
 */

export type WarrantyGateProduct = {
  name?: string;
  sku?: string;
  warranty_status?: string;
  warranty_months?: number;
};

export function validateSelectedProductsWarranty(input: {
  products: WarrantyGateProduct[];
  isAmazon: boolean;
  isReplacement: boolean;
}): { ok: boolean; message: string } {
  if (input.isAmazon || input.isReplacement || input.products.length === 0) {
    return { ok: true, message: "" };
  }

  const expired: string[] = [];
  const noWarranty: string[] = [];

  for (const p of input.products) {
    const name = p.name || p.sku || "Selected product";
    if (p.warranty_status === "expired_by_date") {
      expired.push(name);
      continue;
    }
    if ((p.warranty_months ?? 0) === 0) {
      noWarranty.push(name);
    }
  }

  if (expired.length === 0 && noWarranty.length === 0) {
    return { ok: true, message: "" };
  }

  const parts: string[] = [];
  if (expired.length > 0) {
    const list = formatNameList(expired);
    parts.push(
      `${list} ${expired.length === 1 ? "has" : "have"} expired warranty`,
    );
  }
  if (noWarranty.length > 0) {
    const list = formatNameList(noWarranty);
    parts.push(
      `${list} ${noWarranty.length === 1 ? "has" : "have"} no warranty coverage`,
    );
  }

  return {
    ok: false,
    message: `Cannot proceed: ${parts.join(" and ")}. Please select only products with valid warranty to continue.`,
  };
}

function formatNameList(names: string[]) {
  if (names.length === 1) return `"${names[0]}"`;
  return (
    names
      .slice(0, -1)
      .map((n) => `"${n}"`)
      .join(", ") + ` and "${names[names.length - 1]}"`
  );
}
