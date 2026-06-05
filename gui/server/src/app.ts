import { homedir } from "node:os";
import { join } from "node:path";
import type { Platform } from "gui-shared";
import { Hono } from "hono";
import { createBunSpawner } from "./jobs/bun-spawner";
import { createJobHistoryWriter, sweepOldEntries } from "./jobs/job-history";
import { JobManager } from "./jobs/job-manager";
import { authMiddleware } from "./middleware/auth";
import { errorHandler, errorMiddleware } from "./middleware/error";
import { originGuard } from "./middleware/origin-guard";
import { registerAgentsRoutes } from "./routes/agents";
import { registerAtlassianRoute } from "./routes/atlassian";
import { registerCatalogsRoute } from "./routes/catalogs";
import { registerConventionsRoutes } from "./routes/conventions";
import { registerDaemonRoute } from "./routes/daemon";
import { registerDoctorRoute } from "./routes/doctor";
import { registerDriftCheckRoute } from "./routes/drift-check";
import { registerExportsRoute } from "./routes/exports";
import { registerFsShowRoute } from "./routes/fs-show";
import { registerGitVerifyRoute } from "./routes/git-verify";
import { registerHistoryRoute } from "./routes/history";
import { registerImportStageRoute } from "./routes/import-stage";
import { registerInstallStateRoute } from "./routes/install-state";
import { registerInstalledStatusesRoute } from "./routes/installed-statuses";
import { registerJackOutRoute } from "./routes/jack-out";
import { registerJobsRoutes } from "./routes/jobs";
import { registerKnowledgeRoute } from "./routes/knowledge";
import { registerKnowledgeCacheRoute } from "./routes/knowledge-cache";
import { registerMcpRoutes } from "./routes/mcp";
import { registerMcpPickerRoute } from "./routes/mcp-picker";
import { registerModelConfigRoute } from "./routes/model-config";
import { registerOnboardingRoute } from "./routes/onboarding";
import { registerRefreshManifestRoute } from "./routes/refresh-manifest";
import { registerRegistryRoute } from "./routes/registry";
import { registerSettingsRoute } from "./routes/settings";
import { registerSkillsRoute } from "./routes/skills";
import { registerStatusRoute } from "./routes/status";
import { registerUpdateRoute } from "./routes/update";
import { registerUserMdRoute } from "./routes/user-md";
import { defaultGuiJobsPaths, defaultStateRoot } from "./services/cache-paths";
import { defaultInstallPaths } from "./services/installed-status";
import { smithBinaryPath } from "./services/smith-binary";
import { mountStatic } from "./static";

export interface AppDeps {
  token: string;
  jobs?: JobManager;
  registryPath?: string;
  installPathsFor?: (agent: string) => Record<Platform, string>;
  configRoot?: string;
  detectTool?: (bin: string) => Promise<boolean>;
  daemonPidFile?: string;
  guiStatePath?: string;
  smithVersion?: string;
  staticRoot?: string;
  agentSmithHome?: string;
  skillRegistryPath?: string;
  installedSkillsPath?: string;
  /** XDG_STATE_HOME root for daemon + job-history artifacts. */
  stateDir?: string;
  /** Override for daemon heartbeat JSON path. */
  daemonHeartbeatPath?: string;
  /** Override for daemon log path (tailed via SSE). */
  daemonLogPath?: string;
  /** Override for the smith .env file (parsed by SmithEnv). */
  smithEnvPath?: string;
  /** Override for the GUI job-history JSONL file. */
  guiJobsJsonlPath?: string;
  /** Override for the per-job output log directory. */
  guiJobsOutputDir?: string;
  /**
   * v2.1-E: per-platform global MCP config paths used by the wiring routes.
   * Tests inject paths under a tmpdir; production reads HOME and lets the
   * service compute defaults.
   */
  mcpConfigPathsFor?: () => Record<"opencode" | "claude-code" | "codex" | "kiro", string>;
  /** v2.1-E: detected platforms for the wiring routes. Tests inject. */
  detectMcpPlatforms?: () => Promise<Set<"opencode" | "claude-code" | "codex" | "kiro">>;
  /**
   * C4.3.2: same-origin Origin header required on state-changing /api/*
   * requests (CSRF defense, security-audit HIGH-2). The production caller
   * (startGuiServer) computes this from the actual bound host + port. Tests
   * default to a sentinel origin and pass the matching header via the
   * test-headers helper. Thunk form lets startGuiServer defer reading
   * `server.port` until after Bun.serve() returns (ephemeral port=0 case).
   */
  allowedOrigin?: string | (() => string);
}

export function createApp(deps: AppDeps) {
  // Per XDG Base Directory spec: if $XDG_CONFIG_HOME is unset OR empty,
  // fall back to $HOME/.config. `??` only catches undefined/null and would
  // let an empty string produce a relative `agent-smith/...` path.
  const xdgEnv = process.env.XDG_CONFIG_HOME;
  const xdgConfig = xdgEnv && xdgEnv.length > 0 ? xdgEnv : join(homedir(), ".config");
  const registryPath = deps.registryPath ?? join(xdgConfig, "agent-smith", "registry.json");
  // Honors XDG_CONFIG_HOME (via xdgConfig above) in line with the rest of the
  // GUI server. The CLI's `defaultAgentSmithHome()` (in src/cli/install-paths.ts)
  // returns the literal `~/.config/agent-smith`; this composition is equivalent
  // when XDG_CONFIG_HOME is unset and additionally honors XDG when set.
  const agentSmithHome = deps.agentSmithHome ?? join(xdgConfig, "agent-smith");
  const skillRegistryPath = deps.skillRegistryPath ?? join(agentSmithHome, "skill-catalogs.json");
  const installedSkillsPath =
    deps.installedSkillsPath ?? join(agentSmithHome, "installed-skills.json");
  const installPathsFor = deps.installPathsFor ?? defaultInstallPaths;

  // XDG_STATE_HOME for daemon + job-history artifacts. Mirrors
  // defaultStateRoot() but is overridable via deps for tests.
  const stateDir = deps.stateDir ?? defaultStateRoot();
  const daemonPidPath = deps.daemonPidFile ?? join(stateDir, "daemon.pid");
  const daemonHeartbeatPath = deps.daemonHeartbeatPath ?? join(stateDir, "daemon.heartbeat.json");
  const daemonLogPath = deps.daemonLogPath ?? join(stateDir, "daemon.log");
  const smithEnvPath = deps.smithEnvPath ?? join(agentSmithHome, ".env");
  const defaultJobs = defaultGuiJobsPaths(stateDir);
  const guiJobsJsonlPath = deps.guiJobsJsonlPath ?? defaultJobs.jsonlPath;
  const guiJobsOutputDir = deps.guiJobsOutputDir ?? defaultJobs.outputDir;

  // Best-effort sweep of stale history entries on startup. Never throws.
  void sweepOldEntries({ jsonlPath: guiJobsJsonlPath }).catch((err) =>
    console.warn("[app] history sweep failed:", err),
  );

  // Production passes `deps.jobs` (already history-wired via createGuiJobManager).
  // Only the test/standalone path constructs its own manager here, so the
  // history writer is built lazily inside this branch — never orphaned.
  const jobs =
    deps.jobs ??
    new JobManager({
      spawner: createBunSpawner({ binary: smithBinaryPath() }),
      history: createJobHistoryWriter({ jsonlPath: guiJobsJsonlPath, outputDir: guiJobsOutputDir }),
    });

  const app = new Hono();
  app.use("*", errorMiddleware);
  // NOTE: app.onError is REQUIRED in addition to errorMiddleware. Hono 4.12's
  // compose() wraps every handler in its own try/catch and routes thrown
  // errors directly to app.onError, bypassing the outer middleware's catch
  // block. Without this line, HttpError thrown from route handlers (e.g. 400
  // from zod, 409 from lock conflict) would not produce the JSON envelope,
  // and the existing /api/__boom test would fail. See Task 3 / Handoff #2.
  app.onError(errorHandler);
  // C4.3.2: CSRF defense. Mounted before auth so a cross-origin POST is
  // rejected even when the attacker has a valid token (e.g. token leaked
  // via an Authorization-bearing fetch from a hostile page).
  const allowedOrigin = deps.allowedOrigin ?? "http://localhost.test";
  app.use("/api/*", originGuard({ allowedOrigin }));
  app.use("/api/*", authMiddleware(deps.token));

  app.get("/api/health", (c) => c.json({ status: "ok" }));

  // test-only route for error middleware coverage. Gated on NODE_ENV so it
  // never ships in production builds. Test runners (bun test, vitest) don't
  // set NODE_ENV=production by default, so existing tests continue to work.
  if (process.env.NODE_ENV !== "production") {
    app.get("/api/__boom", () => {
      throw new Error("boom");
    });
  }

  registerJobsRoutes(app, jobs);
  // Register the bulk installed-statuses route BEFORE the parametric
  // /api/agents/:name route so static path matching isn't ambiguous.
  registerInstalledStatusesRoute(app, { registryPath, installPathsFor });
  // Per-agent install-state and drift-check. Mounted BEFORE registerAgentsRoutes
  // so the more specific `/api/agents/:name/install-state` and
  // `/api/agents/:name/drift-check` paths are matched before the catch-all
  // parametric routes registered there.
  registerInstallStateRoute(app, { agentSmithHome });
  registerDriftCheckRoute(app, { agentSmithHome, registryPath });
  registerAgentsRoutes(app, { registryPath, installPathsFor });
  registerConventionsRoutes(app);

  const configRoot = deps.configRoot ?? join(xdgConfig, "agent-smith");
  const detectTool =
    deps.detectTool ??
    (async (bin: string) => {
      const fake = process.env.SMITH_FAKE_TOOLS;
      if (fake) return fake.split(",").includes(bin);
      return Boolean(Bun.which(bin));
    });

  registerDoctorRoute(app, jobs);
  registerStatusRoute(app, {
    registryPath,
    ...(deps.smithVersion !== undefined ? { smithVersion: deps.smithVersion } : {}),
  });
  // Resolved here so both the exports route and the settings route share the
  // same values without duplication further down in the function.
  const guiStatePath = deps.guiStatePath ?? join(configRoot, "gui-state.json");
  const currentVersion = deps.smithVersion ?? "unknown";

  registerRegistryRoute(app, { registryPath });
  registerRefreshManifestRoute(app, { agentSmithHome });
  registerExportsRoute(app, { guiStatePath, smithVersion: currentVersion });
  registerFsShowRoute(app);
  registerImportStageRoute(app);
  registerSkillsRoute(app, { skillRegistryPath, installedSkillsPath });
  registerCatalogsRoute(app, { registryPath, skillRegistryPath });
  registerKnowledgeRoute(app, { registryPath, agentSmithHome });
  registerKnowledgeCacheRoute(app, { registryPath, agentSmithHome });
  registerMcpRoutes(app, {
    registryPath,
    ...(deps.mcpConfigPathsFor ? { configPathsFor: deps.mcpConfigPathsFor } : {}),
    ...(deps.detectMcpPlatforms ? { detectInstalled: deps.detectMcpPlatforms } : {}),
  });
  registerMcpPickerRoute(app, { registryPath });
  registerAtlassianRoute(app, {
    envDeps: { smithEnvPath: join(agentSmithHome, ".env") },
    registryPath,
  });
  registerModelConfigRoute(app, {
    smithEnvPath,
    authJsonPath: join(
      process.env.XDG_DATA_HOME || join(homedir(), ".local", "share"),
      "opencode",
      "auth.json",
    ),
    getOpenCodeModels: async () => {
      try {
        // Path is constructed at runtime so the typechecker doesn't enforce
        // rootDir on this module — gui/server has rootDir: "src", but the
        // CLI source lives in ../../../src/. Bun resolves the dynamic import
        // at request time.
        const modelsModulePath = "../../../src/io/opencode-models";
        const mod = (await import(modelsModulePath)) as {
          getOpenCodeModels: () => Promise<string[] | undefined>;
        };
        return await mod.getOpenCodeModels();
      } catch {
        return undefined;
      }
    },
    detectAllPlatforms: async () => {
      // Cross-rootDir dynamic import; same pattern as getOpenCodeModels
      // above. Returns the same matrix shape the doctor route consumes.
      try {
        const authModulePath = "../../../src/io/auth/index";
        const mod = (await import(authModulePath)) as {
          detectAllPlatforms: () => Promise<Record<string, unknown>>;
        };
        return (await mod.detectAllPlatforms()) as Awaited<
          ReturnType<
            NonNullable<import("./services/model-config").ModelConfigDeps["detectAllPlatforms"]>
          >
        >;
      } catch {
        // Detector failed to load (e.g. a build issue). Fall through —
        // readModelConfig handles the missing-deps case by returning
        // an "unknown" matrix.
        throw new Error("detectAllPlatforms failed to load");
      }
    },
    env: process.env,
  });
  registerGitVerifyRoute(app);
  registerOnboardingRoute(app, { configRoot, registryPath, detectTool });

  // Daemon, history, update, jack-out routes.
  registerDaemonRoute(app, {
    daemonPidPath,
    daemonHeartbeatPath,
    daemonLogPath,
    smithEnvPath,
  });
  registerHistoryRoute(app, {
    jsonlPath: guiJobsJsonlPath,
    outputDir: guiJobsOutputDir,
  });
  registerUpdateRoute(app);
  registerJackOutRoute(app);

  registerSettingsRoute(app, { guiStatePath, currentVersion });
  registerUserMdRoute(app, { configRoot });

  if (deps.staticRoot) mountStatic(app, deps.staticRoot);

  return app;
}
