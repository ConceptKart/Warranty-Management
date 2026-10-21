import { prisma } from "@/lib/db";

export function istYearMonth(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(date);
  const year = parts.find((p) => p.type === "year")?.value ?? "";
  const month = parts.find((p) => p.type === "month")?.value ?? "";
  return `${year}${month}`;
}

export function ticketPrefixForTypeCode(typeCode: string | null | undefined) {
  if (typeCode === "replacement") return "RP";
  if (typeCode === "warranty") return "WR";
  if (typeCode) return "TK";
  return "WR";
}

export function swapTicketNumberPrefix(
  ticketNumber: string,
  typeCode: string,
) {
  const prefix = ticketPrefixForTypeCode(typeCode);
  if (/^(WR|RP|TK)/i.test(ticketNumber)) {
    return `${prefix}${ticketNumber.slice(2)}`;
  }
  return ticketNumber;
}

export function swapOrderTypeSuffix(
  orderNumber: string | null | undefined,
  typeCode: string,
) {
  if (!orderNumber) return orderNumber ?? null;
  const last = orderNumber.slice(-1).toUpperCase();
  if (last === "W" && typeCode === "replacement") {
    return `${orderNumber.slice(0, -1)}R`;
  }
  if (last === "R" && typeCode === "warranty") {
    return `${orderNumber.slice(0, -1)}W`;
  }
  return orderNumber;
}

/** Keep the 10-digit Indian mobile, not the country-code prefix. */
export function indianMobileDigits(raw: string) {
  const digits = String(raw ?? "").replace(/\D/g, "");
  if (digits.length >= 11 && digits.startsWith("91")) return digits.slice(-10);
  if (digits.length === 11 && digits.startsWith("0")) return digits.slice(-10);
  if (digits.length > 10) return digits.slice(-10);
  return digits;
}

export async function generateTicketNumber(ticketTypeId: number) {
  let prefix = "WR";
  const typeRows = await prisma.$queryRaw<Array<{ type_code: string | null }>>`
    SELECT type_code FROM ticket_types WHERE ticket_type_id = ${ticketTypeId}
  `;
  prefix = ticketPrefixForTypeCode(typeRows[0]?.type_code);

  const yearMonth = istYearMonth();
  const like = `${prefix}${yearMonth}%`;
  const offset = prefix.length + yearMonth.length + 1;

  const rows = await prisma.$queryRaw<Array<{ max_seq: bigint | number | null }>>`
    SELECT COALESCE(MAX(CAST(SUBSTRING(ticket_number, ${offset}) AS UNSIGNED)), 0) AS max_seq
    FROM warranty_tickets
    WHERE ticket_number LIKE ${like}
  `;
  const next = Number(rows[0]?.max_seq ?? 0) + 1;
  return `${prefix}${yearMonth}${String(next).padStart(4, "0")}`;
}
