import assert from "node:assert/strict";
import { test } from "node:test";
import {
  indianMobileDigits,
  swapOrderTypeSuffix,
  swapTicketNumberPrefix,
  ticketPrefixForTypeCode,
} from "@/lib/tickets/ticket-number";

test("replacement type uses RP prefix and warranty uses WR", () => {
  assert.equal(ticketPrefixForTypeCode("replacement"), "RP");
  assert.equal(ticketPrefixForTypeCode("warranty"), "WR");
});

test("swapTicketNumberPrefix retitles WR to RP on type change", () => {
  assert.equal(swapTicketNumberPrefix("WR2026100737", "replacement"), "RP2026100737");
  assert.equal(swapTicketNumberPrefix("RP2026100171", "warranty"), "WR2026100171");
});

test("swapOrderTypeSuffix flips claim and order suffixes", () => {
  assert.equal(swapOrderTypeSuffix("CK318505-W", "replacement"), "CK318505-R");
  assert.equal(swapOrderTypeSuffix("CK318505-R", "warranty"), "CK318505-W");
  assert.equal(swapOrderTypeSuffix("CK318505W", "replacement"), "CK318505R");
});

test("indianMobileDigits keeps the last 10 digits after country code", () => {
  assert.equal(indianMobileDigits("+918800456130"), "8800456130");
  assert.equal(indianMobileDigits("918800456130"), "8800456130");
  assert.equal(indianMobileDigits("8800456130"), "8800456130");
  assert.equal(indianMobileDigits("08800456130"), "8800456130");
});
