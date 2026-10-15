import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { resetMailer, sent, setSendMail, transports } from "nodemailer";
import { emailLogs, resetDb, setQueryRaw } from "@/lib/db";
import { sendCustomEmail, sendForStatus } from "@/lib/email/email-service";
import { captureConsole, setEnv } from "./helpers.mjs";

const PASSWORD = "test-smtp-password-not-real";
const CUSTOMER = "customer@example.test";

const SMTP = {
  SMTP_ENABLED: "true",
  SMTP_HOST: "smtp.test.invalid",
  SMTP_PORT: "465",
  SMTP_USERNAME: "mailbox@example.test",
  SMTP_PASSWORD: PASSWORD,
  SMTP_FROM_EMAIL: "sender@example.test",
  SMTP_FROM_NAME: "Test Sender",
};

let output;
let restoreEnv;

beforeEach(() => {
  resetDb();
  resetMailer();
  restoreEnv = setEnv(SMTP);
  output = captureConsole();
});

afterEach(() => {
  output.restore();
  restoreEnv();
});

test("sender identity comes from SMTP_FROM_NAME and SMTP_FROM_EMAIL", async () => {
  const result = await sendCustomEmail(CUSTOMER, "Test subject", "Hello\n\nBody");

  assert.deepEqual(result, { sent: true, error: null });
  assert.equal(sent[0].from, '"Test Sender" <sender@example.test>');
  assert.equal(sent[0].to, CUSTOMER);
  assert.deepEqual(transports[0], {
    host: "smtp.test.invalid",
    port: 465,
    secure: true,
    auth: { user: "mailbox@example.test", pass: PASSWORD },
  });
  assert.equal(emailLogs[0].sent, true);
  assert.equal(emailLogs[0].recipientEmail, CUSTOMER);
});

test("missing SMTP_FROM_EMAIL falls back to the SMTP_USERNAME mailbox", async () => {
  delete process.env.SMTP_FROM_EMAIL;

  await sendCustomEmail(CUSTOMER, "Subject", "Body");

  assert.equal(sent[0].from, '"Test Sender" <mailbox@example.test>');
});

test("missing SMTP_FROM_NAME falls back to the built-in display name", async () => {
  delete process.env.SMTP_FROM_NAME;

  await sendCustomEmail(CUSTOMER, "Subject", "Body");

  assert.equal(sent[0].from, '"Concept Kart" <sender@example.test>');
});

test("missing SMTP credentials stop before any SMTP connection", async () => {
  delete process.env.SMTP_PASSWORD;

  const result = await sendCustomEmail(CUSTOMER, "Subject", "Body");

  assert.deepEqual(result, { sent: false, error: "SMTP credentials not configured" });
  assert.equal(transports.length, 0);
  assert.equal(emailLogs[0].sent, false);
});

test("SMTP_ENABLED=false disables sending", async () => {
  process.env.SMTP_ENABLED = "false";

  const result = await sendCustomEmail(CUSTOMER, "Subject", "Body");

  assert.deepEqual(result, { sent: false, error: "Email disabled in config" });
  assert.equal(transports.length, 0);
});

test("provider authentication failure is reported without the SMTP password", async () => {
  setSendMail(async () => {
    throw new Error("Invalid login: 535 5.7.8 Error: authentication failed");
  });

  const result = await sendCustomEmail(CUSTOMER, "Subject", "Body");
  const exposed = JSON.stringify(result) + JSON.stringify(emailLogs) + output.text();

  assert.equal(result.sent, false);
  assert.match(result.error, /authentication failed/);
  assert.ok(!exposed.includes(PASSWORD));
});

test("malformed sender address is not validated locally; the provider rejection is recorded", async () => {
  process.env.SMTP_FROM_EMAIL = "not-an-email";
  setSendMail(async () => {
    throw new Error("553 5.7.1 <not-an-email>: Sender address rejected");
  });

  const result = await sendCustomEmail(CUSTOMER, "Subject", "Body");

  assert.equal(sent[0].from, '"Test Sender" <not-an-email>');
  assert.equal(result.sent, false);
  assert.equal(emailLogs[0].sent, false);
  assert.match(emailLogs[0].errorMessage, /Sender address rejected/);
});

test("status update email goes to the ticket's customer with the configured sender", async () => {
  setQueryRaw(async () => [
    {
      ticket_id: 7,
      ticket_number: "WR-TEST-0001",
      claim_number: null,
      order_number: "#TEST-1001",
      awb_number: "TESTAWB0001",
      reverse_awb_number: null,
      customer_first_name: "Test",
      customer_name: "Test Customer",
      customer_email: CUSTOMER,
    },
  ]);

  const result = await sendForStatus(7, "in_transit");

  assert.equal(result.sent, true);
  assert.equal(sent[0].to, CUSTOMER);
  assert.equal(sent[0].from, '"Test Sender" <sender@example.test>');
  assert.match(sent[0].text, /WR-TEST-0001/);
  assert.equal(emailLogs[0].statusCode, "in_transit");
});

test("non-notifiable statuses do not send email", async () => {
  const result = await sendForStatus(7, "closed");

  assert.deepEqual(result, { sent: false, error: null });
  assert.equal(transports.length, 0);
});
