// Shared test fixtures for the doctor sections.
//
// The atlassian-auth section of `runDoctor` calls `detectPython()`
// unconditionally when `atlassian-skills` is installed. In production that
// spawns up to three real Python subprocesses; in tests that didn't stub the
// seam it leaked real spawns and timed out (the long-standing flaky
// doctor-test timeouts). These no-spawn stubs make the section hermetic:
// Python "unavailable", no installed skills, no resolved auth — so the section
// reports `not-applicable` without shelling out.

import type { PlatformAuthMatrix } from "../../src/io/auth/types";
import type { InstalledSkillsFile } from "../../src/io/installed-skills";
import type { PythonRuntimeStatus } from "../../src/io/python-runtime";

/** No-spawn Python detection: reports "unavailable" without spawning. */
export const noSpawnDetectPython = async (): Promise<PythonRuntimeStatus> => ({
  binary: null,
  version: null,
  versionOk: false,
  packagesAvailable: { requests: false, dotenv: false },
});

/** Empty installed-skills file: no atlassian-skills => section not relevant. */
export const noInstalledSkillsForAuth = async (): Promise<InstalledSkillsFile> => ({
  schemaVersion: 1,
  installed: [],
});

/** No resolved Atlassian auth. */
export const noAtlassianAuth = () => null;

/**
 * The three atlassian-auth seams in the shape `RunDoctorInput` expects.
 * Spread into a direct `runDoctor({ ... })` input to stop the section from
 * spawning Python.
 */
export const safeAtlassianAuthSeams = {
  detectPython: noSpawnDetectPython,
  loadInstalledSkillsForAuth: noInstalledSkillsForAuth,
  resolveAtlassianAuth: noAtlassianAuth,
} as const;

/**
 * Same seams in the shape `DoctorCliOptions.atlassianAuth` expects. Spread into
 * a `runDoctorCli({ ... })` opts object (under the `atlassianAuth` key) to stop
 * the section from spawning Python.
 */
export const safeAtlassianAuthCliSeams = {
  atlassianAuth: safeAtlassianAuthSeams,
} as const;

// --- model-resolution section ---
//
// The model-resolution section also shells out by default: `detectAllPlatforms`
// (when `platformAuth` is omitted) and `detectAuthenticatedProviders` both probe
// PATH for the platform CLIs, spawning `which`-style subprocesses. These no-spawn
// stubs let a test exercise model-resolution without leaking real spawns.

const cliNotInstalled = (platform: PlatformAuthMatrix[keyof PlatformAuthMatrix]["platform"]) =>
  ({ platform, cliInstalled: false, status: "cli-not-installed" as const }) satisfies
    PlatformAuthMatrix[keyof PlatformAuthMatrix];

/** A no-CLI-installed auth matrix: every platform reports cli-not-installed. */
export const noCliPlatformAuthMatrix: PlatformAuthMatrix = {
  opencode: cliNotInstalled("opencode"),
  "claude-code": cliNotInstalled("claude-code"),
  codex: cliNotInstalled("codex"),
  kiro: cliNotInstalled("kiro"),
  "agents-md": cliNotInstalled("agents-md"),
};

/**
 * Model-resolution seams that keep the section from spawning: an inert auth
 * matrix and a no-spawn provider detector. Spread into a `modelResolution`
 * config object alongside the test's own `getOpenCodeModels` / `installedPaths`.
 */
export const safeModelResolutionAuthSeams = {
  platformAuth: noCliPlatformAuthMatrix,
  detectAuthenticatedProviders: async () => [] as string[],
} as const;

/**
 * Same model-resolution seams in the shape `DoctorCliOptions.modelResolutionAuth`
 * expects. Spread into a `runDoctorCli({ ... })` opts object (under the
 * `modelResolutionAuth` key) so the section never spawns auth probes or fetches
 * the live OpenCode model list. Use on tests that exercise model-resolution but
 * don't set `skipModelResolution`.
 */
export const safeModelResolutionCliSeams = {
  modelResolutionAuth: {
    platformAuth: noCliPlatformAuthMatrix,
    detectAuthenticatedProviders: async () => [] as string[],
    getOpenCodeModels: async () => undefined,
  },
} as const;
