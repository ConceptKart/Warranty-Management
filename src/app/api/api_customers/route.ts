import { makeCrudHandlers } from "@/lib/crud/make-route";
import * as customers from "@/lib/crud/customers";

export const runtime = "nodejs";

export const { GET, POST, PUT, DELETE } = makeCrudHandlers({
  readPerm: "view_all_tickets",
  writePerm: "edit_tickets",
  deletePerm: "delete_tickets",
  deleteIdMessage: "customer_id is required.",
  list: async ({ page, limit, offset }) =>
    customers.listCustomers(page, limit, offset),
  getById: (id) => customers.getCustomerById(id),
  create: (body) => customers.createCustomer(body),
  update: (body) => customers.updateCustomer(body),
  remove: (id) => customers.deleteCustomer(id),
});
