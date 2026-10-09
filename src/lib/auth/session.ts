import { SessionOptions } from "iron-session";

export type AdminSessionUser = {
  userId: number;
  username: string;
  role: string;
  name: string;
};

export type SessionData = {
  adminUser?: AdminSessionUser;
  loginAt?: number;
};

export const sessionOptions: SessionOptions = {
  password: process.env.SESSION_SECRET ?? "dev-session-secret-change-in-production",
  cookieName: "warranty_admin_session",
  cookieOptions: {
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    sameSite: "lax",
    // 8 hours — shorter than legacy PHP 1-year cookie
    maxAge: 60 * 60 * 8,
  },
};

export function assertSessionSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      "SESSION_SECRET must be set in .env and be at least 32 characters",
    );
  }
}
