/**
 * Hostinger MySQL DATETIME has no timezone. PHP writes IST wall-clock
 * (`date_default_timezone_set('Asia/Kolkata')` + `NOW()` / `date()`).
 * Prisma returns those digits as a Date whose UTC fields match the stored clock.
 * Display that clock as IST — do not add +5:30 again.
 * Real UTC instants (ISO with Z / offset) convert to IST.
 */

export const IST_TIMEZONE = "Asia/Kolkata";

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

const NAIVE_SQL =
  /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/;

export type DateTimeParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function hasExplicitOffset(text: string) {
  return /[zZ]$|[+-]\d{2}:?\d{2}$/.test(text.trim());
}

export function instantToIstParts(value: Date): DateTimeParts | null {
  if (Number.isNaN(value.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: IST_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(value);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? NaN);
  const year = get("year");
  const month = get("month");
  const day = get("day");
  const hour = get("hour");
  const minute = get("minute");
  const second = get("second");
  if ([year, month, day, hour, minute, second].some((n) => Number.isNaN(n))) {
    return null;
  }
  return { year, month, day, hour, minute, second };
}

/** Parse MySQL DATETIME / Prisma Date as IST wall-clock digits. */
export function mysqlDateTimeParts(
  value: Date | string | number | null | undefined,
): DateTimeParts | null {
  if (value == null || value === "") return null;
  if (typeof value === "number") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : instantToIstParts(d);
  }
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return {
      year: value.getUTCFullYear(),
      month: value.getUTCMonth() + 1,
      day: value.getUTCDate(),
      hour: value.getUTCHours(),
      minute: value.getUTCMinutes(),
      second: value.getUTCSeconds(),
    };
  }

  const text = String(value).trim();
  if (!text) return null;
  if (hasExplicitOffset(text)) {
    const d = new Date(text);
    return Number.isNaN(d.getTime()) ? null : instantToIstParts(d);
  }
  const match = text.match(NAIVE_SQL);
  if (match) {
    return {
      year: Number(match[1]),
      month: Number(match[2]),
      day: Number(match[3]),
      hour: Number(match[4] ?? 0),
      minute: Number(match[5] ?? 0),
      second: Number(match[6] ?? 0),
    };
  }
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : instantToIstParts(parsed);
}

/** Naive DATETIME is UTC (PHP formatIndianDateTime / formatUtcToIst). */
export function utcDateTimeParts(
  value: Date | string | number | null | undefined,
): DateTimeParts | null {
  if (value == null || value === "") return null;
  if (typeof value === "number") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : instantToIstParts(d);
  }
  if (value instanceof Date) {
    return instantToIstParts(value);
  }
  const text = String(value).trim();
  if (!text) return null;
  if (hasExplicitOffset(text)) {
    const d = new Date(text);
    return Number.isNaN(d.getTime()) ? null : instantToIstParts(d);
  }
  const match = text.match(NAIVE_SQL);
  if (match) {
    const utc = new Date(
      Date.UTC(
        Number(match[1]),
        Number(match[2]) - 1,
        Number(match[3]),
        Number(match[4] ?? 0),
        Number(match[5] ?? 0),
        Number(match[6] ?? 0),
      ),
    );
    return instantToIstParts(utc);
  }
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : instantToIstParts(parsed);
}

function formatParts(
  parts: DateTimeParts,
  options?: {
    withSeconds?: boolean;
    hour12?: boolean;
    suffix?: boolean;
  },
) {
  const withSeconds = options?.withSeconds !== false;
  const hour12 = options?.hour12 !== false;
  const suffix = options?.suffix !== false;
  const day = pad(parts.day);
  const month = MONTHS[parts.month - 1] ?? pad(parts.month);
  let hour = parts.hour;
  let ampm = "";
  if (hour12) {
    ampm = parts.hour < 12 ? " am" : " pm";
    hour = parts.hour % 12 || 12;
  }
  const time = withSeconds
    ? `${pad(hour)}:${pad(parts.minute)}:${pad(parts.second)}`
    : `${pad(hour)}:${pad(parts.minute)}`;
  const out = `${day} ${month} ${parts.year}, ${time}${ampm}`;
  return suffix ? `${out} IST` : out;
}

export function formatIstDateTime(
  value: Date | string | number | null | undefined,
  empty = "N/A",
) {
  const parts = mysqlDateTimeParts(value);
  return parts ? formatParts(parts) : empty;
}

export function formatIstDate(
  value: Date | string | number | null | undefined,
  empty = "N/A",
) {
  const parts = mysqlDateTimeParts(value);
  if (!parts) return empty;
  return `${pad(parts.day)} ${MONTHS[parts.month - 1]} ${parts.year}`;
}

/** Portal PHP `date('M d, Y H:i')` in IST. */
export function formatIstPortal(
  value: Date | string | number | null | undefined,
  empty = "—",
) {
  const parts = mysqlDateTimeParts(value);
  if (!parts) return empty;
  return `${MONTHS[parts.month - 1]} ${pad(parts.day)}, ${parts.year} ${pad(parts.hour)}:${pad(parts.minute)}`;
}

export function formatIstSql(
  value: Date | string | number | null | undefined,
) {
  const parts = mysqlDateTimeParts(value);
  if (!parts) return "";
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)} ${pad(parts.hour)}:${pad(parts.minute)}:${pad(parts.second)}`;
}

export function nowIstParts() {
  return instantToIstParts(new Date())!;
}

/** Current IST wall-clock for MySQL DATETIME writes (matches PHP `date()`). */
export function nowIstSql() {
  const parts = nowIstParts();
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)} ${pad(parts.hour)}:${pad(parts.minute)}:${pad(parts.second)}`;
}

export function todayIstDate() {
  const parts = nowIstParts();
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

export function addIstDays(ymd: string, days: number) {
  const match = ymd.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return ymd;
  const utc = Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]) + days,
  );
  const d = new Date(utc);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function formatUtcToIstDateTime(
  value: Date | string | number | null | undefined,
  empty = "N/A",
) {
  const parts = utcDateTimeParts(value);
  return parts ? formatParts(parts) : empty;
}

/** PHP Return AWB `d M Y H:i` after treating naive DATETIME as UTC. */
export function formatUtcToIstReturnAwb(
  value: Date | string | number | null | undefined,
  empty = "—",
) {
  const parts = utcDateTimeParts(value);
  if (!parts) return empty;
  return `${pad(parts.day)} ${MONTHS[parts.month - 1]} ${parts.year} ${pad(parts.hour)}:${pad(parts.minute)}`;
}
