/**
 * Warranty unit replacement via BaseLinker IGI documents
 * (ports public/api/warranty_unit_replace.php).
 */

import {
  addInventoryDocumentItems,
  createWarrantyReplacementDocument,
  formatWarehousesForApi,
  getProductStockAndLocations,
  setInventoryDocumentStatusConfirmed,
  type WarehouseStock,
} from "@/lib/baselinker/inventory";

export async function getUnitReplaceStock(
  productId: number,
  variantId: number | null,
): Promise<{
  success: boolean;
  error?: string;
  product_id?: number;
  variant_id?: number | null;
  warehouses?: WarehouseStock[];
}> {
  if (!productId && !variantId) {
    return {
      success: false,
      error: "Either product_id or variant_id is required",
    };
  }

  try {
    const stockInfo = await getProductStockAndLocations(
      productId,
      variantId && variantId !== 0 ? variantId : null,
    );
    return {
      success: true,
      product_id: productId,
      variant_id: variantId,
      warehouses: formatWarehousesForApi(stockInfo),
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : "Failed to load stock",
    };
  }
}

export async function replaceUnit(input: {
  productId: number;
  variantId: number | null;
  warehouseId: number;
  locationName: string;
  orderId?: string;
  ticketId?: string | number;
  ticketNumber?: string;
}): Promise<{
  success: boolean;
  error?: string;
  message?: string;
  document_id?: number;
  location?: string;
}> {
  const productId = input.productId || 0;
  const variantId =
    input.variantId && input.variantId !== 0 ? input.variantId : null;
  const warehouseId = input.warehouseId;
  const locationName = input.locationName.trim();

  if (!productId && !variantId) {
    return {
      success: false,
      error: "Either product_id or variant_id is required",
    };
  }
  if (!warehouseId) {
    return { success: false, error: "warehouse_id is required" };
  }
  if (!locationName) {
    return { success: false, error: "location_name is required" };
  }

  const notes: string[] = [];
  if (input.orderId) notes.push(`Order #${input.orderId}`);
  if (input.ticketNumber) notes.push(`Ticket: ${input.ticketNumber}`);
  notes.push("unit replaced");
  const notesStr = notes.join(" | ");

  const docResult = await createWarrantyReplacementDocument(
    warehouseId,
    notesStr,
  );
  if (!docResult.success || !docResult.document_id) {
    return {
      success: false,
      error: `Failed to create inventory document: ${docResult.error ?? "Unknown error"}`,
    };
  }

  const documentId = docResult.document_id;
  const itemsResult = await addInventoryDocumentItems(documentId, [
    {
      product_id: productId,
      variant_id: variantId,
      quantity: 1,
      location_name: locationName,
    },
  ]);

  if (!itemsResult.success) {
    return {
      success: false,
      error: `Failed to add item to document: ${itemsResult.error ?? "Unknown error"}`,
      document_id: documentId,
    };
  }

  const confirmResult = await setInventoryDocumentStatusConfirmed(documentId);
  if (!confirmResult.success) {
    return {
      success: false,
      error: `Failed to confirm document: ${confirmResult.error ?? "Unknown error"}`,
      document_id: documentId,
      location: locationName,
    };
  }

  return {
    success: true,
    message: `Unit replaced successfully. Document ID: ${documentId}`,
    document_id: documentId,
    location: locationName,
  };
}
