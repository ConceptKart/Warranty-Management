import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/get-session";
import { sendAcceptedEmail, sendCustomEmail } from "@/lib/email/email-service";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const session = await getSession();
  if (!session.adminUser) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as {
    action?: string;
    ticket_id?: number;
    to_email?: string;
    subject?: string;
    body?: string;
    email_template?: string;
  };

  const action = body.action ?? "custom";
  const ticketId = Number(body.ticket_id ?? 0);

  if (action === "accepted") {
    if (!ticketId) {
      return NextResponse.json(
        { success: false, error: "ticket_id is required" },
        { status: 400 },
      );
    }
    const result = await sendAcceptedEmail(ticketId, body.email_template ?? "");
    return NextResponse.json(
      { success: result.sent, sent: result.sent, error: result.error },
      { status: result.sent ? 200 : 400 },
    );
  }

  const toEmail = String(body.to_email ?? "").trim();
  const subject = String(body.subject ?? "").trim();
  const message = String(body.body ?? "").trim();

  if (!toEmail || !subject || !message) {
    return NextResponse.json(
      { success: false, error: "To, Subject, and Message are required" },
      { status: 400 },
    );
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(toEmail)) {
    return NextResponse.json(
      { success: false, error: "Invalid recipient email address" },
      { status: 400 },
    );
  }

  const result = await sendCustomEmail(toEmail, subject, message, ticketId);
  return NextResponse.json(
    { success: result.sent, sent: result.sent, error: result.error },
    { status: result.sent ? 200 : 400 },
  );
}
