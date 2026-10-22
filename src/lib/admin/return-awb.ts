import { prisma } from "@/lib/db";
import { formatUtcToIstReturnAwb } from "@/lib/datetime/ist";

export const RETURN_AWB_PER_PAGE = [10, 25, 50, 100] as const;

export type ReturnAwbFilters = {
  awb_number?: string;
  order_id?: string;
  sku?: string;
  ean?: string;
  return_type?: string;
  source?: string;
  condition?: string;
  company?: string;
};

export type ReturnAwbRow = {
  id: number;
  awb_number: string | null;
  order_id: string | null;
  sku: string | null;
  ean: string | null;
  quantity: number | string | null;
  admin_received_qty: number | string | null;
  return_type: string | null;
  return_channel: string | null;
  source: string | null;
  condition: string | null;
  company: string | null;
  created_at: Date | string | null;
};

export type ReturnAwbFilterOptions = {
  returnTypes: string[];
  sources: string[];
  conditions: string[];
  companies: string[];
};

function trimFilter(value: string | undefined) {
  return (value ?? "").trim();
}

function toNumber(value: unknown): number {
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number") return value;
  return Number(value ?? 0);
}

export function resolveReturnAwbPaging(
  pageRaw: string | number | undefined,
  perPageRaw: string | number | undefined,
) {
  const requested = Number(perPageRaw ?? 10);
  const perPage = (RETURN_AWB_PER_PAGE as readonly number[]).includes(requested)
    ? requested
    : 10;
  const page = Math.max(1, Number(pageRaw || 1) || 1);
  return { page, perPage };
}

/** PHP formatIndianDateTime: naive DATETIME is UTC, shown as IST `d M Y H:i`. */
export function formatReturnAwbIst(
  value: Date | string | null | undefined,
): string {
  return formatUtcToIstReturnAwb(value);
}

export function returnAwbConditionClass(condition: string | null | undefined) {
  const value = (condition ?? "").trim().toLowerCase();
  if (["good", "new", "sellable", "ok"].includes(value)) return "bg-success";
  if (["damaged", "damage", "bad"].includes(value)) return "bg-danger";
  return "bg-secondary";
}

function columnValues(rows: Array<Record<string, unknown>>) {
  return rows
    .map((row) => String(Object.values(row)[0] ?? "").trim())
    .filter(Boolean);
}

function loadErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (/doesn't exist|not found|unknown table|no such table/i.test(message)) {
    return "Return inventory table (return_inventory_sync) was not found on this database.";
  }
  if (/condition/i.test(message) && /syntax|reserved/i.test(message)) {
    return "Unable to load Return AWB data (condition column query failed).";
  }
  return "Unable to load Return AWB data.";
}

async function distinctColumn(columnSql: string) {
  try {
    const rows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT DISTINCT ${columnSql} AS value
       FROM return_inventory_sync
       WHERE ${columnSql} IS NOT NULL AND ${columnSql} != ''
       ORDER BY ${columnSql} ASC`,
    );
    return columnValues(rows);
  } catch (error) {
    console.error("[getReturnAwbFilterOptions]", columnSql, error);
    return [];
  }
}

export async function getReturnAwbFilterOptions(): Promise<ReturnAwbFilterOptions> {
  const [returnTypes, sources, conditions, companies] = await Promise.all([
    distinctColumn("return_type"),
    distinctColumn("source"),
    distinctColumn("`condition`"),
    distinctColumn("company"),
  ]);
  return { returnTypes, sources, conditions, companies };
}

function buildReturnAwbWhere(filters: ReturnAwbFilters) {
  const where: string[] = [];
  const params: string[] = [];
  const like = (column: string, value: string) => {
    where.push(`${column} LIKE ?`);
    params.push(`%${value}%`);
  };
  const exact = (column: string, value: string) => {
    where.push(`${column} = ?`);
    params.push(value);
  };

  const awb = trimFilter(filters.awb_number);
  const orderId = trimFilter(filters.order_id);
  const sku = trimFilter(filters.sku);
  const ean = trimFilter(filters.ean);
  const returnType = trimFilter(filters.return_type);
  const source = trimFilter(filters.source);
  const condition = trimFilter(filters.condition);
  const company = trimFilter(filters.company);

  if (awb) like("awb_number", awb);
  if (orderId) like("order_id", orderId);
  if (sku) like("sku", sku);
  if (ean) like("ean", ean);
  if (returnType) exact("return_type", returnType);
  if (source) exact("source", source);
  if (condition) exact("`condition`", condition);
  if (company) exact("company", company);

  return {
    sql: where.length ? `WHERE ${where.join(" AND ")}` : "",
    params,
  };
}

export async function getReturnAwbRows(
  filters: ReturnAwbFilters = {},
  page = 1,
  perPage = 10,
): Promise<{
  rows: ReturnAwbRow[];
  total: number;
  page: number;
  per_page: number;
  total_pages: number;
  error: string | null;
}> {
  const paging = resolveReturnAwbPaging(page, perPage);
  const { sql: whereSql, params } = buildReturnAwbWhere(filters);

  try {
    const countRows = await prisma.$queryRawUnsafe<
      Array<{ c: bigint | number }>
    >(
      `SELECT COUNT(*) AS c FROM return_inventory_sync ${whereSql}`,
      ...params,
    );
    const total = toNumber(countRows[0]?.c);
    const totalPages = Math.max(1, Math.ceil((total || 0) / paging.perPage));
    const safePage = Math.min(paging.page, totalPages);
    const offset = (safePage - 1) * paging.perPage;

    const rows =
      total === 0
        ? []
        : await prisma.$queryRawUnsafe<ReturnAwbRow[]>(
            `SELECT
              id,
              awb_number,
              order_id,
              sku,
              ean,
              quantity,
              admin_received_qty,
              return_type,
              return_channel,
              source,
              \`condition\`,
              company,
              created_at
            FROM return_inventory_sync
            ${whereSql}
            ORDER BY id DESC
            LIMIT ? OFFSET ?`,
            ...params,
            paging.perPage,
            offset,
          );

    return {
      rows,
      total,
      page: safePage,
      per_page: paging.perPage,
      total_pages: totalPages,
      error: null,
    };
  } catch (error) {
    console.error("[getReturnAwbRows]", error);
    return {
      rows: [],
      total: 0,
      page: 1,
      per_page: paging.perPage,
      total_pages: 1,
      error: loadErrorMessage(error),
    };
  }
}
