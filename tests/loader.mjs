import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const root = fileURLToPath(new URL("..", import.meta.url));
const srcDir = path.join(root, "src");
const mocksDir = path.join(root, "tests", "mocks");

const MOCKS = {
  "@/lib/db": "db.mjs",
  "@/lib/db-external-shipway": "db-external-shipway.mjs",
  "@/lib/auth/get-session": "auth-get-session.mjs",
  "@/components/portal/portal-shell": "portal-shell.mjs",
  "@prisma/client": "prisma-client.mjs",
  "next/link": "next-link.mjs",
  nodemailer: "nodemailer.mjs",
};

function findSource(base) {
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, "index.ts"),
    path.join(base, "index.tsx"),
  ];
  return candidates.find((c) => existsSync(c) && statSync(c).isFile()) ?? null;
}

function isInside(dir, file) {
  const rel = path.relative(dir, file);
  return Boolean(rel) && !rel.startsWith("..") && !path.isAbsolute(rel);
}

export async function resolve(specifier, context, nextResolve) {
  if (Object.hasOwn(MOCKS, specifier)) {
    return {
      url: pathToFileURL(path.join(mocksDir, MOCKS[specifier])).href,
      shortCircuit: true,
    };
  }

  if (specifier.startsWith("@/")) {
    const file = findSource(path.join(srcDir, specifier.slice(2)));
    if (file) return { url: pathToFileURL(file).href, shortCircuit: true };
  }

  if (specifier.startsWith(".") && context.parentURL?.startsWith("file:")) {
    const parent = fileURLToPath(context.parentURL);
    if (isInside(srcDir, parent)) {
      const file = findSource(path.resolve(path.dirname(parent), specifier));
      if (file) return { url: pathToFileURL(file).href, shortCircuit: true };
    }
  }

  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    // Packages without an "exports" map (e.g. next/server) need the extension under ESM.
    if (/^[@a-z]/i.test(specifier) && !path.extname(specifier)) {
      return nextResolve(`${specifier}.js`, context);
    }
    throw error;
  }
}

export async function load(url, context, nextLoad) {
  if (url.startsWith("file:") && /\.tsx?$/.test(url)) {
    const filename = fileURLToPath(url);
    const { outputText } = ts.transpileModule(readFileSync(filename, "utf8"), {
      fileName: filename,
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true,
      },
    });
    return { format: "module", source: outputText, shortCircuit: true };
  }
  return nextLoad(url, context);
}
