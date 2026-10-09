const DEFAULT_UPLOAD_URL =
  "https://conceptkart.co.in/warrantyreplacement.php";

export type RemoteUploadResult =
  | { success: true; remote_url: string }
  | { success: false; error: string };

/**
 * Port of WarrantyController::uploadToRemoteServer — uploads via multipart POST.
 */
export async function uploadToRemoteServer(
  buffer: Buffer,
  storedFileName: string,
  mimeType: string,
): Promise<RemoteUploadResult> {
  const endpoint =
    process.env.WARRANTY_UPLOAD_URL?.trim() || DEFAULT_UPLOAD_URL;

  try {
    const blob = new Blob([new Uint8Array(buffer)], {
      type: mimeType || "application/octet-stream",
    });
    const form = new FormData();
    form.append("mediaFile", blob, storedFileName);
    form.append("type", "warranty");

    const response = await fetch(endpoint, {
      method: "POST",
      body: form,
    });

    const responseText = await response.text();

    if (!response.ok) {
      return {
        success: false,
        error: `Remote upload failed (HTTP ${response.status})`,
      };
    }

    try {
      const json = JSON.parse(responseText) as {
        success?: boolean;
        fileUrl?: string;
        message?: string;
      };
      if (json.success && json.fileUrl) {
        return { success: true, remote_url: json.fileUrl };
      }
      return {
        success: false,
        error: json.message || "Remote upload returned failure",
      };
    } catch {
      const url = responseText.trim();
      if (url.startsWith("http")) {
        return { success: true, remote_url: url };
      }
      return { success: false, error: "Invalid remote upload response" };
    }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Network error during remote upload",
    };
  }
}
