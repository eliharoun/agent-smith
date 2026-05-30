// src/io/atlassian-bridge.ts
//
// Translates smith's unified Atlassian auth (SMITH_ATLASSIAN_*) into
// the per-product env-var names that the langpingxue/atlassian-skills
// Python scripts read at runtime (JIRA_*, CONFLUENCE_*).

export interface BridgeInput {
  email: string;
  token: string;
  baseUrl: string;
}

export interface BridgeOutput {
  JIRA_URL: string;
  JIRA_USERNAME: string;
  JIRA_API_TOKEN: string;
  CONFLUENCE_URL: string;
  CONFLUENCE_USERNAME: string;
  CONFLUENCE_API_TOKEN: string;
}

export function bridgeAtlassianAuthToPerProductEnv(input: BridgeInput): BridgeOutput {
  const trimmedBase = input.baseUrl.replace(/\/$/, "");
  const confluenceUrl = isAtlassianCloudUrl(input.baseUrl) ? `${trimmedBase}/wiki` : trimmedBase;
  return {
    JIRA_URL: trimmedBase,
    JIRA_USERNAME: input.email,
    JIRA_API_TOKEN: input.token,
    CONFLUENCE_URL: confluenceUrl,
    CONFLUENCE_USERNAME: input.email,
    CONFLUENCE_API_TOKEN: input.token,
  };
}

function isAtlassianCloudUrl(url: string): boolean {
  try {
    return new URL(url).hostname.toLowerCase().endsWith(".atlassian.net");
  } catch {
    return false;
  }
}

export type BridgeDriftStatus =
  | { status: "in-sync" }
  | { status: "not-bridged"; reasons: string[] }
  | { status: "drift"; reasons: string[] };

/**
 * Compare the smith unified vars to the per-product vars in a flat
 * key-value map. Used by doctor's atlassian-auth section to surface drift.
 */
export function detectBridgeDrift(envVars: Record<string, string>): BridgeDriftStatus {
  const smithEmail = envVars["SMITH_ATLASSIAN_EMAIL"];
  const smithToken = envVars["SMITH_ATLASSIAN_API_TOKEN"];
  const smithBaseUrl = envVars["SMITH_ATLASSIAN_BASE_URL"];

  if (!smithEmail || !smithToken || !smithBaseUrl) {
    return { status: "not-bridged", reasons: ["SMITH_ATLASSIAN_* vars not all set"] };
  }

  const expected = bridgeAtlassianAuthToPerProductEnv({
    email: smithEmail,
    token: smithToken,
    baseUrl: smithBaseUrl,
  });

  const reasons: string[] = [];
  for (const [key, expectedValue] of Object.entries(expected)) {
    const actual = envVars[key];
    if (actual === undefined) {
      reasons.push(`${key} not set`);
    } else if (actual !== expectedValue) {
      reasons.push(`${key} drift: actual=${actual}, expected=${expectedValue}`);
    }
  }

  if (reasons.length === 0) return { status: "in-sync" };
  if (reasons.every((r) => r.endsWith(" not set"))) {
    return { status: "not-bridged", reasons };
  }
  return { status: "drift", reasons };
}
