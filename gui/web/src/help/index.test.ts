import { describe, expect, it } from "vitest";
import { agentHelp } from "./agent";
import { catalogHelp } from "./catalog";
import { daemonHelp } from "./daemon";
import { getFieldHelp } from "./index";
import { installHelp } from "./install";
import { knowledgeHelp } from "./knowledge";
import { modelHelp } from "./model";
import { permissionHelp } from "./permission";
import { refreshConsentHelp } from "./refreshConsent";
import { wizardHelp } from "./wizard";

describe("getFieldHelp", () => {
  it("returns the entry for a known knowledge key", () => {
    const e = getFieldHelp("knowledge.delivery");
    expect(e).toBeDefined();
    expect(e?.help).toMatch(/inline|file|auto/i);
  });

  it("returns undefined for an unknown key", () => {
    expect(getFieldHelp("does.not.exist")).toBeUndefined();
  });

  it("each knowledge.* registry entry has a non-empty help string ≤ 280 chars", () => {
    const entries = Object.entries(knowledgeHelp);
    expect(entries.length).toBeGreaterThan(0);
    for (const [k, v] of entries) {
      expect(k).toMatch(/^knowledge\./);
      expect(typeof v.help).toBe("string");
      expect(v.help.length).toBeGreaterThan(0);
      // Tooltips stay tight; soft cap matches the canonical schema's `summary` cap.
      expect(v.help.length, `entry ${k} exceeds 280 chars`).toBeLessThanOrEqual(280);
    }
  });

  it("covers the field IDs the knowledge modals reference", () => {
    const required = [
      "knowledge.id",
      "knowledge.type",
      "knowledge.path",
      "knowledge.url",
      "knowledge.include",
      "knowledge.exclude",
      "knowledge.description",
      "knowledge.delivery",
      "knowledge.summary",
      "knowledge.toc",
      "knowledge.retrieval.mode",
      "knowledge.retrieval.mcpUrl",
      "knowledge.materialize",
      "knowledge.refresh.mode",
      "knowledge.refresh.ttl",
      "knowledge.refresh.timeout",
      "knowledge.optional",
      "knowledge.inlineBudgetTokens",
    ];
    for (const k of required) {
      expect(getFieldHelp(k), `missing help entry for ${k}`).toBeDefined();
    }
  });

  // ── Newly-adopted namespaces (Task 31 sweep) ─────────────────────────
  // Each table below covers the keys the GUI panels reference. Adding a
  // new id without wiring it into a panel still passes (registry lookup
  // is decoupled from rendering); adding a new panel reference without
  // a registry entry is caught here.

  const namespaceTables: Array<[string, Record<string, { help: string }>, string[]]> = [
    [
      "agent",
      agentHelp,
      ["agent.targets", "agent.modelTier", "agent.refreshHooksPerPlatform", "agent.mcpToggle"],
    ],
    [
      "model",
      modelHelp,
      ["model.platformStatus", "model.providerPreference", "model.tierOverride"],
    ],
    ["refreshConsent", refreshConsentHelp, ["refreshConsent.platform"]],
    ["catalog", catalogHelp, ["catalog.kind", "catalog.skipGitCheck", "catalog.allowEmpty"]],
    ["permission", permissionHelp, ["permission.action"]],
    ["install", installHelp, ["install.allowMissingCli"]],
    ["daemon", daemonHelp, ["daemon.pullInterval", "daemon.heartbeatInterval"]],
    ["wizard", wizardHelp, ["wizard.template"]],
  ];

  for (const [ns, table, required] of namespaceTables) {
    describe(`${ns}.* namespace`, () => {
      it(`every entry has a non-empty help string ≤ 280 chars`, () => {
        const entries = Object.entries(table);
        expect(entries.length).toBeGreaterThan(0);
        for (const [k, v] of entries) {
          expect(k).toMatch(new RegExp(`^${ns}\\.`));
          expect(typeof v.help).toBe("string");
          expect(v.help.length).toBeGreaterThan(0);
          expect(v.help.length, `entry ${k} exceeds 280 chars`).toBeLessThanOrEqual(280);
        }
      });
      it(`getFieldHelp returns a non-empty entry for every required key`, () => {
        for (const k of required) {
          const e = getFieldHelp(k);
          expect(e, `missing help entry for ${k}`).toBeDefined();
          expect(e?.help.length).toBeGreaterThan(0);
        }
      });
    });
  }
});
