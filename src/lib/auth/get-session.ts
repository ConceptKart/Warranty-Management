import { cookies } from "next/headers";
import { getIronSession } from "iron-session";
import {
  assertSessionSecret,
  sessionOptions,
  type SessionData,
} from "@/lib/auth/session";

export async function getSession() {
  assertSessionSecret();
  return getIronSession<SessionData>(await cookies(), sessionOptions);
}

export async function requireAdminSession() {
  const session = await getSession();
  if (!session.adminUser) {
    return null;
  }
  return session;
}
