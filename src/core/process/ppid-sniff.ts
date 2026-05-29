/**
 * PPID sniffer: extract `--profile <name>` from the parent process command
 * line so `refresh-session --platform codex` can scope refresh to the agent
 * the user actually launched.
 *
 * Linux:  read /proc/<ppid>/cmdline (NUL-separated argv).
 * macOS:  spawn `ps -o args= -p <ppid>` with a 1s timeout.
 * Windows: not supported in v0.15 (see spec §11.2); returns undefined.
 *
 * All OS-touching paths soft-fail: any error → undefined. Only the pure
 * extractor (`extractProfileFromArgv`) and the cmdline normaliser
 * (`parseProcCmdline`) are unit-tested; the OS readers are deferred to
 * integration coverage.
 */
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { platform } from "node:os";

/**
 * Convert NUL-separated /proc/<pid>/cmdline bytes into a space-separated
 * argv string. Empty segments (including the trailing NUL Linux always
 * appends) are filtered.
 */
export function parseProcCmdline(raw: string): string {
  return raw
    .split("\0")
    .filter((s) => s.length > 0)
    .join(" ");
}

/**
 * Parse a flattened argv string and return the value of `--profile` /
 * `--profile=<v>` / `-p <v>` — but only when argv[0]'s basename is `codex`.
 * Returns undefined if the parent isn't codex, or no profile flag is set.
 *
 * Tokeniser honours double-quoted segments (ps on macOS quotes args that
 * contain spaces). It does NOT handle backslash escapes or single quotes —
 * those don't appear in practice for codex invocations.
 */
export function extractProfileFromArgv(argv: string): string | undefined {
  const trimmed = argv.trim();
  if (trimmed.length === 0) return undefined;

  const tokens: string[] = [];
  let buf = "";
  let inQuote = false;
  for (const ch of trimmed) {
    if (ch === '"') {
      inQuote = !inQuote;
      continue;
    }
    if (ch === " " && !inQuote) {
      if (buf.length > 0) {
        tokens.push(buf);
        buf = "";
      }
      continue;
    }
    buf += ch;
  }
  if (buf.length > 0) tokens.push(buf);

  const first = tokens[0];
  if (first === undefined) return undefined;
  const exe = first.split("/").pop();
  if (exe !== "codex") return undefined;

  for (let i = 1; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok === undefined) continue;
    if (tok === "--profile" || tok === "-p") return tokens[i + 1];
    if (tok.startsWith("--profile=")) return tok.slice("--profile=".length);
  }
  return undefined;
}

/**
 * Read the parent process's full command line, normalised to a single
 * space-separated string. Returns undefined on any failure (no parent,
 * unsupported OS, read error, ps timeout, etc.).
 */
export async function readParentCmdline(): Promise<string | undefined> {
  const pid = process.ppid;
  if (!pid || pid <= 1) return undefined;
  const os = platform();
  if (os === "linux") {
    try {
      const raw = await readFile(`/proc/${pid}/cmdline`, "utf8");
      return parseProcCmdline(raw);
    } catch {
      return undefined;
    }
  }
  if (os === "darwin") {
    return new Promise<string | undefined>((resolve) => {
      let settled = false;
      const finish = (v: string | undefined) => {
        if (settled) return;
        settled = true;
        resolve(v);
      };
      const child = spawn("ps", ["-o", "args=", "-p", String(pid)]);
      let out = "";
      child.stdout?.on("data", (d: Buffer) => {
        out += d.toString();
      });
      child.on("close", (code) => finish(code === 0 ? out.trim() : undefined));
      child.on("error", () => finish(undefined));
      setTimeout(() => {
        try {
          child.kill();
        } catch {}
        finish(undefined);
      }, 1000);
    });
  }
  return undefined;
}

/**
 * High-level helper: read parent cmdline + extract codex profile. Returns
 * undefined when the parent isn't codex or no `--profile` was passed.
 */
export async function sniffParentProfile(): Promise<string | undefined> {
  const cmd = await readParentCmdline();
  if (!cmd) return undefined;
  return extractProfileFromArgv(cmd);
}
