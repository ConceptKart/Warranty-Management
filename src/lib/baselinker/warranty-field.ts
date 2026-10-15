/**
 * Live BaseLinker warranty from extra_field_1281 (PHP public/api/warranty.php).
 */

import { baselinkerCall } from "@/lib/cron/baselinker-client";
import { compactSku, indicatesNoWarranty } from "@/lib/portal/sku-normalize";

const DEFAULT_INVENTORY_ID = Number(
  process.env.BASELINKER_INVENTORY_ID?.trim() || "392",
);

const WARRANTY_FIELDS = ["extra_field_1281", "extra_field_8"] as const;

type ProductMap = Record<string, Record<string, unknown>>;

function textFromFields(textFields: unknown): string | null {
  if (!textFields || typeof textFields !== "object") return null;
  const fields = textFields as Record<string, unknown>;
  for (const key of WARRANTY_FIELDS) {
    const raw = fields[key];
    if (typeof raw === "string" && raw.trim()) return raw.trim();
  }
  for (const [key, raw] of Object.entries(fields)) {
    if (!key.startsWith("extra_field_")) continue;
    if (typeof raw === "string" && raw.trim() && !indicatesNoWarranty(raw)) {
      return raw.trim();
    }
  }
  return null;
}

async function getProductsData(
  inventoryId: number,
  productIds: Array<string | number>,
): Promise<ProductMap> {
  if (productIds.length === 0) return {};
  const response = await baselinkerCall(
    "getInventoryProductsData",
    {
      inventory_id: inventoryId,
      products: productIds.map(String),
    },
    { timeoutMs: 20_000 },
  );
  return (response.products as ProductMap) ?? {};
}

async function findProductIdBySku(
  sku: string,
  inventoryId: number,
): Promise<string | null> {
  const compact = compactSku(sku);
  if (!compact) return null;
  const response = await baselinkerCall(
    "getInventoryProductsList",
    {
      inventory_id: inventoryId,
      filter_sku: sku.trim(),
      page: 1,
      limit: 1000,
      filter_limit: 1000,
    },
    { timeoutMs: 20_000 },
  );
  const products = (response.products as ProductMap) ?? {};
  for (const [id, product] of Object.entries(products)) {
    const productSku = String(product.sku ?? "");
    if (!productSku) continue;
    if (productSku === sku.trim() || compactSku(productSku) === compact) {
      return id;
    }
  }
  return null;
}

/**
 * Returns the BaseLinker warranty text, or null if missing / "no warranty".
 * Never throws — portal verify must still succeed if BaseLinker is down.
 */
export async function fetchBaselinkerWarrantyText(input: {
  sku: string;
  productId?: string | number | null;
}): Promise<string | null> {
  const sku = input.sku.trim();
  if (!sku && (input.productId == null || input.productId === "" || Number(input.productId) === 0)) {
    return null;
  }

  try {
    const inventoryId = DEFAULT_INVENTORY_ID;
    let productId =
      input.productId != null && String(input.productId).trim() && Number(input.productId) !== 0
        ? String(input.productId)
        : null;
    if (!productId && sku) {
      productId = await findProductIdBySku(sku, inventoryId);
    }
    if (!productId) return null;

    const details = await getProductsData(inventoryId, [productId]);
    const product = details[productId];
    if (!product) return null;

    const parentId = product.parent_id ?? product.parent_product_id;
    if (parentId != null && String(parentId).trim() && Number(parentId) !== 0) {
      const parentMap = await getProductsData(inventoryId, [parentId as string | number]);
      const parentText = textFromFields(
        parentMap[String(parentId)]?.text_fields,
      );
      if (parentText && !indicatesNoWarranty(parentText)) return parentText;
    }

    const own = textFromFields(product.text_fields);
    if (!own || indicatesNoWarranty(own)) return null;
    return own;
  } catch (error) {
    console.error("[fetchBaselinkerWarrantyText]", error);
    return null;
  }
}

export async function fetchBaselinkerWarrantyForProductIds(
  productIds: Array<string | number>,
): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  const ids = productIds.map(String).filter((id) => id && id !== "0");
  if (ids.length === 0) return found;

  try {
    const inventoryId = DEFAULT_INVENTORY_ID;
    const details = await getProductsData(inventoryId, ids);
    const parentIds = new Set<string>();
    for (const product of Object.values(details)) {
      const parentId = product.parent_id ?? product.parent_product_id;
      if (parentId != null && String(parentId).trim() && Number(parentId) !== 0) {
        parentIds.add(String(parentId));
      }
    }
    const parents =
      parentIds.size > 0
        ? await getProductsData(inventoryId, [...parentIds])
        : {};

    for (const [id, product] of Object.entries(details)) {
      const parentId = product.parent_id ?? product.parent_product_id;
      const parentText =
        parentId != null
          ? textFromFields(parents[String(parentId)]?.text_fields)
          : null;
      const own = textFromFields(product.text_fields);
      const text =
        parentText && !indicatesNoWarranty(parentText)
          ? parentText
          : own && !indicatesNoWarranty(own)
            ? own
            : null;
      if (text) found.set(id, text);
    }
  } catch (error) {
    console.error("[fetchBaselinkerWarrantyForProductIds]", error);
  }
  return found;
}
