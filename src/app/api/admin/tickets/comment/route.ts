import { NextResponse } from "next/server";
import { requireAdminPermission } from "@/lib/auth/require-permission";
import { addTicketComment } from "@/lib/admin/ticket-details";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = await requireAdminPermission("add_internal_comments");
  if (!auth.ok) return auth.response;
  const { user } = auth;

  const body = (await request.json()) as {
    ticket_id?: number;
    comment_text?: string;
    is_internal?: boolean;
  };

  const ticketId = Number(body.ticket_id);
  const commentText = (body.comment_text ?? "").trim();

  if (!ticketId) {
    return NextResponse.json(
      { success: false, error: "ticket_id is required" },
      { status: 400 },
    );
  }

  if (!commentText) {
    return NextResponse.json(
      { success: false, error: "Comment text is required" },
      { status: 400 },
    );
  }

  const result = await addTicketComment(
    ticketId,
    commentText,
    user.name,
    `${user.username}@admin`,
    body.is_internal !== false,
  );

  return NextResponse.json(result, { status: result.success ? 200 : 400 });
}
