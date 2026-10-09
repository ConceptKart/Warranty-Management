"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

function safeNextPath(raw: string | null): string {
  if (!raw || !raw.startsWith("/admin")) return "/admin";
  if (raw.startsWith("//") || raw.includes("://")) return "/admin";
  return raw;
}

export default function AdminLoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      const response = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });

      const data = (await response.json()) as {
        success?: boolean;
        error?: string;
      };

      if (!response.ok || !data.success) {
        setError(data.error ?? "Invalid username or password");
        return;
      }

      const next = new URLSearchParams(window.location.search).get("next");
      router.replace(safeNextPath(next));
      router.refresh();
    } catch {
      setError("Unable to sign in. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-split tw:flex tw:min-h-screen tw:w-full tw:bg-white tw:font-sans">
      <aside className="tw:relative tw:hidden tw:w-1/2 tw:overflow-hidden tw:bg-[#12082b] tw:lg:flex tw:lg:flex-col tw:lg:justify-center tw:px-12 tw:xl:px-20">
        <div
          aria-hidden
          className="tw:pointer-events-none tw:absolute tw:inset-0"
          style={{
            background: `
              radial-gradient(ellipse 70% 55% at 15% 45%, rgba(124, 58, 237, 0.55), transparent 60%),
              radial-gradient(ellipse 55% 50% at 55% 70%, rgba(79, 70, 229, 0.45), transparent 55%),
              radial-gradient(ellipse 45% 40% at 80% 25%, rgba(99, 102, 241, 0.35), transparent 50%),
              linear-gradient(160deg, #0b0618 0%, #1a0b3a 45%, #12082b 100%)
            `,
          }}
        />
        <div className="tw:relative tw:z-10 tw:max-w-md">
          <p className="tw:mb-4 tw:text-xs tw:font-semibold tw:tracking-[0.22em] tw:text-violet-300/90 tw:uppercase">
            Business Workspace
          </p>
          <h1 className="tw:mb-5 tw:text-4xl tw:font-bold tw:leading-tight tw:tracking-tight tw:text-white tw:xl:text-5xl">
            E-Commerce Portal
          </h1>
          <p className="tw:max-w-sm tw:text-base tw:leading-relaxed tw:text-violet-100/70">
            Manage your business account and keep your commerce operations
            organized in one secure place.
          </p>
        </div>
      </aside>

      <main className="tw:relative tw:flex tw:w-full tw:flex-col tw:bg-white tw:lg:w-1/2">
        <div className="tw:absolute tw:top-6 tw:left-6 tw:sm:top-8 tw:sm:left-10">
          <Link
            href="/"
            className="tw:inline-flex tw:items-center tw:gap-1.5 tw:text-sm tw:text-slate-500 tw:no-underline tw:transition-colors tw:hover:text-slate-800"
          >
            <span aria-hidden>←</span> Back to portal
          </Link>
        </div>

        <div className="tw:flex tw:flex-1 tw:items-center tw:justify-center tw:px-6 tw:py-20 tw:sm:px-10">
          <div className="tw:w-full tw:max-w-[400px]">
            <header className="tw:mb-8">
              <h2 className="tw:mb-2 tw:text-3xl tw:font-bold tw:tracking-tight tw:text-slate-950">
                Welcome back
              </h2>
              <p className="tw:text-[15px] tw:text-slate-500">
                Sign in to continue as an admin.
              </p>
            </header>

            {error ? (
              <div
                className="tw:mb-4 tw:rounded-lg tw:border tw:border-red-200 tw:bg-red-50 tw:px-3 tw:py-2.5 tw:text-sm tw:text-red-700"
                role="alert"
              >
                {error}
              </div>
            ) : null}

            <form onSubmit={onSubmit} className="tw:space-y-5">
              <div>
                <label
                  htmlFor="username"
                  className="tw:mb-1.5 tw:block tw:text-sm tw:font-medium tw:text-slate-800"
                >
                  Username <span className="tw:text-red-500">*</span>
                </label>
                <input
                  id="username"
                  type="text"
                  autoComplete="username"
                  autoFocus
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Enter username"
                  className="tw:w-full tw:rounded-lg tw:border tw:border-slate-300 tw:bg-white tw:px-3.5 tw:py-2.5 tw:text-[15px] tw:text-slate-900 tw:outline-none tw:transition-shadow tw:placeholder:text-slate-400 tw:focus:border-violet-500 tw:focus:ring-2 tw:focus:ring-violet-500/20"
                />
              </div>

              <div>
                <label
                  htmlFor="password"
                  className="tw:mb-1.5 tw:block tw:text-sm tw:font-medium tw:text-slate-800"
                >
                  Password <span className="tw:text-red-500">*</span>
                </label>
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  className="tw:w-full tw:rounded-lg tw:border tw:border-slate-300 tw:bg-white tw:px-3.5 tw:py-2.5 tw:text-[15px] tw:text-slate-900 tw:outline-none tw:transition-shadow tw:placeholder:text-slate-400 tw:focus:border-violet-500 tw:focus:ring-2 tw:focus:ring-violet-500/20"
                />
                <label className="tw:mt-2.5 tw:flex tw:cursor-pointer tw:items-center tw:gap-2 tw:text-sm tw:text-slate-600">
                  <input
                    type="checkbox"
                    checked={showPassword}
                    onChange={(e) => setShowPassword(e.target.checked)}
                    className="tw:size-4 tw:rounded tw:border-slate-300 tw:text-violet-600 tw:accent-violet-600"
                  />
                  Show password
                </label>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="tw:mt-1 tw:w-full tw:rounded-xl tw:bg-linear-to-r tw:from-violet-600 tw:to-indigo-600 tw:px-4 tw:py-3 tw:text-[15px] tw:font-semibold tw:text-white tw:shadow-[0_10px_28px_rgba(109,40,217,0.45)] tw:transition tw:hover:brightness-105 tw:disabled:cursor-not-allowed tw:disabled:opacity-70"
              >
                {loading ? "Signing in…" : "Login as Admin"}
              </button>
            </form>
          </div>
        </div>
      </main>
    </div>
  );
}
