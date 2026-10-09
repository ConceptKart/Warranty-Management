import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";

export type CrudOkList = {
  status: true;
  page?: number;
  limit?: number;
  total_records?: number;
  total_pages?: number;
  total?: number;
  data: unknown;
};

export type CrudOkOne = {
  status: true;
  data: unknown;
};

export type CrudFail = {
  status: false;
  message: string;
};

export function okList(
  data: unknown,
  meta?: {
    page?: number;
    limit?: number;
    totalRecords?: number;
    total?: number;
  },
): NextResponse {
  const body: CrudOkList = { status: true, data };
  if (meta?.total != null) body.total = meta.total;
  if (meta?.page != null) {
    body.page = meta.page;
    body.limit = meta.limit ?? 20;
    body.total_records = meta.totalRecords ?? 0;
    body.total_pages = Math.max(
      1,
      Math.ceil((meta.totalRecords ?? 0) / (meta.limit || 20)),
    );
  }
  return NextResponse.json(body);
}

export function okOne(data: unknown): NextResponse {
  return NextResponse.json({ status: true, data } satisfies CrudOkOne);
}

export function fail(message: string, status = 400): NextResponse {
  return NextResponse.json({ status: false, message } satisfies CrudFail, {
    status,
  });
}

export function parsePageLimit(url: URL, defaultLimit = 20) {
  const page = Math.max(1, Number(url.searchParams.get("page") || 1) || 1);
  const rawLimit = Number(url.searchParams.get("limit") || defaultLimit) || defaultLimit;
  const limit = Math.min(200, Math.max(1, rawLimit));
  const offset = (page - 1) * limit;
  return { page, limit, offset };
}

export function idFromRequest(url: URL, body: Record<string, unknown> | null) {
  const q =
    url.searchParams.get("id") ??
    url.searchParams.get("ticket_id") ??
    url.searchParams.get("user_id") ??
    url.searchParams.get("order_id") ??
    url.searchParams.get("customer_id") ??
    url.searchParams.get("shipment_id");
  if (q != null && q !== "") {
    const n = Number(q);
    if (Number.isFinite(n)) return n;
  }
  if (!body) return null;
  for (const key of [
    "id",
    "ticket_id",
    "user_id",
    "order_id",
    "customer_id",
    "shipment_id",
    "status_id",
  ]) {
    if (body[key] != null && body[key] !== "") {
      const n = Number(body[key]);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

export async function readJsonBody(
  request: Request,
): Promise<Record<string, unknown> | null> {
  try {
    const text = await request.text();
    if (!text.trim()) return {};
    const parsed = JSON.parse(text) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return null;
  }
}

/** Serialize Date / Decimal / BigInt for PHP-like JSON. */
export function serializeRow<T extends Record<string, unknown>>(row: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (v instanceof Date) {
      out[k] = formatMysqlDatetime(v);
    } else if (typeof v === "bigint") {
      out[k] = Number(v);
    } else if (v != null && typeof v === "object" && "toNumber" in v) {
      out[k] = (v as { toNumber: () => number }).toNumber();
    } else if (typeof v === "string" && looksLikeJson(v)) {
      try {
        out[k] = JSON.parse(v);
      } catch {
        out[k] = v;
      }
    } else {
      out[k] = v;
    }
  }
  return out as T;
}

export function serializeRows<T extends Record<string, unknown>>(rows: T[]): T[] {
  return rows.map((r) => serializeRow(r));
}

function looksLikeJson(v: string) {
  const t = v.trim();
  return (t.startsWith("{") && t.endsWith("}")) || (t.startsWith("[") && t.endsWith("]"));
}

export function formatMysqlDatetime(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function asString(v: unknown): string | null {
  if (v == null) return null;
  return String(v);
}

export function asNumber(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function sqlNullableString(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

export function isPrismaMissingTable(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    (err.code === "P2010" || err.message.includes("doesn't exist"))
  );
}
