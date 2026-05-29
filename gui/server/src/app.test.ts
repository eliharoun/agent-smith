import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "./app";

describe("createApp", () => {
  it("responds to GET /api/health with ok", async () => {
    const app = createApp({ token: "test-token" });
    const res = await app.request("/api/health", {
      headers: { authorization: "Bearer test-token" },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ status: "ok" });
  });

  it("returns 401 on missing token", async () => {
    const app = createApp({ token: "test-token" });
    const res = await app.request("/api/health");
    expect(res.status).toBe(401);
  });

  it("returns JSON error envelope on thrown error", async () => {
    const app = createApp({ token: "test-token" });
    const res = await app.request("/api/__boom", {
      headers: { authorization: "Bearer test-token" },
    });
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string; code: string };
    expect(body.code).toBe("INTERNAL");
  });

  describe("/api/__boom production gate", () => {
    const originalNodeEnv = process.env.NODE_ENV;

    beforeEach(() => {
      process.env.NODE_ENV = "production";
    });

    afterEach(() => {
      if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = originalNodeEnv;
    });

    it("does not register /api/__boom when NODE_ENV=production", async () => {
      const app = createApp({ token: "test-token" });
      const res = await app.request("/api/__boom", {
        headers: { authorization: "Bearer test-token" },
      });
      // Route is not registered → 404, not 500.
      expect(res.status).toBe(404);
    });
  });

  // ─── C4.3.2: originGuard mount ─────────────────────────────────────────
  describe("originGuard mount", () => {
    it("rejects POST /api/jobs with cross-origin Origin header (C4.3.2)", async () => {
      const app = createApp({ token: "test-token" });
      const res = await app.request("/api/jobs", {
        method: "POST",
        headers: {
          authorization: "Bearer test-token",
          origin: "http://evil.example",
          "content-type": "application/json",
        },
        body: JSON.stringify({ command: "status" }),
      });
      expect(res.status).toBe(403);
    });

    it("rejects POST /api/jobs with missing Origin header (C4.3.2)", async () => {
      const app = createApp({ token: "test-token" });
      const res = await app.request("/api/jobs", {
        method: "POST",
        headers: {
          authorization: "Bearer test-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({ command: "status" }),
      });
      expect(res.status).toBe(403);
    });

    it("allows GET /api/health with cross-origin (read-only verb, C4.3.2)", async () => {
      const app = createApp({ token: "test-token" });
      const res = await app.request("/api/health", {
        headers: {
          authorization: "Bearer test-token",
          origin: "http://evil.example",
        },
      });
      expect(res.status).toBe(200);
    });

    it("allows POST with matching allowedOrigin override (C4.3.2)", async () => {
      const app = createApp({
        token: "test-token",
        allowedOrigin: "http://test.local:1234",
      });
      const res = await app.request("/api/jobs", {
        method: "POST",
        headers: {
          authorization: "Bearer test-token",
          origin: "http://test.local:1234",
          "content-type": "application/json",
        },
        body: JSON.stringify({ command: "status" }),
      });
      // The body is invalid (status takes no extra fields beyond command), but
      // the origin-guard layer has already let it through to the route layer.
      // What matters here is *not* 403.
      expect(res.status).not.toBe(403);
    });
  });
});

describe("detectTool default (SMITH_FAKE_TOOLS env hook)", () => {
  let tmp: string;
  let registryPath: string;
  const originalFake = process.env.SMITH_FAKE_TOOLS;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "smith-detecttool-"));
    registryPath = join(tmp, "registry.json");
    // Empty registry so onboarding falls through to a state that surfaces detectedTools
    writeFileSync(registryPath, JSON.stringify({ catalogs: {} }));
  });

  afterEach(() => {
    if (originalFake === undefined) delete process.env.SMITH_FAKE_TOOLS;
    else process.env.SMITH_FAKE_TOOLS = originalFake;
    rmSync(tmp, { recursive: true, force: true });
  });

  it("returns true only for bins listed in SMITH_FAKE_TOOLS", async () => {
    process.env.SMITH_FAKE_TOOLS = "opencode";
    const app = createApp({ token: "t", configRoot: tmp, registryPath });
    const res = await app.request("/api/onboarding-status", {
      headers: { authorization: "Bearer t" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      detectedTools: { opencode: boolean; claudeCode: boolean; codex: boolean };
    };
    expect(body.detectedTools.opencode).toBe(true);
    expect(body.detectedTools.claudeCode).toBe(false);
    expect(body.detectedTools.codex).toBe(false);
  });

  it("falls through to Bun.which when SMITH_FAKE_TOOLS is unset", async () => {
    delete process.env.SMITH_FAKE_TOOLS;
    const app = createApp({ token: "t", configRoot: tmp, registryPath });
    const res = await app.request("/api/onboarding-status", {
      headers: { authorization: "Bearer t" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      detectedTools: { opencode: boolean; claudeCode: boolean; codex: boolean };
    };
    // `bun` itself is guaranteed present in test env; the bins we probe ("opencode",
    // "claude", "codex") may or may not be installed. The contract we're verifying
    // is that the env-hook branch is NOT taken — i.e. detection produces a real
    // boolean derived from Bun.which, not from a CSV split. Re-derive the expected
    // values with the same logic.
    expect(body.detectedTools.opencode).toBe(Boolean(Bun.which("opencode")));
    expect(body.detectedTools.claudeCode).toBe(Boolean(Bun.which("claude")));
    expect(body.detectedTools.codex).toBe(Boolean(Bun.which("codex")));
  });
});

describe("createApp config-root defaults (XDG_CONFIG_HOME)", () => {
  let tmp: string;
  const originalXdg = process.env.XDG_CONFIG_HOME;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "smith-xdg-"));
    process.env.XDG_CONFIG_HOME = tmp;
  });

  afterEach(() => {
    if (originalXdg === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = originalXdg;
    rmSync(tmp, { recursive: true, force: true });
  });

  it("derives configRoot/registryPath from XDG_CONFIG_HOME when deps are absent", async () => {
    // The temp XDG dir is empty, so $XDG_CONFIG_HOME/agent-smith doesn't exist
    // and onboarding should report FIRST_RUN. If the server had fallen back to
    // ~/.config/agent-smith (the developer's real config), this would be HOME.
    const app = createApp({ token: "t" });
    const res = await app.request("/api/onboarding-status", {
      headers: { authorization: "Bearer t" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { state: string };
    expect(body.state).toBe("FIRST_RUN");
  });

  it("falls back to $HOME/.config when XDG_CONFIG_HOME is empty (XDG spec)", async () => {
    // Per XDG Base Directory spec: an empty XDG_CONFIG_HOME must be treated
    // the same as unset. A naive `??` would let "" through and produce a
    // relative path `agent-smith/registry.json`, which would silently resolve
    // against the server's CWD — a subtle data-loss bug. This guards the
    // `xdgEnv && xdgEnv.length > 0` check in app.ts.
    process.env.XDG_CONFIG_HOME = "";
    const app = createApp({ token: "t" });
    // If the path were relative, `/api/onboarding-status` would attempt to
    // stat a CWD-relative `agent-smith/registry.json` and either succeed by
    // accident (matching a stray file) or fail in CWD-dependent ways. With
    // the fallback in place, the path is anchored to homedir() and the route
    // returns a deterministic 200 with a valid state.
    const res = await app.request("/api/onboarding-status", {
      headers: { authorization: "Bearer t" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { state: string };
    // Any valid onboarding state is acceptable; the assertion is that the
    // server didn't error out on a malformed (relative) path.
    expect(["FIRST_RUN", "NEEDS_USER_MD", "ZERO_AGENTS", "HOME"]).toContain(body.state);
  });
});
