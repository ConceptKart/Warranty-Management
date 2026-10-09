/**
 * Shared BaseLinker connector helpers (ports cron/baselinker_sync.php + amazon_sync.php).
 */

export type BaselinkerOrder = {
  order_id?: number | string;
  date_add?: number;
  order_status_id?: number | string;
  order_status_name?: string;
  external_order_id?: string;
  extra_field_1?: string;
  delivery_fullname?: string;
  invoice_fullname?: string;
  phone?: string;
  email?: string;
  delivery_address?: string;
  delivery_city?: string;
  delivery_state?: string;
  delivery_postcode?: string;
  delivery_package_nr?: string;
  products?: Array<{
    product_id?: number | string;
    variant_id?: number | string;
    sku?: string;
    name?: string;
    quantity?: number;
    ean?: string | number;
  }>;
};

function getToken() {
  const token = process.env.BASELINKER_TOKEN?.trim();
  if (!token) {
    throw new Error("BASELINKER_TOKEN is not configured");
  }
  return token;
}

function getApiUrl() {
  return (
    process.env.BASELINKER_API_URL?.trim() ||
    "https://api.baselinker.com/connector.php"
  );
}

export async function baselinkerCall(
  method: string,
  parameters: Record<string, unknown>,
  options?: { timeoutMs?: number },
): Promise<Record<string, unknown>> {
  const token = getToken();
  const body = new URLSearchParams();
  body.set("method", method);
  body.set("parameters", JSON.stringify(parameters));

  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    options?.timeoutMs ?? 30_000,
  );

  try {
    const res = await fetch(getApiUrl(), {
      method: "POST",
      headers: {
        "X-BLToken": token,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
      signal: controller.signal,
    });
    const data = (await res.json()) as Record<string, unknown>;
    if (data.status === "ERROR") {
      throw new Error(
        `BaseLinker API error [${String(data.error_code)}]: ${String(data.error_message)}`,
      );
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

/** IST day window as unix seconds (matches PHP cron date handling). */
export function getIstDayWindow(dateYmd?: string | null): {
  dayStart: number;
  dayEnd: number;
  istStart: string;
  istEnd: string;
} {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  let ymd = dateYmd?.trim();
  if (!ymd) {
    // yesterday in IST
    const now = new Date();
    const istNow = new Date(
      now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }),
    );
    istNow.setDate(istNow.getDate() - 1);
    ymd = formatter.format(istNow); // YYYY-MM-DD
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) {
    throw new Error("Invalid date format. Use YYYY-MM-DD.");
  }

  // Start of that IST day as unix
  const dayStart = Math.floor(
    new Date(`${ymd}T00:00:00+05:30`).getTime() / 1000,
  );
  const dayEnd = dayStart + 86400 - 1;
  const istStart = `${ymd} 00:00:00`;
  const istEnd = `${ymd} 23:59:59`;
  return { dayStart, dayEnd, istStart, istEnd };
}

export function formatIstFromUnix(unix: number) {
  return new Date(unix * 1000).toLocaleString("sv-SE", {
    timeZone: "Asia/Kolkata",
    hour12: false,
  }).replace("T", " ");
}

/**
 * Paginated getOrders for one source (shop / amazon), filtered to day window.
 */
export async function fetchOrdersForDay(input: {
  filterOrderSource: string;
  filterOrderSourceId: number;
  dayStart: number;
  dayEnd: number;
  pageLimit?: number;
}): Promise<BaselinkerOrder[]> {
  const pageLimit = input.pageLimit ?? 100;
  const allOrders: BaselinkerOrder[] = [];
  const seen = new Set<string>();
  let currentFrom = input.dayStart;
  let page = 1;

  while (true) {
    const data = await baselinkerCall("getOrders", {
      date_from: currentFrom,
      get_unconfirmed_orders: false,
      filter_order_source: input.filterOrderSource,
      filter_order_source_id: input.filterOrderSourceId,
    });

    const orders = (data.orders as BaselinkerOrder[] | undefined) ?? [];
    if (orders.length === 0) break;

    const newOrders = orders.filter((o) => {
      const id = String(o.order_id ?? "");
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    });

    const inWindow = newOrders.filter((o) => {
      const t = Number(o.date_add ?? 0);
      return t >= input.dayStart && t <= input.dayEnd;
    });
    allOrders.push(...inWindow);

    const lastDateAdd = Number(
      orders[orders.length - 1]?.date_add ?? currentFrom,
    );

    if (orders.length < pageLimit) break;
    if (lastDateAdd > input.dayEnd) break;

    let nextFrom = lastDateAdd;
    if (nextFrom <= currentFrom) nextFrom = currentFrom + 1;
    currentFrom = nextFrom;
    page += 1;
    await new Promise((r) => setTimeout(r, 700));
    if (page > 200) break; // safety
  }

  return allOrders;
}

export function authorizeCron(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    return { ok: true as const, warn: "CRON_SECRET not set" };
  }
  const header =
    request.headers.get("x-cron-secret") ||
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (header !== secret) return { ok: false as const };
  return { ok: true as const };
}
