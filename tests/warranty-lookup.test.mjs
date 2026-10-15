import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import TrackTicketPage from "@/app/(portal)/track/page";
import { calls, resetDb, setQueryRaw } from "@/lib/db";
import { getTicketForTracking } from "@/lib/portal/track-ticket";
import { captureConsole, installFetchStub, jsonResponse, setEnv } from "./helpers.mjs";

const TICKET = "WR-TEST-0001";
const TOKEN = "test-baselinker-token-not-real";
const API_URL = "https://baselinker.test.invalid/connector.php";
const BL_ORDER_ID = 12345678;
const UNAVAILABLE = "Using local ticket status (BaseLinker unavailable)";

function ticketRow(overrides = {}) {
  return {
    ticket_number: TICKET,
    product_name: "Test Headphones",
    status_name: "Under Review",
    status_color: "#17a2b8",
    created_at: new Date("2026-01-05T10:00:00Z"),
    updated_at: new Date("2026-01-06T10:00:00Z"),
    order_number: "#TEST-1001",
    source_platform: "shopify",
    awb_number: null,
    reverse_awb_number: null,
    ticket_type_name: "Warranty",
    issue_name: "No power",
    customer_description: "Synthetic test ticket",
    baselinker_order_id: String(BL_ORDER_ID),
    ...overrides,
  };
}

function baselinker({ statusId = 8111, statusName = "Under review" } = {}) {
  return (url, init) => {
    const method = new URLSearchParams(init.body).get("method");
    if (method === "getOrders") {
      return jsonResponse({
        status: "SUCCESS",
        orders: [{ order_id: BL_ORDER_ID, order_status_id: statusId }],
      });
    }
    if (method === "getOrderStatusList") {
      return jsonResponse({ status: "SUCCESS", statuses: [{ id: statusId, name: statusName }] });
    }
    return jsonResponse({ status: "ERROR", error_code: "ERROR_UNKNOWN_METHOD", error_message: method });
  };
}

async function renderTrackPage(ticketNumber) {
  const searchParams = Promise.resolve(
    ticketNumber === undefined ? {} : { ticket_number: ticketNumber },
  );
  return renderToStaticMarkup(await TrackTicketPage({ searchParams }));
}

let net;
let output;
let restoreEnv;

beforeEach(() => {
  resetDb();
  restoreEnv = setEnv({ BASELINKER_TOKEN: TOKEN, BASELINKER_API_URL: API_URL });
  net = installFetchStub();
  output = captureConsole();
});

afterEach(() => {
  output.restore();
  net.restore();
  restoreEnv();
});

test("A: known ticket returns the live provider status to the customer", async () => {
  setQueryRaw(async () => [ticketRow()]);
  net.respondWith(baselinker());

  const ticket = await getTicketForTracking(TICKET);

  assert.equal(ticket.ticket_number, TICKET);
  assert.equal(ticket.status_source, "live_baselinker");
  assert.equal(ticket.status_name, "Under review");
  assert.equal(ticket.original_ticket_status, "Under Review");
  assert.deepEqual(calls[0].values, [TICKET]);
  assert.ok(!calls[0].sql.includes(TICKET), "ticket number must be a bound parameter");
  assert.equal(net.calls[0].url, API_URL);
  assert.equal(net.calls[0].init.headers["X-BLToken"], TOKEN);

  const html = await renderTrackPage(TICKET);
  assert.match(html, /WR-TEST-0001/);
  assert.match(html, /Test Headphones/);
  assert.match(html, /Under review/);
  assert.match(html, /Updated in real-time from BaseLinker/);
  assert.ok(!html.includes(TOKEN));
});

test("B: rejected provider credentials fall back to local status without exposing the token", async () => {
  setQueryRaw(async () => [ticketRow()]);
  net.respondWith(() =>
    jsonResponse({ status: "ERROR", error_code: "ERROR_BAD_TOKEN", error_message: "Invalid user token" }),
  );

  const ticket = await getTicketForTracking(TICKET);

  assert.equal(ticket.status_source, "local_database");
  assert.equal(ticket.status_name, "Under Review");
  assert.equal(ticket.current_status_description, UNAVAILABLE);
  assert.match(output.text(), /ERROR_BAD_TOKEN/);
  assert.ok(!output.text().includes(TOKEN), "logs must not contain the token");
  assert.ok(!JSON.stringify(ticket).includes(TOKEN));

  const html = await renderTrackPage(TICKET);
  assert.match(html, /Under Review/);
  assert.ok(!html.includes(TOKEN));
});

test("C: missing BASELINKER_TOKEN is reported by name and no fallback token is sent", async () => {
  delete process.env.BASELINKER_TOKEN;
  setQueryRaw(async () => [ticketRow()]);

  const ticket = await getTicketForTracking(TICKET);

  assert.equal(net.calls.length, 0, "provider must not be called without a configured token");
  assert.equal(ticket.status_source, "local_database");
  assert.match(output.text(), /BASELINKER_TOKEN is not configured/);
});

test("D: provider network failure keeps the lookup available", async () => {
  setQueryRaw(async () => [ticketRow()]);
  net.respondWith(() => {
    throw new TypeError("fetch failed");
  });

  const ticket = await getTicketForTracking(TICKET);

  assert.equal(ticket.status_source, "local_database");
  assert.equal(ticket.current_status_description, UNAVAILABLE);
});

test("D: provider timeout is aborted after 30 s and falls back to local status", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    setQueryRaw(async () => [ticketRow()]);
    net.respondWith(
      (url, init) =>
        new Promise((_, reject) => {
          init.signal.addEventListener("abort", () =>
            reject(new DOMException("This operation was aborted", "AbortError")),
          );
        }),
    );

    const pending = getTicketForTracking(TICKET);
    for (let i = 0; i < 20 && net.calls.length === 0; i++) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    assert.equal(net.calls.length, 1);
    mock.timers.tick(30_000);
    const ticket = await pending;

    assert.equal(ticket.status_source, "local_database");
    assert.equal(ticket.current_status_description, UNAVAILABLE);
  } finally {
    mock.timers.reset();
  }
});

test("D: database outage rejects the lookup (no app-level fallback page exists)", async () => {
  setQueryRaw(async () => {
    throw new Error("Can't reach database server at `db.test.invalid:3306`");
  });

  await assert.rejects(getTicketForTracking(TICKET), /Can't reach database server/);
  assert.equal(net.calls.length, 0);
});

test("E: unknown ticket shows the not-found message and skips the provider", async () => {
  setQueryRaw(async () => []);

  assert.equal(await getTicketForTracking("WR-DOES-NOT-EXIST"), null);
  const html = await renderTrackPage("WR-DOES-NOT-EXIST");

  assert.equal(net.calls.length, 0);
  assert.match(html, /Ticket not found\. Please check your ticket number and try again\./);
  assert.match(html, /name="ticket_number"/);
  assert.match(html, /value="WR-DOES-NOT-EXIST"/);
});

test("F: without a ticket number the customer is asked to enter one", async () => {
  assert.equal(await getTicketForTracking("   "), null);
  const html = await renderTrackPage(undefined);

  assert.equal(calls.length, 0, "no lookup without a ticket number");
  assert.equal(net.calls.length, 0);
  assert.match(html, /<h2>Track Ticket<\/h2>/);
  assert.match(html, /placeholder="Enter your ticket number/);
  assert.ok(!html.includes("Ticket Not Found"));
});
