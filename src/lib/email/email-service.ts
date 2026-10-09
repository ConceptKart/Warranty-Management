import nodemailer from "nodemailer";
import { prisma } from "@/lib/db";

export type MailResult = { sent: boolean; error: string | null };

type TicketMailData = {
  ticket_id: number;
  ticket_number: string;
  claim_number: string | null;
  order_number: string | null;
  awb_number: string | null;
  reverse_awb_number: string | null;
  customer_first_name: string | null;
  customer_name: string | null;
  customer_email: string | null;
};

const NOTIFIABLE_STATUSES = [
  "pending",
  "accepted",
  "awb_assigned_return",
  "return_in_transit",
  "return_delivered",
  "under_inspection",
  "awb_assigned_forward",
  "in_transit",
  "out_for_delivery",
  "delivered",
] as const;

function emailConfig() {
  return {
    enabled: (process.env.SMTP_ENABLED ?? "true").toLowerCase() !== "false",
    host: process.env.SMTP_HOST ?? "smtp.hostinger.com",
    port: Number(process.env.SMTP_PORT ?? "465"),
    username: process.env.SMTP_USERNAME ?? "",
    password: process.env.SMTP_PASSWORD ?? "",
    fromEmail: process.env.SMTP_FROM_EMAIL ?? process.env.SMTP_USERNAME ?? "",
    fromName: process.env.SMTP_FROM_NAME ?? "Concept Kart",
  };
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function wrapHtml(plainText: string): string {
  const paragraphs = plainText.trim().split(/\n\s*\n/);
  let htmlBody = "";
  for (const raw of paragraphs) {
    const para = raw.trim();
    if (!para) continue;
    const withBreaks = escapeHtml(para).replace(/\n/g, "<br>");
    htmlBody += `<p style="margin:0 0 14px 0;">${withBreaks}</p>\n`;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Concept Kart</title>
</head>
<body style="margin:0;padding:0;background:#ffffff;font-family:Arial,sans-serif;font-size:15px;line-height:1.6;color:#333333;">
  <table width="100%" cellpadding="0" cellspacing="0">
    <tr>
      <td style="padding:32px 24px;">
        ${htmlBody}
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

async function fetchTicketData(ticketId: number): Promise<TicketMailData | null> {
  const rows = await prisma.$queryRaw<TicketMailData[]>`
    SELECT
      t.ticket_id,
      t.ticket_number,
      t.claim_number,
      COALESCE(t.claim_number, o.order_number) AS order_number,
      t.awb_number,
      t.reverse_awb_number,
      c.first_name AS customer_first_name,
      CONCAT_WS(' ', c.first_name, c.last_name) AS customer_name,
      c.email AS customer_email
    FROM warranty_tickets t
    LEFT JOIN orders o ON o.order_id = t.order_id
    LEFT JOIN customers c ON c.customer_id = o.customer_id
    WHERE t.ticket_id = ${ticketId}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

function buildStatusBody(statusCode: string, t: TicketMailData): string {
  const rawName = (t.customer_first_name ?? "").trim();
  const greeting = rawName ? `Hi ${rawName},` : "Hi,";
  const ticketNo = t.ticket_number ?? "";
  const orderRef = t.order_number ?? t.claim_number ?? "";
  const fwdAwb = t.awb_number ?? "";
  const revAwb = t.reverse_awb_number ?? "";

  const bodies: Record<string, string> = {
    pending: `${greeting}

We wanted to inform you that your warranty/replacement request is under review.

Ticket ID: ${ticketNo}
Order ID: ${orderRef}

We'll keep you updated as your request progresses. If you have any questions, you can reach us through our support channels.

Thank you for choosing Concept Kart.

Team Concept Kart`,

    awb_assigned_return: `${greeting}

We wanted to inform you that pick up has been scheduled for your warranty/replacement request.

Ticket ID: ${ticketNo}
Order ID: ${orderRef}
Tracking ID: ${revAwb}

We'll keep you updated as your request progresses. If you have any questions, you can reach us through our support channels.

Thank you for choosing Concept Kart.

Team Concept Kart`,

    return_in_transit: `${greeting}

We wanted to inform you that your shipment is in transit to the warehouse.

Ticket ID: ${ticketNo}
Order ID: ${orderRef}
Tracking ID: ${revAwb}

We'll keep you updated as your request progresses. If you have any questions, you can reach us through our support channels.

Thank you for choosing Concept Kart.

Team Concept Kart`,

    return_delivered: `${greeting}

We wanted to inform you that the shipment has been received in the warehouse.

Ticket ID: ${ticketNo}
Order ID: ${orderRef}
Tracking ID: ${revAwb}

We'll keep you updated as your request progresses. If you have any questions, you can reach us through our support channels.

Thank you for choosing Concept Kart.

Team Concept Kart`,

    under_inspection: `${greeting}

We wanted to inform you that your unit is currently under inspection.

Ticket ID: ${ticketNo}
Order ID: ${orderRef}

We'll keep you updated as your request progresses. If you have any questions, you can reach us through our support channels.

Thank you for choosing Concept Kart.

Team Concept Kart`,

    awb_assigned_forward: `${greeting}

We wanted to inform you that the forward shipment for your warranty/replacement request has been scheduled.

Ticket ID: ${ticketNo}
Order ID: ${orderRef}
Tracking ID: ${fwdAwb}

You can use the tracking ID to follow the shipment's progress. We'll also continue to keep you updated along the way.

If you have any questions or need further assistance, please feel free to reach out to us through our support channels.

Thank you for choosing Concept Kart.

Best regards,
Team Concept Kart`,

    in_transit: `${greeting}

We wanted to inform you that the forward shipment for your warranty/replacement request is in transit.

Ticket ID: ${ticketNo}
Order ID: ${orderRef}
Tracking ID: ${fwdAwb}

You can use the tracking ID to follow the shipment's progress. We'll also continue to keep you updated along the way.

If you have any questions or need further assistance, please feel free to reach out to us through our support channels.

Thank you for choosing Concept Kart.

Best regards,
Team Concept Kart`,

    out_for_delivery: `${greeting}

We wanted to inform you that the forward shipment for your warranty/replacement request is out for delivery.

Ticket ID: ${ticketNo}
Order ID: ${orderRef}
Tracking ID: ${fwdAwb}

You can use the tracking ID to follow the shipment's progress. We'll also continue to keep you updated along the way.

If you have any questions or need further assistance, please feel free to reach out to us through our support channels.

Thank you for choosing Concept Kart.

Best regards,
Team Concept Kart`,

    delivered: `${greeting}

We're happy to inform you that the forward shipment for your warranty/replacement request has been successfully delivered.

Ticket ID: ${ticketNo}
Order ID: ${orderRef}

If you have any questions or need further assistance, please feel free to reach out to us through our support channels.

Thank you for choosing Concept Kart.

Best regards,
Team Concept Kart`,
  };

  return (
    bodies[statusCode] ??
    `${greeting}\n\nYour ticket ${ticketNo} has been updated.\n\nTeam Concept Kart`
  );
}

function buildAcceptedBody(templateKey: string, t: TicketMailData): string {
  const rawName = (t.customer_first_name ?? "").trim();
  const greeting = rawName ? `Hi ${rawName},` : "Hi Customer,";
  const ticketNo = t.ticket_number ?? "";
  const orderRef = t.order_number ?? t.claim_number ?? "";
  const revAwb = t.reverse_awb_number ?? "";

  const bodies: Record<string, string> = {
    accepted_default: `${greeting}

We wanted to inform you that a pickup has been scheduled for your warranty/replacement request.

Request Details:

Ticket ID: ${ticketNo}
Order ID: ${orderRef}
Tracking ID: ${revAwb}

Important Information Regarding Your Claim:

Packaging Video Required: We kindly request you to record a clear, continuous video of yourself safely packing the unit before handing it over to the pickup executive. In the event of any discrepancies or transit issues, this video will be required to process your claim.

Address Change for Delivery: If you wish to change your delivery address for when your serviced unit is returned to you, kindly contact us via email at customercare@conceptkart.com or WhatsApp us at 918882396866.

We'll keep you updated as your request progresses. If you have any questions, you can reach us through our support channels.

Thank you for choosing Concept Kart.

Best regards,
Team Concept Kart`,

    accepted_amazon_cable: `${greeting}

We wanted to inform you that a pickup has been scheduled for your warranty/replacement request.

Request Details:

Ticket ID: ${ticketNo}
Order ID: ${orderRef}
Tracking ID: ${revAwb}

Important Information Regarding Your Claim:

Cable Warranty: Please note that for orders placed through Amazon, we do not provide warranty coverage on cables. Therefore, we will unfortunately be unable to process a repair or replacement for cable-related issues.

Packaging Video Required: We kindly request you to record a clear, continuous video of yourself safely packing the unit before handing it over to the pickup executive. In the event of any discrepancies or transit issues, this video will be required to process your claim.

Address Change for Delivery: If you wish to change your delivery address for when your serviced unit is returned to you, kindly contact us via email at customercare@conceptkart.com or WhatsApp us at 918882396866.

We'll keep you updated as your request progresses. If you have any questions, you can reach us through our support channels.

Thank you for choosing Concept Kart.

Best regards,
Team Concept Kart`,

    accepted_website_cable: `${greeting}

We wanted to inform you that a pickup has been scheduled for your warranty/replacement request.

Request Details:

Ticket ID: ${ticketNo}
Order ID: ${orderRef}
Tracking ID: ${revAwb}

Important Information Regarding Your Claim:

Cable Warranty: Please note that we provide a 6-month exceptional warranty on cables, starting from the date of the original order. If your order has passed this 6-month period, we will unfortunately be unable to process a repair or replacement for the cable.

Packaging Video Required: We kindly request you to record a clear, continuous video of yourself safely packing the unit before handing it over to the pickup executive. In the event of any discrepancies or transit issues, this video will be required to process your claim.

Address Change for Delivery: If you wish to change your address for the return delivery of your serviced unit, kindly contact us via email at customercare@conceptkart.com or WhatsApp us at 918882396866.

We'll keep you updated as your request progresses. If you have any questions, you can reach us through our support channels.

Thank you for choosing Concept Kart.

Best regards,
Team Concept Kart`,
  };

  return bodies[templateKey] ?? bodies.accepted_default;
}

async function logEmail(
  ticketId: number,
  to: string,
  subject: string,
  statusCode: string,
  result: MailResult,
  bodyHtml = "",
) {
  try {
    await prisma.ticketEmailLog.create({
      data: {
        ticketId: ticketId || null,
        recipientEmail: to,
        subject,
        statusCode,
        sent: result.sent,
        errorMessage: result.error,
        bodyHtml: bodyHtml || null,
        sentAt: new Date(),
      },
    });
  } catch (error) {
    console.error("[EmailService] log failed:", error);
  }
}

async function sendMail(
  to: string,
  subject: string,
  html: string,
  text: string,
): Promise<MailResult> {
  const cfg = emailConfig();
  if (!cfg.enabled) {
    return { sent: false, error: "Email disabled in config" };
  }
  if (!cfg.username || !cfg.password) {
    return { sent: false, error: "SMTP credentials not configured" };
  }

  try {
    const transporter = nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.port === 465,
      auth: {
        user: cfg.username,
        pass: cfg.password,
      },
    });

    await transporter.sendMail({
      from: `"${cfg.fromName}" <${cfg.fromEmail}>`,
      to,
      subject,
      text,
      html,
    });

    return { sent: true, error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : "SMTP send failed";
    console.error("[EmailService] send failed:", message);
    return { sent: false, error: message };
  }
}

/** Mirrors EmailService::sendForStatus (accepted handled separately by caller) */
export async function sendForStatus(
  ticketId: number,
  statusCode: string,
  emailTemplate = "",
): Promise<MailResult> {
  if (!NOTIFIABLE_STATUSES.includes(statusCode as (typeof NOTIFIABLE_STATUSES)[number])) {
    return { sent: false, error: null };
  }

  if (statusCode === "accepted") {
    return sendAcceptedEmail(ticketId, emailTemplate);
  }

  const ticket = await fetchTicketData(ticketId);
  if (!ticket?.customer_email) {
    return { sent: false, error: "No customer email on record" };
  }

  const subject = "Update on Your Warranty/Replacement Request from Concept Kart";
  const html = wrapHtml(buildStatusBody(statusCode, ticket));
  const text = htmlToText(html);
  const result = await sendMail(ticket.customer_email, subject, html, text);
  await logEmail(ticketId, ticket.customer_email, subject, statusCode, result, html);
  return result;
}

/** Mirrors EmailService::sendAcceptedEmail */
export async function sendAcceptedEmail(
  ticketId: number,
  emailTemplate = "",
): Promise<MailResult> {
  const ticket = await fetchTicketData(ticketId);
  if (!ticket?.customer_email) {
    return { sent: false, error: "No customer email on record" };
  }

  const templateKey = `accepted_${emailTemplate || "default"}`;
  const subject =
    "Update: Pickup Scheduled for Your Warranty/Replacement Request";
  const html = wrapHtml(buildAcceptedBody(templateKey, ticket));
  const text = htmlToText(html);
  const logStatusCode = `accepted${emailTemplate ? `_${emailTemplate}` : "_default"}`;
  const result = await sendMail(ticket.customer_email, subject, html, text);
  await logEmail(
    ticketId,
    ticket.customer_email,
    subject,
    logStatusCode,
    result,
    html,
  );
  return result;
}

/** Mirrors EmailService::sendCustomEmail — body is plain text from admin UI */
export async function sendCustomEmail(
  to: string,
  subject: string,
  plainBody: string,
  ticketId = 0,
): Promise<MailResult> {
  const html = wrapHtml(plainBody);
  const text = plainBody;
  const result = await sendMail(to, subject, html, text);
  await logEmail(ticketId, to, subject, "custom", result, html);
  return result;
}
