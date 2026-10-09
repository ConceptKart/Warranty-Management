import { cookies } from "next/headers";
import { getIronSession } from "iron-session";
import {
  assertSessionSecret,
} from "@/lib/auth/session";
import {
  portalSessionOptions,
  type PortalSessionData,
} from "@/lib/portal/session";

export async function getPortalSession() {
  assertSessionSecret();
  return getIronSession<PortalSessionData>(
    await cookies(),
    portalSessionOptions,
  );
}
