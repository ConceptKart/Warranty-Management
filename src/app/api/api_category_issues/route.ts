import { makeCrudHandlers } from "@/lib/crud/make-route";
import * as issues from "@/lib/crud/category-issues";
import { asNumber } from "@/lib/crud/http";

export const runtime = "nodejs";

export const { GET, POST, PUT, DELETE } = makeCrudHandlers({
  readPerm: "view_all_tickets",
  writePerm: "edit_tickets",
  deleteIdMessage: "id is required.",
  list: async ({ page, limit, offset }) =>
    issues.listCategoryIssues(page, limit, offset),
  getById: (id) => issues.getCategoryIssueById(id),
  create: (body) => issues.createCategoryIssue(body),
  update: (body, url) => {
    const id = asNumber(url.searchParams.get("id"));
    return issues.updateCategoryIssue(id, body);
  },
  remove: (id) => issues.deleteCategoryIssue(id),
});
