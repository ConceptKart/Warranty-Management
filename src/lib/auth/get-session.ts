import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getIronSession } from "iron-session";
import {
  assertSessionSecret,
  sessionOptions,
  type SessionData,
} from "@/lib/auth/session";

export async function getSession(request?: Request) {
  assertSessionSecret();
  if (request) {
    const res = new NextResponse();
    const fromRequest = await getIronSession<SessionData>(
      request,
      res,
      sessionOptions,
    );
    if (fromRequest.adminUser) return fromRequest;
  }
  return getIronSession<SessionData>(await cookies(), sessionOptions);
}

export async function requireAdminSession() {
  const session = await getSession();
  if (!session.adminUser) {
    return null;
  }
  return session;
}
