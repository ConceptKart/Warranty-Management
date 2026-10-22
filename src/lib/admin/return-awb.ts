import { prisma } from "@/lib/db";

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
  if (value == null || value === "") return "—";

  let utc: Date | null = null;
  if (typeof value === "string") {
    const text = value.trim().replace("T", " ");
    const match = text.match(
      /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/,
    );
    if (match) {
      utc = new Date(
        Date.UTC(
          Number(match[1]),
          Number(match[2]) - 1,
          Number(match[3]),
          Number(match[4]),
          Number(match[5]),
          Number(match[6] ?? 0),
        ),
      );
    } else {
      const parsed = new Date(text);
      utc = Number.isNaN(parsed.getTime()) ? null : parsed;
    }
  } else {
    utc = Number.isNaN(value.getTime()) ? null : value;
  }

  if (!utc) return "—";

  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(utc);

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  const day = get("day");
  const month = get("month");
  const year = get("year");
  const hour = get("hour");
  const minute = get("minute");
  if (!day || !month || !year) return "—";
  return `${day} ${month} ${year} ${hour}:${minute}`;
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

export async function getReturnAwbFilterOptions(): Promise<ReturnAwbFilterOptions> {
  try {
    const [returnTypes, sources, conditions, companies] = await Promise.all([
      prisma.$queryRaw<Array<{ return_type: string }>>`
        SELECT DISTINCT return_type
        FROM return_inventory_sync
        WHERE return_type IS NOT NULL AND return_type != ''
        ORDER BY return_type ASC
      `,
      prisma.$queryRaw<Array<{ source: string }>>`
        SELECT DISTINCT source
        FROM return_inventory_sync
        WHERE source IS NOT NULL AND source != ''
        ORDER BY source ASC
      `,
      prisma.$queryRaw<Array<{ condition: string }>>`
        SELECT DISTINCT \`condition\`
        FROM return_inventory_sync
        WHERE \`condition\` IS NOT NULL AND \`condition\` != ''
        ORDER BY \`condition\` ASC
      `,
      prisma.$queryRaw<Array<{ company: string }>>`
        SELECT DISTINCT company
        FROM return_inventory_sync
        WHERE company IS NOT NULL AND company != ''
        ORDER BY company ASC
      `,
    ]);

    return {
      returnTypes: columnValues(returnTypes),
      sources: columnValues(sources),
      conditions: columnValues(conditions),
      companies: columnValues(companies),
    };
  } catch (error) {
    console.error("[getReturnAwbFilterOptions]", error);
    return { returnTypes: [], sources: [], conditions: [], companies: [] };
  }
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
  const awb = trimFilter(filters.awb_number);
  const orderId = trimFilter(filters.order_id);
  const sku = trimFilter(filters.sku);
  const ean = trimFilter(filters.ean);
  const returnType = trimFilter(filters.return_type);
  const source = trimFilter(filters.source);
  const condition = trimFilter(filters.condition);
  const company = trimFilter(filters.company);
  const awbLike = `%${awb}%`;
  const orderLike = `%${orderId}%`;
  const skuLike = `%${sku}%`;
  const eanLike = `%${ean}%`;

  try {
    const countRows = await prisma.$queryRaw<Array<{ c: bigint | number }>>`
      SELECT COUNT(*) AS c
      FROM return_inventory_sync
      WHERE (${awb} = '' OR awb_number LIKE ${awbLike})
        AND (${orderId} = '' OR order_id LIKE ${orderLike})
        AND (${sku} = '' OR sku LIKE ${skuLike})
        AND (${ean} = '' OR ean LIKE ${eanLike})
        AND (${returnType} = '' OR return_type = ${returnType})
        AND (${source} = '' OR source = ${source})
        AND (${condition} = '' OR \`condition\` = ${condition})
        AND (${company} = '' OR company = ${company})
    `;
    const total = toNumber(countRows[0]?.c);
    const totalPages = Math.max(1, Math.ceil((total || 0) / paging.perPage));
    const safePage = Math.min(paging.page, totalPages);
    const offset = (safePage - 1) * paging.perPage;

    const rows =
      total === 0
        ? []
        : await prisma.$queryRaw<ReturnAwbRow[]>`
            SELECT
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
            WHERE (${awb} = '' OR awb_number LIKE ${awbLike})
              AND (${orderId} = '' OR order_id LIKE ${orderLike})
              AND (${sku} = '' OR sku LIKE ${skuLike})
              AND (${ean} = '' OR ean LIKE ${eanLike})
              AND (${returnType} = '' OR return_type = ${returnType})
              AND (${source} = '' OR source = ${source})
              AND (${condition} = '' OR \`condition\` = ${condition})
              AND (${company} = '' OR company = ${company})
            ORDER BY id DESC
            LIMIT ${paging.perPage} OFFSET ${offset}
          `;

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
      error: "Unable to load Return AWB data.",
    };
  }
}
