import { makeCrudHandlers } from "@/lib/crud/make-route";
import * as baseorders from "@/lib/crud/baseorders";

export const runtime = "nodejs";

export const { GET, POST, PUT, DELETE } = makeCrudHandlers({
  readPerm: "view_all_tickets",
  writePerm: "edit_tickets",
  deleteIdMessage: "id is required.",
  list: async ({ page, limit, offset }) => {
    const result = await baseorders.listBaseorders(page, limit, offset);
    if ("error" in result && result.error) {
      return { error: result.error, data: [], totalRecords: 0, page, limit };
    }
    return {
      totalRecords: result.totalRecords ?? 0,
      data: result.data ?? [],
      page: result.page ?? page,
      limit: result.limit ?? limit,
    };
  },
  getById: (id) => baseorders.getBaseorderById(id),
  getExtra: async (url) => {
    const ext =
      url.searchParams.get("external_order_id") ??
      url.searchParams.get("shop_order_id");
    if (!ext) return undefined;
    return baseorders.getBaseorderByExternal(ext);
  },
  create: (body) => baseorders.createBaseorder(body),
  update: (body) => baseorders.updateBaseorder(body),
  remove: (id) => baseorders.deleteBaseorder(id),
});
