import { beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runConfigGetCli, runConfigSetCli, runConfigUnsetCli } from "../../src/cli/commands/config";

describe("smith config", () => {
  let envPath: string;
  let output: string[];
  let errors: string[];

  const deps = () => ({
    envPath,
    print: (s: string) => output.push(s),
    printErr: (s: string) => errors.push(s),
    detectProviders: async () => ["anthropic", "github-copilot"],
  });

  beforeEach(async () => {
    const tmp = await mkdtemp(join(tmpdir(), "smith-config-"));
    envPath = join(tmp, ".env");
    output = [];
    errors = [];
  });

  describe("get (no key)", () => {
    test("prints all sections including detected providers", async () => {
      const code = await runConfigGetCli(undefined, deps());
      expect(code).toBe(0);
      const out = output.join("\n");
      expect(out).toContain("Model resolution");
      expect(out).toContain("anthropic");
      expect(out).toContain("github-copilot");
      expect(out).toContain("Preference order");
      expect(out).toContain("Per-tier overrides");
      expect(out).toContain("model.tier.high");
      expect(out).toContain("model.tier.balanced");
      expect(out).toContain("model.tier.fast");
    });

    test("shows value from .env in overrides section", async () => {
      await mkdir(join(envPath, ".."), { recursive: true });
      await writeFile(envPath, "SMITH_TIER_FAST=openai/gpt-4o-mini\n");
      const code = await runConfigGetCli(undefined, deps());
      expect(code).toBe(0);
      const out = output.join("\n");
      expect(out).toContain("openai/gpt-4o-mini");
    });

    test("shows preference order from SMITH_MODEL_PROVIDERS in .env", async () => {
      await mkdir(join(envPath, ".."), { recursive: true });
      await writeFile(envPath, "SMITH_MODEL_PROVIDERS=anthropic,github-copilot\n");
      const code = await runConfigGetCli(undefined, deps());
      expect(code).toBe(0);
      const out = output.join("\n");
      expect(out).toContain("(from .env)");
    });
  });

  describe("get (with key)", () => {
    test("returns value when set in .env", async () => {
      await mkdir(join(envPath, ".."), { recursive: true });
      await writeFile(envPath, "SMITH_TIER_HIGH=anthropic/claude-opus-4\n");
      const code = await runConfigGetCli("model.tier.high", deps());
      expect(code).toBe(0);
      expect(output.join("\n")).toContain("anthropic/claude-opus-4");
    });

    test("returns (unset) when key not in .env", async () => {
      const code = await runConfigGetCli("model.tier.high", deps());
      expect(code).toBe(0);
      expect(output.join("\n")).toContain("(unset)");
    });

    test("errors with list of valid keys for unknown key", async () => {
      const code = await runConfigGetCli("model.unknown", deps());
      expect(code).toBe(1);
      const err = errors.join("\n");
      expect(err).toContain("model.providers");
      expect(err).toContain("model.tier.high");
      expect(err).toContain("model.tier.balanced");
      expect(err).toContain("model.tier.fast");
    });
  });

  describe("set", () => {
    test("writes to .env and round-trips through get", async () => {
      const d = deps();
      const code = await runConfigSetCli("model.tier.high", "anthropic/claude-opus-4", d);
      expect(code).toBe(0);

      // Round-trip via get
      output = [];
      const code2 = await runConfigGetCli("model.tier.high", d);
      expect(code2).toBe(0);
      expect(output.join("\n")).toContain("anthropic/claude-opus-4");
    });

    test("errors with unknown key", async () => {
      const code = await runConfigSetCli("model.unknown", "value", deps());
      expect(code).toBe(1);
      const err = errors.join("\n");
      expect(err).toContain("model.providers");
    });

    test("preserves existing keys in .env", async () => {
      await mkdir(join(envPath, ".."), { recursive: true });
      await writeFile(envPath, "EXISTING_KEY=keep-me\n");
      await runConfigSetCli("model.tier.fast", "openai/gpt-4o-mini", deps());
      const content = await readFile(envPath, "utf8");
      expect(content).toContain("EXISTING_KEY=keep-me");
      expect(content).toContain("SMITH_TIER_FAST=openai/gpt-4o-mini");
    });
  });

  describe("unset", () => {
    test("removes line from .env", async () => {
      await mkdir(join(envPath, ".."), { recursive: true });
      await writeFile(envPath, "SMITH_TIER_HIGH=anthropic/claude-opus-4\n");
      const code = await runConfigUnsetCli("model.tier.high", deps());
      expect(code).toBe(0);
      const content = await readFile(envPath, "utf8");
      expect(content).not.toContain("SMITH_TIER_HIGH");
    });

    test("is idempotent on already-unset key", async () => {
      const code = await runConfigUnsetCli("model.tier.high", deps());
      expect(code).toBe(0);
    });

    test("errors with unknown key", async () => {
      const code = await runConfigUnsetCli("model.unknown", deps());
      expect(code).toBe(1);
      const err = errors.join("\n");
      expect(err).toContain("model.providers");
    });
  });
});
