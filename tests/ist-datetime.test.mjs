import assert from "node:assert/strict";
import { test } from "node:test";
import { ticketsToCsvRows } from "@/lib/admin/tickets";
import { formatReturnAwbIst } from "@/lib/admin/return-awb";
import {
  addIstDays,
  formatIstDate,
  formatIstDateTime,
  formatIstPortal,
  formatIstSql,
  formatUtcToIstReturnAwb,
  mysqlDateTimeParts,
  nowIstSql,
} from "@/lib/datetime/ist";

test("MySQL IST wall-clock is shown as-is, not shifted +5:30", () => {
  const stored = "2026-10-22 13:21:00";
  assert.equal(formatIstDateTime(stored), "22 Oct 2026, 01:21:00 pm IST");
  assert.equal(formatIstDate(stored), "22 Oct 2026");
  assert.equal(formatIstPortal(stored), "Oct 22, 2026 13:21");
  assert.equal(formatIstSql(stored), "2026-10-22 13:21:00");

  const prismaDate = new Date(Date.UTC(2026, 9, 22, 13, 21, 0));
  assert.equal(formatIstDateTime(prismaDate), "22 Oct 2026, 01:21:00 pm IST");
  assert.notEqual(formatIstDateTime(prismaDate), "22 Oct 2026, 06:51:00 pm IST");
});

test("real UTC instants convert to IST", () => {
  assert.equal(
    formatIstDateTime("2026-10-22T07:51:00.000Z"),
    "22 Oct 2026, 01:21:00 pm IST",
  );
});

test("Return AWB still treats naive DATETIME as UTC like PHP", () => {
  assert.equal(formatReturnAwbIst("2026-10-20 09:48:00"), "20 Oct 2026 15:18");
  assert.equal(formatUtcToIstReturnAwb("2026-10-20 09:48:00"), "20 Oct 2026 15:18");
});

test("CSV export writes IST SQL datetimes, not ISO UTC", () => {
  const csv = ticketsToCsvRows([
    {
      ticket_number: "WR2026100001",
      priority: "medium",
      status_name: "Pending",
      created_at: new Date(Date.UTC(2026, 9, 22, 13, 21, 0)),
      updated_at: "2026-10-22 14:00:00",
      customer_email: "a@example.com",
      first_name: "A",
      last_name: "B",
      product_name: "X",
      product_sku: "SKU",
      order_number: "CK1",
      source_platform: "shopify",
      issue_name: "Dead",
      customer_description: "n/a",
    },
  ]);
  assert.match(csv, /2026-10-22 13:21:00/);
  assert.match(csv, /2026-10-22 14:00:00/);
  assert.doesNotMatch(csv, /2026-10-22T13:21:00\.000Z/);
});

test("nowIstSql is naive IST wall-clock", () => {
  const sql = nowIstSql();
  assert.match(sql, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  assert.ok(mysqlDateTimeParts(sql));
});

test("recent-filter helper subtracts IST calendar days", () => {
  assert.equal(addIstDays("2026-10-22", -7), "2026-10-15");
  assert.equal(addIstDays("2026-03-01", -1), "2026-02-28");
});
