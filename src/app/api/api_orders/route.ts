import { makeCrudHandlers } from "@/lib/crud/make-route";
import * as orders from "@/lib/crud/orders";

export const runtime = "nodejs";

export const { GET, POST, PUT, DELETE } = makeCrudHandlers({
  readPerm: "view_all_tickets",
  writePerm: "edit_tickets",
  deletePerm: "delete_tickets",
  deleteIdMessage: "order_id is required.",
  list: async ({ page, limit, offset }) =>
    orders.listOrders(page, limit, offset),
  getById: (id) => orders.getOrderById(id),
  create: (body) => orders.createOrder(body),
  update: (body) => orders.updateOrder(body),
  remove: (id) => orders.deleteOrder(id),
});
