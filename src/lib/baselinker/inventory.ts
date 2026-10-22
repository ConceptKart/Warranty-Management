/**
 * BaseLinker inventory helpers for replacement EAN lookup + unit replace (IGI).
 * Ports BaseLinkerService inventory methods used by ticket-details / warranty_unit_replace.
 */

import { baselinkerCall } from "@/lib/cron/baselinker-client";

const DEFAULT_INVENTORY_ID = Number(
  process.env.BASELINKER_INVENTORY_ID?.trim() || "392",
);

/** PHP ticket-details / warranty_unit_replace: SVPL + CKPL only. */
export const SVPL_WAREHOUSE_ID = 9000461;
export const CKPL_WAREHOUSE_ID = 9002929;
const SELLING_WAREHOUSE_IDS = [
  SVPL_WAREHOUSE_ID,
  CKPL_WAREHOUSE_ID,
] as const;
const WAREHOUSE_KEYS = [
  `bl_${SVPL_WAREHOUSE_ID}`,
  `bl_${CKPL_WAREHOUSE_ID}`,
] as const;

/** PHP ticket-details.php when BaseLinker returns stock but no bin. */
export const DEFAULT_WAREHOUSE_LOCATIONS: Record<number, string> = {
  [SVPL_WAREHOUSE_ID]: "F1-AC1R1",
  [CKPL_WAREHOUSE_ID]: "F6-BR2C3",
};

function warehouseKeyAliases(warehouseId: number) {
  return [`bl_${warehouseId}`, String(warehouseId), warehouseId];
}

function readWarehouseValue(
  data: Record<string, unknown> | unknown,
  warehouseId: number,
): unknown {
  if (!data || typeof data !== "object" || Array.isArray(data)) return undefined;
  const record = data as Record<string, unknown>;
  for (const key of warehouseKeyAliases(warehouseId)) {
    if (record[key as string] != null && record[key as string] !== "") {
      return record[key as string];
    }
  }
  return undefined;
}

function parseLocations(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.map((item) => String(item).trim()).filter(Boolean);
  }
  if (typeof raw === "string" && raw.trim()) {
    return raw
      .split(";")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function productFromMap(map: ProductMap, id: number | string) {
  return (
    map[String(id)] ??
    map[id as string] ??
    Object.entries(map).find(([key]) => String(key) === String(id))?.[1] ??
    null
  );
}

export type BaselinkerProductMatch = {
  product_id: number | string;
  variant_id: number | string | null;
  name: string;
  sku: string;
  ean: string;
  price?: number;
  quantity?: number;
};

export type WarehouseStock = {
  warehouse_key: string;
  warehouse_id: number;
  stock: number;
  locations: string[];
};

type ProductMap = Record<string, Record<string, unknown>>;

function sumStock(stock: unknown): number {
  if (Array.isArray(stock) || (stock && typeof stock === "object")) {
    const s = stock as Record<string, unknown>;
    return (
      Number(readWarehouseValue(s, SVPL_WAREHOUSE_ID) ?? 0) +
      Number(readWarehouseValue(s, CKPL_WAREHOUSE_ID) ?? 0)
    );
  }
  return Number(stock ?? 0);
}

function extractPrice(
  variant: Record<string, unknown>,
  detailData: Record<string, unknown>,
  basicProduct: Record<string, unknown>,
): number {
  const variantPrices = variant.prices as Record<string, unknown> | undefined;
  if (variantPrices && typeof variantPrices === "object") {
    return Number(
      variantPrices["851"] ??
        variantPrices["389"] ??
        Object.values(variantPrices)[0] ??
        0,
    );
  }
  const detailPrices = detailData.prices as Record<string, unknown> | undefined;
  if (detailPrices && typeof detailPrices === "object") {
    return Number(
      detailPrices["851"] ??
        detailPrices["389"] ??
        Object.values(detailPrices)[0] ??
        0,
    );
  }
  return Number(
    variant.price_brutto ??
      detailData.price_brutto ??
      basicProduct.price_brutto ??
      basicProduct.price ??
      0,
  );
}

async function getInventoryProductsList(
  inventoryId: number,
  page: number,
  limit = 1000,
): Promise<ProductMap> {
  const response = await baselinkerCall(
    "getInventoryProductsList",
    {
      inventory_id: inventoryId,
      page,
      filter_limit: limit,
    },
    { timeoutMs: 60_000 },
  );
  return (response.products as ProductMap) ?? {};
}

async function getInventoryProductsData(
  inventoryId: number,
  productIds: Array<string | number>,
): Promise<ProductMap> {
  const response = await baselinkerCall(
    "getInventoryProductsData",
    {
      inventory_id: inventoryId,
      products: productIds.map(String),
    },
    { timeoutMs: 60_000 },
  );
  return (response.products as ProductMap) ?? {};
}

/**
 * Scan inventory pages for a product/variant matching EAN.
 * NOTE: Do not use filter_ean — PHP notes it returns 0 results.
 */
export async function getInventoryProductByEan(
  ean: string,
  inventoryId = DEFAULT_INVENTORY_ID,
  maxPages = 30,
): Promise<BaselinkerProductMatch | null> {
  const target = ean.trim();
  if (!target) return null;

  let page = 1;
  while (page <= maxPages) {
    const products = await getInventoryProductsList(inventoryId, page, 1000);
    const productIds = Object.keys(products);
    if (productIds.length === 0) break;

    const detailProducts = await getInventoryProductsData(
      inventoryId,
      productIds,
    );

    for (const productId of productIds) {
      const product = products[productId] ?? {};
      const detailData = detailProducts[productId] ?? {};
      const basicEan = String(product.ean ?? "");
      const detailEan = String(detailData.ean ?? "");

      if (
        (basicEan && basicEan === target) ||
        (detailEan && detailEan === target)
      ) {
        return {
          product_id: productId,
          variant_id: (detailData.variant_id as string | number | null) ?? null,
          name: String(detailData.name ?? product.name ?? ""),
          sku: String(detailData.sku ?? product.sku ?? ""),
          ean: detailEan || basicEan,
          price: extractPrice({}, detailData, product),
          quantity: sumStock(product.stock),
        };
      }

      const variants = detailData.variants as ProductMap | undefined;
      if (variants && typeof variants === "object") {
        for (const [variantId, variant] of Object.entries(variants)) {
          const variantEan = String(variant.ean ?? "");
          if (variantEan && variantEan === target) {
            return {
              product_id: productId,
              variant_id: variantId,
              name: String(
                variant.name ?? detailData.name ?? product.name ?? "",
              ),
              sku: String(variant.sku ?? detailData.sku ?? product.sku ?? ""),
              ean: variantEan,
              price: extractPrice(variant, detailData, product),
              quantity: sumStock(variant.stock ?? product.stock),
            };
          }
        }
      }
    }

    if (productIds.length < 1000) break;
    page += 1;
  }

  return null;
}

export function extractWarehouseStockLocations(
  data: Record<string, unknown>,
): Record<string, { stock: number; locations: string[]; warehouse_id: number }> {
  const stockData = data.stock;
  const locationData = data.locations;
  const result: Record<
    string,
    { stock: number; locations: string[]; warehouse_id: number }
  > = {};

  for (const warehouseId of SELLING_WAREHOUSE_IDS) {
    const qty = Number(readWarehouseValue(stockData, warehouseId) ?? 0);
    let locations = parseLocations(readWarehouseValue(locationData, warehouseId));
    if (qty > 0 && locations.length === 0) {
      const fallback = DEFAULT_WAREHOUSE_LOCATIONS[warehouseId];
      if (fallback) locations = [fallback];
    }
    result[`bl_${warehouseId}`] = {
      stock: qty,
      locations,
      warehouse_id: warehouseId,
    };
  }
  return result;
}

export async function getProductStockAndLocations(
  productId: number,
  variantId: number | null = null,
  inventoryId = DEFAULT_INVENTORY_ID,
): Promise<Record<string, { stock: number; locations: string[]; warehouse_id: number }>> {
  if (variantId && variantId !== 0) {
    const byVariant = await getInventoryProductsData(inventoryId, [variantId]);
    const variantData = productFromMap(byVariant, variantId);
    if (variantData) {
      return extractWarehouseStockLocations(variantData);
    }

    if (productId) {
      const byProduct = await getInventoryProductsData(inventoryId, [
        productId,
      ]);
      const productData = productFromMap(byProduct, productId);
      if (productData) {
        const variants = productData.variants as ProductMap | undefined;
        const nested =
          variants?.[String(variantId)] ??
          productFromMap((variants ?? {}) as ProductMap, variantId);
        if (nested) {
          return extractWarehouseStockLocations(nested);
        }
      }
    }
    return {};
  }

  if (!productId) return {};
  const byProduct = await getInventoryProductsData(inventoryId, [productId]);
  const productData = productFromMap(byProduct, productId);
  if (!productData) return {};
  return extractWarehouseStockLocations(productData);
}

export function formatWarehousesForApi(
  stockInfo: Record<
    string,
    { stock: number; locations: string[]; warehouse_id: number }
  >,
): WarehouseStock[] {
  const warehouses: WarehouseStock[] = [];
  for (const wh of WAREHOUSE_KEYS) {
    const whData = stockInfo[wh];
    if (!whData) continue;
    if (whData.stock > 0 || whData.locations.length > 0) {
      warehouses.push({
        warehouse_key: wh,
        warehouse_id: whData.warehouse_id,
        stock: whData.stock,
        locations: whData.locations,
      });
    }
  }
  return warehouses;
}

export async function createWarrantyReplacementDocument(
  warehouseId: number,
  notes: string,
  inventoryId = DEFAULT_INVENTORY_ID,
): Promise<{ success: boolean; document_id?: number; error?: string }> {
  try {
    const response = await baselinkerCall(
      "addInventoryDocument",
      {
        inventory_id: inventoryId,
        warehouse_id: warehouseId,
        document_type: 3, // IGI
        date_add: Math.floor(Date.now() / 1000),
        ...(notes ? { notes } : {}),
      },
      { timeoutMs: 60_000 },
    );
    const documentId = Number(response.document_id);
    if (!documentId) {
      return { success: false, error: "No document_id returned" };
    }
    return { success: true, document_id: documentId };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : "Failed to create document",
    };
  }
}

export async function addInventoryDocumentItems(
  documentId: number,
  items: Array<{
    product_id?: number;
    variant_id?: number | null;
    quantity: number;
    location_name?: string;
  }>,
): Promise<{ success: boolean; error?: string }> {
  try {
    const apiItems = items.map((item) => {
      if (!item.quantity || item.quantity <= 0) {
        throw new Error("Each item must have a positive quantity");
      }
      const productId =
        item.variant_id && item.variant_id !== 0
          ? item.variant_id
          : item.product_id;
      if (!productId) {
        throw new Error("Each item must have either product_id or variant_id");
      }
      const row: Record<string, unknown> = {
        product_id: Number(productId),
        quantity: Number(item.quantity),
      };
      if (item.location_name) row.location_name = item.location_name;
      return row;
    });

    await baselinkerCall(
      "addInventoryDocumentItems",
      {
        document_id: documentId,
        items: apiItems,
      },
      { timeoutMs: 60_000 },
    );
    return { success: true };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : "Failed to add items",
    };
  }
}

export async function setInventoryDocumentStatusConfirmed(
  documentId: number,
): Promise<{ success: boolean; error?: string }> {
  try {
    await baselinkerCall(
      "setInventoryDocumentStatusConfirmed",
      { document_id: documentId },
      { timeoutMs: 60_000 },
    );
    return { success: true };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : "Failed to confirm document",
    };
  }
}
