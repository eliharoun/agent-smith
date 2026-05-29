import { type Dirent, existsSync, readdirSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, extname, join, normalize } from "node:path";
import type { Hono } from "hono";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
};

/**
 * Compare dist/index.html mtime against the newest mtime under `srcRoot`.
 * Throws a fail-fast error if the bundle is missing or stale.
 *
 * Behavior:
 * - Missing dist/index.html → throws "missing" error.
 * - Missing srcRoot (packaged install with only dist/) → no-op.
 * - Newest source mtime > dist mtime → throws "stale" error.
 * - Otherwise → no-op.
 *
 * Skipped entirely when `process.env.SMITH_SKIP_BUNDLE_FRESHNESS_CHECK` is set.
 * Tests use synthetic fixtures and set this flag to bypass; production boot
 * paths leave it unset so a stale bundle fails fast.
 */
export function assertBundleFresh(distRoot: string, srcRoot: string): void {
  if (process.env.SMITH_SKIP_BUNDLE_FRESHNESS_CHECK) return;

  const distIndex = join(distRoot, "index.html");
  let distMtime: number;
  try {
    distMtime = statSync(distIndex).mtimeMs;
  } catch {
    throw new Error(`GUI bundle missing at ${distIndex}; run \`bun run gui:build\``);
  }

  let srcExists = false;
  try {
    srcExists = statSync(srcRoot).isDirectory();
  } catch {
    // src dir not present (e.g. packaged install that ships only dist/).
    return;
  }
  if (!srcExists) return;

  const newestSrc = newestMtimeUnder(srcRoot);
  if (newestSrc > distMtime) {
    throw new Error(
      `GUI bundle is stale (dist/index.html ${new Date(distMtime).toISOString()} ` +
        `older than newest source ${new Date(newestSrc).toISOString()}); ` +
        `run \`bun run gui:build\``,
    );
  }
}

function newestMtimeUnder(root: string): number {
  let max = 0;
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    if (dir === undefined) break;
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      // Skip dependency trees and dotfile dirs (.git, .vite cache, etc).
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile()) {
        try {
          const m = statSync(full).mtimeMs;
          if (m > max) max = m;
        } catch {
          // ignore unreadable file
        }
      }
    }
  }
  return max;
}

export function mountStatic(app: Hono, root: string) {
  // `root` points at gui/web/dist (or a synthetic test fixture). The sibling
  // `src/` directory under the parent is the source-of-truth tree for the
  // freshness check; if it doesn't exist (packaged install) the check is a
  // no-op.
  const srcRoot = join(dirname(root), "src");
  assertBundleFresh(root, srcRoot);

  app.get("*", async (c) => {
    const url = new URL(c.req.url);
    if (url.pathname.startsWith("/api/")) return c.notFound();
    const rel = url.pathname === "/" ? "index.html" : url.pathname.replace(/^\/+/, "");
    const safe = normalize(rel);
    if (safe.startsWith("..")) return c.notFound();
    const target = join(root, safe);
    if (existsSync(target)) {
      const buf = await readFile(target);
      return c.body(buf, 200, {
        "content-type": MIME[extname(target).toLowerCase()] ?? "application/octet-stream",
      });
    }
    const html = await readFile(join(root, "index.html"));
    return c.body(html, 200, { "content-type": "text/html; charset=utf-8" });
  });
}
