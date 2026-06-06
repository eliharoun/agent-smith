import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, readFile, mkdir, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exportAgent } from "../../src/cli/commands/export";
import { readArchive } from "../../src/io/archive-tar";

let home: string;
let prevXdg: string | undefined;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "agent-export-"));
  prevXdg = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = home;
});

afterEach(async () => {
  if (prevXdg === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = prevXdg;
  await rm(home, { recursive: true, force: true });
});

async function seedBundle(): Promise<string> {
  const fixture = join(import.meta.dir, "..", "_fixtures", "export-bundle-minimal");
  // stateHome() = join(XDG_CONFIG_HOME, "agent-smith"); default source rootPath = stateHome()/agents
  const dest = join(home, "agent-smith", "agents", "minimal-bundle");
  await mkdir(dest, { recursive: true });
  for (const f of ["agent.config.json", "IDENTITY.md", "EXPERTISE.md", "SOUL.md", "USER.md"]) {
    await copyFile(join(fixture, f), join(dest, f));
  }
  return dest;
}

describe("smith agent export", () => {
  test("writes the artifact under --to and prints a summary", async () => {
    await seedBundle();
    const outDir = await mkdtemp(join(tmpdir(), "agent-export-out-"));
    try {
      const result = await exportAgent("minimal-bundle", {
        to: outDir,
        includeSkills: false,
        userMd: "stub",
        compression: "gzip",
        json: false,
        dryRun: false,
        stdout: false,
      });
      expect(result.exitCode).toBe(0);
      expect(result.artifactPath).toMatch(/minimal-bundle-.*\.smith-bundle\.tgz$/);
      const archive = await readFile(result.artifactPath!);
      const entries = await readArchive(archive);
      expect(entries.map((e) => e.path)).toContain("minimal-bundle/agent.config.json");
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });

  test("--dry-run prints the manifest and writes nothing", async () => {
    await seedBundle();
    const outDir = await mkdtemp(join(tmpdir(), "agent-export-out-"));
    try {
      const result = await exportAgent("minimal-bundle", {
        to: outDir,
        includeSkills: false,
        userMd: "stub",
        compression: "gzip",
        json: true,
        dryRun: true,
        stdout: false,
      });
      expect(result.exitCode).toBe(0);
      expect(result.artifactPath).toBeUndefined();
      expect(result.manifestJson).toBeDefined();
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });

  test("exits 1 when bundle is missing", async () => {
    const result = await exportAgent("not-a-real-bundle", {
      to: home,
      includeSkills: false,
      userMd: "stub",
      compression: "gzip",
      json: false,
      dryRun: false,
      stdout: false,
    });
    expect(result.exitCode).toBe(1);
  });

  test("--stdout streams archive bytes to process.stdout", async () => {
    await seedBundle();

    const original = process.stdout.write.bind(process.stdout);
    const chunks: Buffer[] = [];
    process.stdout.write = ((data: string | Uint8Array) => {
      chunks.push(typeof data === "string" ? Buffer.from(data) : Buffer.from(data));
      return true;
    }) as typeof process.stdout.write;

    try {
      const result = await exportAgent("minimal-bundle", {
        to: ".",
        includeSkills: false,
        userMd: "stub",
        compression: "gzip",
        json: false,
        dryRun: false,
        stdout: true,
      });
      expect(result.exitCode).toBe(0);
      expect(result.artifactPath).toBeUndefined();
      const captured = Buffer.concat(chunks);
      // Gzip magic bytes mark the start of a valid gzip stream.
      expect(captured[0]).toBe(0x1f);
      expect(captured[1]).toBe(0x8b);
    } finally {
      process.stdout.write = original;
    }
  });
});

describe("smith agent export --format directory", () => {
  test("writes loose files when --format directory --to <dir>", async () => {
    await seedBundle();
    const outDir = await mkdtemp(join(tmpdir(), "agent-export-dir-out-"));
    try {
      const result = await exportAgent("minimal-bundle", {
        to: outDir,
        format: "directory",
        includeSkills: false,
        userMd: "stub",
        compression: "gzip",
        json: false,
        dryRun: false,
        stdout: false,
        force: false,
        withReadme: false,
        noManifest: false,
      });
      expect(result.exitCode).toBe(0);
      expect(result.outputPath).toBe(join(outDir, "minimal-bundle"));
      expect(existsSync(join(outDir, "minimal-bundle", "agent.config.json"))).toBe(true);
      expect(existsSync(join(outDir, "minimal-bundle", "_smith-export.json"))).toBe(true);
      expect(existsSync(join(outDir, "minimal-bundle", "README.md"))).toBe(false);
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });

  test("rejects --format directory --stdout at parse time", async () => {
    await seedBundle();
    const result = await exportAgent("minimal-bundle", {
      to: ".",
      format: "directory",
      includeSkills: false,
      userMd: "stub",
      compression: "gzip",
      json: false,
      dryRun: false,
      stdout: true,
      force: false,
      withReadme: false,
      noManifest: false,
    });
    expect(result.exitCode).toBe(1);
    expect(result.errorMessage).toContain("stdout");
  });

  test("rejects --format directory --compression none at parse time", async () => {
    await seedBundle();
    const result = await exportAgent("minimal-bundle", {
      to: ".",
      format: "directory",
      includeSkills: false,
      userMd: "stub",
      compression: "none",
      json: false,
      dryRun: false,
      stdout: false,
      force: false,
      withReadme: false,
      noManifest: false,
    });
    expect(result.exitCode).toBe(1);
    expect(result.errorMessage).toContain("compression");
  });

  test("--format directory --dry-run succeeds without --to (manifest preview)", async () => {
    // Regression: the GUI's plan endpoint passes --format directory --dry-run
    // --json without --to. Before the fix, exportBundle's directory branch
    // ran first and rejected the empty/relative output path.
    await seedBundle();
    const result = await exportAgent("minimal-bundle", {
      to: ".",
      format: "directory",
      includeSkills: false,
      userMd: "stub",
      compression: "gzip",
      json: true,
      dryRun: true,
      stdout: false,
      force: false,
      withReadme: false,
      noManifest: false,
    });
    expect(result.exitCode).toBe(0);
    expect(result.manifestJson).toBeDefined();
  });
});
