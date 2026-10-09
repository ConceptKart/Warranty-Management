import { NextResponse } from "next/server";
import { getPortalSession } from "@/lib/portal/get-session";
import {
  buildShippingAddressFromParts,
  submitPortalClaim,
} from "@/lib/portal/submit-claim";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const session = await getPortalSession();
  if (!session.orderData || !session.selectedIssueId) {
    return NextResponse.json(
      {
        success: false,
        error: "Session expired. Please start from the beginning.",
      },
      { status: 400 },
    );
  }

  const form = await request.formData();
  const files = form
    .getAll("attachments")
    .filter((v): v is File => v instanceof File && v.size > 0);

  const shippingAddress =
    String(form.get("edit_shipping_address") ?? "").trim() ||
    buildShippingAddressFromParts({
      address: String(form.get("edit_shipping_street") ?? ""),
      city: String(form.get("edit_shipping_city") ?? ""),
      state: String(form.get("edit_shipping_state") ?? ""),
      pincode: String(form.get("edit_shipping_pincode") ?? ""),
    });

  const result = await submitPortalClaim(session, {
    customerEmail: String(
      form.get("customer_email") || form.get("edit_email") || "",
    ),
    customerName: String(form.get("edit_name") ?? ""),
    customerPhone: String(form.get("edit_phone") ?? ""),
    shippingAddress,
    issueDescription: String(form.get("issue_description") ?? ""),
    sourceDevice: String(form.get("source_device") ?? ""),
    files,
    baselinkerField6397: String(form.get("baselinker_field_6397") ?? ""),
    baselinkerField6398: String(form.get("baselinker_field_6398") ?? ""),
    uploadedUrlsJson: String(form.get("uploaded_urls") ?? ""),
  });

  if (!result.success) {
    return NextResponse.json(result, { status: 400 });
  }

  session.ticketNumber = result.ticket_number;
  await session.save();

  return NextResponse.json({
    success: true,
    ticket_number: result.ticket_number,
    redirect: "/confirmation",
  });
}
