import { makeCrudHandlers } from "@/lib/crud/make-route";
import * as users from "@/lib/crud/users";

export const runtime = "nodejs";

export const { GET, POST, PUT, DELETE } = makeCrudHandlers({
  readPerm: "manage_users",
  writePerm: "manage_users",
  listAsTotal: true,
  deleteIdMessage: "user_id is required.",
  list: async () => users.listUsers(),
  getById: (id) => users.getUserById(id),
  create: (body) => users.createUser(body),
  update: (body) => users.updateUser(body),
  remove: (id) => users.deleteUser(id),
});
