import assert from "node:assert/strict";
import { test } from "node:test";
import { sanitizeStatusNote } from "@/lib/admin/ticket-details";
import { ticketListActions } from "@/lib/auth/permissions";

test("status notes trim whitespace and cap length like PHP POST fields", () => {
  assert.equal(sanitizeStatusNote("  customer asked for pickup  "), "customer asked for pickup");
  assert.equal(sanitizeStatusNote("line1\r\nline2"), "line1\nline2");
  assert.equal(sanitizeStatusNote(null), "");
  assert.equal(sanitizeStatusNote(undefined), "");
  assert.equal(sanitizeStatusNote("x".repeat(12), 8), "xxxxxxxx");
});

test("reason is capped shorter than notes", () => {
  const reason = sanitizeStatusNote("r".repeat(600), 500);
  const notes = sanitizeStatusNote("n".repeat(2500), 2000);
  assert.equal(reason.length, 500);
  assert.equal(notes.length, 2000);
});

test("packer cannot bulk-forward; admin and support can", () => {
  const packer = ticketListActions("packer");
  assert.equal(packer.canBulkForward, false);
  assert.equal(packer.canChangeType, true);
  assert.equal(packer.canPackerHandover, true);
  assert.equal(packer.canRefreshAwb, true);

  const support = ticketListActions("support");
  assert.equal(support.canBulkForward, true);
  assert.equal(support.canChangeType, true);

  const admin = ticketListActions("admin");
  assert.equal(admin.canBulkForward, true);
  assert.equal(admin.canChangeType, true);
  assert.equal(admin.canPackerHandover, true);
});

test("unknown role sees no ticket-list write actions", () => {
  const none = ticketListActions("viewer");
  assert.equal(none.canBulkForward, false);
  assert.equal(none.canChangeType, false);
  assert.equal(none.canPackerHandover, false);
  assert.equal(none.canRefreshAwb, false);
});
