import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { Hono } from "hono";
import { parseRegistry } from "../services/parse-registry";

export interface OnboardingDeps {
  configRoot: string;
  registryPath: string;
  detectTool: (bin: string) => Promise<boolean>;
}

const MIN_USER_MD_LEN = 40; // anything shorter is treated as a stub

export function registerOnboardingRoute(app: Hono, deps: OnboardingDeps) {
  app.get("/api/onboarding-status", async (c) => {
    if (!(await exists(deps.configRoot))) {
      return c.json(await body(deps, "FIRST_RUN", 0));
    }
    const userMd = join(deps.configRoot, "USER.md");
    let userMdOk = false;
    try {
      const content = await readFile(userMd, "utf8");
      userMdOk = content.trim().length >= MIN_USER_MD_LEN;
    } catch {
      userMdOk = false;
    }
    if (!userMdOk) {
      return c.json(await body(deps, "NEEDS_USER_MD", 0));
    }
    const reg = await parseRegistry(deps.registryPath);
    let agentCount = 0;
    for (const info of Object.values(reg.catalogs)) agentCount += info.agents.length;
    if (agentCount === 0) {
      return c.json(await body(deps, "ZERO_AGENTS", 0));
    }
    return c.json(await body(deps, "HOME", agentCount));
  });
}

async function body(deps: OnboardingDeps, state: string, agentCount: number) {
  return {
    state,
    detectedTools: {
      opencode: await deps.detectTool("opencode"),
      claudeCode: await deps.detectTool("claude"),
      codex: await deps.detectTool("codex"),
    },
    agentCount,
  };
}

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}
