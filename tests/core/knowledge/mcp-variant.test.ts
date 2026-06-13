import { describe, expect, test } from "bun:test";
import { KnowledgeSourceSchema } from "../../../src/core/knowledge/schema";
import { validateKnowledge } from "../../../src/core/knowledge/validator";
const ok = { id: "kb", delivery: "file" as const };
describe("mcp variant", () => {
  test("valid mcp source parses", () => { const r = KnowledgeSourceSchema.safeParse({ ...ok, type: "mcp", server: "notion", tool: "search", args: { query: "x" } }); expect(r.success).toBe(true); });
  test("missing server/tool rejected", () => { expect(KnowledgeSourceSchema.safeParse({ ...ok, type: "mcp", tool: "search" }).success).toBe(false); expect(KnowledgeSourceSchema.safeParse({ ...ok, type: "mcp", server: "notion" }).success).toBe(false); });
  test("credential-shaped args key rejected", () => { const r = KnowledgeSourceSchema.safeParse({ ...ok, type: "mcp", server: "notion", tool: "search", args: { api_key: "secret" } }); expect(r.success).toBe(false); if (!r.success) expect(JSON.stringify(r.error.issues)).toContain("api_key"); });
});
describe("broadened credential-key denylist", () => {
  const rejected = ["access_token", "client_secret", "refresh_token", "api_key", "apiKey", "private_key", "authorization", "password", "bearer"];
  const accepted = ["query", "space", "jql", "maxResults", "scope"];

  for (const key of rejected) {
    test(`rejects credential-shaped key: ${key}`, () => {
      const r = KnowledgeSourceSchema.safeParse({ ...ok, type: "mcp", server: "s", tool: "t", args: { [key]: "v" } });
      expect(r.success).toBe(false);
    });
  }

  for (const key of accepted) {
    test(`accepts benign key: ${key}`, () => {
      const r = KnowledgeSourceSchema.safeParse({ ...ok, type: "mcp", server: "s", tool: "t", args: { [key]: "v" } });
      expect(r.success).toBe(true);
    });
  }
});

describe("mcp validator warnings", () => {
  test("warns when server not declared", () => { const res = validateKnowledge({ sources: [{ id: "kb", type: "mcp", server: "notion", tool: "search", delivery: "file" } as any] }, { declaredMcpServers: [] }); expect(res.errors).toHaveLength(0); expect(res.warnings.join(" ")).toContain("notion"); });
  test("no warning when server declared", () => { const res = validateKnowledge({ sources: [{ id: "kb", type: "mcp", server: "notion", tool: "search", delivery: "file" } as any] }, { declaredMcpServers: ["notion"] }); expect(res.warnings.join(" ")).not.toContain("not declared"); });
  test("no undeclared-server warning when context omitted", () => { const res = validateKnowledge({ sources: [{ id: "kb", type: "mcp", server: "notion", tool: "search", delivery: "file" } as any] }); expect(res.warnings).toHaveLength(0); });
});
