import { NextResponse } from "next/server";
import { uploadToRemoteServer } from "@/lib/portal/upload-to-remote";

export const runtime = "nodejs";

const ALLOWED_EXT = new Set([
  "jpg",
  "jpeg",
  "png",
  "gif",
  "mp4",
  "avi",
  "mov",
  "wmv",
]);
const MAX_FILE_BYTES = 10 * 1024 * 1024;

export async function POST(request: Request) {
  const form = await request.formData();
  const file = form.get("mediaFile");

  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json(
      { success: false, message: "No file provided" },
      { status: 400 },
    );
  }

  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!ALLOWED_EXT.has(ext)) {
    return NextResponse.json(
      {
        success: false,
        message:
          "Unsupported file format. Please use JPG, PNG, GIF, MP4, AVI, MOV, or WMV.",
      },
      { status: 400 },
    );
  }

  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json(
      { success: false, message: "File is too large. Maximum size is 10MB." },
      { status: 400 },
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const storedName = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}.${ext}`;
  const result = await uploadToRemoteServer(
    buffer,
    storedName,
    file.type || "application/octet-stream",
  );

  if (!result.success) {
    return NextResponse.json(
      { success: false, message: result.error },
      { status: 502 },
    );
  }

  return NextResponse.json({
    success: true,
    fileUrl: result.remote_url,
  });
}
