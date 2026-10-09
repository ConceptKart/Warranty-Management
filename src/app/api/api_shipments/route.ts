import { makeCrudHandlers } from "@/lib/crud/make-route";
import * as shipments from "@/lib/crud/shipments";

export const runtime = "nodejs";

export const { GET, POST, PUT, DELETE } = makeCrudHandlers({
  readPerm: ["view_all_tickets", "view_shipment_info", "manage_shipments"],
  writePerm: ["manage_shipments", "assign_awb"],
  deleteIdMessage: "shipment_id is required.",
  list: async ({ page, limit, offset }) =>
    shipments.listShipments(page, limit, offset),
  getById: (id) => shipments.getShipmentById(id),
  getExtra: async (url) => {
    const awb = url.searchParams.get("awb")?.trim();
    if (!awb) return undefined;
    return shipments.getShipmentByAwb(awb);
  },
  create: (body) => shipments.createShipment(body),
  update: (body) => shipments.updateShipment(body),
  remove: (id) => shipments.deleteShipment(id),
});
