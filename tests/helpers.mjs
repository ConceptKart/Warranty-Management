import { inspect } from "node:util";

/** Sets (or deletes, for null/undefined) env vars; returns a function restoring the previous values. */
export function setEnv(vars) {
  const previous = {};
  for (const [key, value] of Object.entries(vars)) {
    previous[key] = process.env[key];
    if (value == null) delete process.env[key];
    else process.env[key] = value;
  }
  return () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  };
}

export function captureConsole() {
  const original = { log: console.log, warn: console.warn, error: console.error };
  const lines = [];
  for (const level of Object.keys(original)) {
    console[level] = (...args) => {
      lines.push(
        args.map((a) => (typeof a === "string" ? a : inspect(a, { depth: 6 }))).join(" "),
      );
    };
  }
  return {
    text: () => lines.join("\n"),
    restore: () => Object.assign(console, original),
  };
}

/** Replaces global fetch; any request without a configured responder fails the test. */
export function installFetchStub() {
  const original = globalThis.fetch;
  const calls = [];
  let handler = (url) => {
    throw new Error(`Unexpected network call in test: ${url}`);
  };
  globalThis.fetch = async (input, init = {}) => {
    calls.push({ url: String(input), init });
    return handler(String(input), init);
  };
  return {
    calls,
    respondWith(fn) {
      handler = fn;
    },
    restore() {
      globalThis.fetch = original;
    },
  };
}

export function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
