import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { registerJackOutRoute } from "./jack-out";

type Spawn = (argv: string[]) => Promise<{ stdout: string; exitCode: number }>;

function newApp(spawn: Spawn) {
  const app = new Hono();
  registerJackOutRoute(app, { spawn });
  return app;
}

const SAMPLE = `This will permanently remove:

  Installed agents (2 files):
    /home/u/.claude/agents/a.md
    /home/u/.claude/agents/b.md

  Installed skills (1 skills, 1 paths):
    brainstorming
      /home/u/.claude/skills/brainstorming/SKILL.md

  Smith config (entire directory):
    /home/u/.agent-smith

DRY RUN — no changes made.
`;

describe("GET /api/jack-out/dry-run", () => {
  it("returns rawOutput verbatim", async () => {
    const app = newApp(async () => ({ stdout: SAMPLE, exitCode: 0 }));
    const res = await app.request("/api/jack-out/dry-run");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rawOutput: string; lines: string[] };
    expect(body.rawOutput).toBe(SAMPLE);
  });

  it("extracts indented path lines into lines[]", async () => {
    const app = newApp(async () => ({ stdout: SAMPLE, exitCode: 0 }));
    const res = await app.request("/api/jack-out/dry-run");
    const body = (await res.json()) as { lines: string[] };
    expect(body.lines).toContain("    /home/u/.claude/agents/a.md");
    expect(body.lines).toContain("    /home/u/.agent-smith");
    expect(body.lines.every((l) => /^ {4,}\S/.test(l))).toBe(true);
  });

  it("strips ANSI escapes before parsing", async () => {
    const ansi = `  Installed agents (1 files):\n    \x1B[33m/home/u/.claude/agents/x.md\x1B[0m\n`;
    const app = newApp(async () => ({ stdout: ansi, exitCode: 0 }));
    const res = await app.request("/api/jack-out/dry-run");
    const body = (await res.json()) as { rawOutput: string; lines: string[] };
    expect(body.rawOutput).not.toContain("\x1B[");
    expect(body.lines).toEqual(["    /home/u/.claude/agents/x.md"]);
  });

  it("500 on spawn error", async () => {
    const app = newApp(async () => {
      throw new Error("boom");
    });
    const res = await app.request("/api/jack-out/dry-run");
    expect(res.status).toBe(500);
  });

  it("passes ['jack-out', '--dry-run'] to spawner", async () => {
    let received: string[] = [];
    const app = newApp(async (argv) => {
      received = argv;
      return { stdout: "", exitCode: 0 };
    });
    await app.request("/api/jack-out/dry-run");
    expect(received).toEqual(["jack-out", "--dry-run"]);
  });
});
