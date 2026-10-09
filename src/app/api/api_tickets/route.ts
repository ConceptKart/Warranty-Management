import { makeCrudHandlers } from "@/lib/crud/make-route";
import * as tickets from "@/lib/crud/tickets";

export const runtime = "nodejs";

export const { GET, POST, PUT, DELETE } = makeCrudHandlers({
  readPerm: "view_all_tickets",
  writePerm: "edit_tickets",
  deletePerm: "delete_tickets",
  deleteIdMessage: "ticket_id is required.",
  list: async ({ page, limit, offset, url }) =>
    tickets.listTickets(page, limit, offset, url.searchParams.get("search")),
  getById: (id) => tickets.getTicketById(id),
  create: (body) => tickets.createTicket(body),
  update: (body) => tickets.updateTicket(body),
  remove: (id) => tickets.deleteTicket(id),
});
