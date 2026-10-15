export function compactSku(sku: string) {
  return sku.trim().toLowerCase().replace(/[\s\-_]+/g, "");
}

export function indicatesNoWarranty(text: string) {
  const lower = text.toLowerCase().trim();
  const patterns = [
    "no warranty is provided",
    "no warranty",
    "we don't provide warranty",
    "warranty not available",
    "no warranty coverage",
    "not covered",
    "not eligible",
  ];
  return patterns.some((p) => lower.includes(p));
}
