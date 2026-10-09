import { makeCrudHandlers } from "@/lib/crud/make-route";
import * as products from "@/lib/crud/bl-products";

export const runtime = "nodejs";

export const { GET, POST, PUT, DELETE } = makeCrudHandlers({
  readPerm: "view_all_tickets",
  writePerm: "edit_tickets",
  deleteIdMessage: "id is required.",
  list: async ({ page, limit, offset }) =>
    products.listBlProducts(page, limit, offset),
  getById: (id) => products.getBlProductById(id),
  create: (body) => products.createBlProduct(body),
  update: (body) => products.updateBlProduct(body),
  remove: (id) => products.deleteBlProduct(id),
});
