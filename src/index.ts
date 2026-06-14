#!/usr/bin/env bun
import { Command, Option } from "commander";
import { registerAgentCatalogCommands } from "./cli/commands/agent/catalog-rename";
import { registerAgentCommands } from "./cli/commands/agent/register-commands";
import { daemonStart, daemonStatus, daemonStop } from "./cli/commands/daemon";
import { createGuiCommand } from "./cli/commands/gui";
import { init } from "./cli/commands/init";
import { initUser } from "./cli/commands/init-user";
import { install } from "./cli/commands/install";
import { registerSkillCatalogCommands } from "./cli/commands/skill/catalog-rename";
import { skillCatalogs } from "./cli/commands/skill/catalogs";
import { registerSkillInstallCommands } from "./cli/commands/skill/install-cmd";
import { skillList } from "./cli/commands/skill/list";
import { skillRegister } from "./cli/commands/skill/register";
import { skillUnregister } from "./cli/commands/skill/unregister";
import { status } from "./cli/commands/status";
import { collectKv, collectRepeatable, intArg } from "./cli/option-parsers";
import { renderPendingHint } from "./cli/pending-hint";
import { formatCommanderError, wrap } from "./cli/wrap";
import { SmithError } from "./core/smith-error";
import { runDaemon } from "./daemon";
import { detectInstalledPlatforms } from "./io/platform-detect";
import { stateHome } from "./io/state-home";

if (process.env.SMITH_HINT_PENDING === "1") {
  detectInstalledPlatforms()
    .then((installed) =>
      renderPendingHint({ stateHome: stateHome(), installedPlatforms: installed }),
    )
    .then((hint) => {
      if (hint) console.error(hint);
    })
    .catch(() => {
      /* silent — startup hint is best-effort */
    });
}

const program = new Command();
program.name("smith").description("Lifecycle manager for AI coding agents").version("1.20.0");
// Funnel commander's own usage errors (unknown command, missing required option,
// --help, --version) through the catch at the bottom so formatCommanderError()
// renders them with the same prefix as wrap()'s SmithError path.
// IMPORTANT: must be configured BEFORE subcommands are defined — commander only
// copies inherited settings to subcommands at creation time.
program.exitOverride();
program.configureOutput({ writeErr: () => {} });

// Commander gotcha: `.action(handler)` always passes `(positionals..., optionsObj, commandObj)`.
// Wiring `init` directly would call `init({}, Command)`, defeating its `baseDir` default and
// crashing in `path.join`. The arrow drops Commander's tail args so `init()` uses its default.
program
  .command("init")
  .description(`Initialize ${stateHome()}`)
  .action(wrap("init", () => init()));

program
  .command("init-user")
  .description("Edit your USER.md context file")
  .action(wrap("init-user", initUser));

program
  .command("migrate-clones")
  .description(
    "Migrate rc.1 external-repo clones from $XDG_CONFIG_HOME to $XDG_STATE_HOME (one-shot upgrade helper)",
  )
  .option("--dry-run", "Classify each entry without moving files or updating registries")
  .action(
    wrap("migrate-clones", async (opts: { dryRun?: boolean }) => {
      const { migrateClones } = await import("./cli/commands/migrate-clones");
      const result = await migrateClones(opts.dryRun ? { dryRun: true } : {});
      const verb = opts.dryRun ? "would migrate" : "migrated";
      const skipVerb = opts.dryRun ? "would skip" : "skipped";
      if (result.outcomes.length === 0) {
        console.log(
          result.alreadyMigrated > 0
            ? `No rc.1 clones found. ${result.alreadyMigrated} catalog(s) already on the rc.2+ location.`
            : "No external-repo clones found in registry. Nothing to migrate.",
        );
        return 0;
      }
      for (const o of result.outcomes) {
        if (o.status === "migrated") {
          console.log(`✓ ${verb} ${o.kind} '${o.label}'`);
          console.log(`    from: ${o.oldPath}`);
          console.log(`    to:   ${o.newPath}`);
        } else {
          console.log(`! ${skipVerb} ${o.kind} '${o.label}': ${o.reason}`);
          console.log(`    path: ${o.oldPath}`);
        }
      }
      const migrated = result.outcomes.filter((o) => o.status === "migrated").length;
      const skipped = result.outcomes.filter((o) => o.status === "skipped").length;
      console.log("");
      console.log(
        `${verb}: ${migrated}    ${skipVerb}: ${skipped}    already-rc.2: ${result.alreadyMigrated}`,
      );
      return 0;
    }),
  );

const agent = program.command("agent").description("Manage agent bundles, catalogs, and installs");
registerAgentCommands(agent);
// `agent catalog rename <old> <new>` and future catalog-management ops.
registerAgentCatalogCommands(agent);

const skill = program
  .command("skill")
  .description("Manage skill catalogs and (D2) installed skills");

skill
  .command("register <path>")
  .description("Register a directory as a skill catalog")
  .addOption(
    new Option("--kind <kind>", "user-global | user-local | team-shared")
      .choices(["user-global", "user-local", "team-shared"])
      .makeOptionMandatory(true),
  )
  .option("--label <label>", "Human-readable label (defaults to <kind>:<absPath>)")
  .option("--git-remote <url>", "Git remote URL the catalog was cloned from")
  .option("--allow-empty", "Register even if the path contains no skill bundles")
  .option("--skip-git-check", "Bypass git-repo and remote-URL validation")
  .action(
    wrap(
      "skill register",
      async (
        path: string,
        opts: {
          kind: import("./io/skill-registry").SkillCatalogKind;
          label?: string;
          gitRemote?: string;
          allowEmpty?: boolean;
          skipGitCheck?: boolean;
        },
      ) => {
        await skillRegister(path, {
          kind: opts.kind,
          ...(opts.label !== undefined ? { label: opts.label } : {}),
          ...(opts.gitRemote !== undefined ? { gitRemote: opts.gitRemote } : {}),
          ...(opts.allowEmpty !== undefined ? { allowEmpty: opts.allowEmpty } : {}),
          ...(opts.skipGitCheck !== undefined ? { skipGitCheck: opts.skipGitCheck } : {}),
        });
        return 0;
      },
    ),
  );

skill
  .command("unregister <path-or-label>")
  .description("Remove a registered skill catalog (rejects protected catalogs)")
  .option(
    "--purge-clone",
    "Also delete the on-disk clone (only allowed for catalogs under <stateHome>/remote) [v1-task C3.13]",
  )
  .action(
    wrap("skill unregister", (pathOrLabel: string, opts: { purgeClone?: boolean }) =>
      skillUnregister(pathOrLabel, opts.purgeClone ? { purgeClone: true } : {}),
    ),
  );

skill
  .command("list")
  .description("List all skills discovered across registered catalogs")
  .option("--all", "Include skills from adhoc catalogs")
  .action(wrap("skill list", (opts: { all?: boolean }) => skillList(opts)));

skill
  .command("catalogs")
  .description("List registered skill catalogs")
  .action(wrap("skill catalogs", () => skillCatalogs()));

skill
  .command("bootstrap")
  .description("Install bundled the-architect + the-keymaker skills to all platforms")
  .option("--dry-run", "Print what would happen without modifying anything")
  .option(
    "--targets <list>",
    "Comma-separated subset of opencode,claude-code,codex,kiro (default: all four)",
  )
  .action(
    wrap("skill bootstrap", async (opts: { dryRun?: boolean; targets?: string }) => {
      const { runSkillBootstrapCli } = await import("./cli/commands/skill/bootstrap");
      return runSkillBootstrapCli({
        ...(opts.dryRun ? { dryRun: true } : {}),
        ...(opts.targets ? { targets: opts.targets } : {}),
      });
    }),
  );

// D2: install / update / uninstall verbs (state-tracked, content-hashed copies).
registerSkillInstallCommands(skill);

// `skill catalog rename <old> <new>` and future catalog-management ops.
registerSkillCatalogCommands(skill);

const knowledgeCmd = program
  .command("knowledge")
  .description("Manage per-agent knowledge sources")
  // Parent has no useful behavior on its own — but commander's default
  // (silently print help to writeErr) gets swallowed by the top-level
  // configureOutput({ writeErr: () => {} }) suppression we use to funnel
  // commander's own usage errors through formatCommanderError. Provide an
  // explicit action that surfaces a real usage-error via wrap() so bare
  // `smith knowledge` matches the UX of every other subcommand parent and
  // doesn't silently exit 0.
  .action(
    wrap("knowledge", async () => {
      throw new SmithError({
        code: "usage-error",
        message: "requires a subcommand: list, info, fetch, add, validate, wire, or unwire",
        suggestedCommand: "smith knowledge list <agent>",
      });
    }),
  );

knowledgeCmd
  .command("list <agent>")
  .description("List the knowledge sources declared by <agent>")
  .option("--json", "Emit machine-readable JSON instead of human output")
  .action(
    wrap("knowledge list", async (agent: string, opts: { json?: boolean }) => {
      const { knowledgeList } = await import("./cli/commands/knowledge/list");
      const { defaultKnowledgePaths } = await import("./cli/install-paths");
      const { canonicalRegistryPath, loadRegistry } = await import("./io/registry");
      const { loadAllBundles } = await import("./cli/load-all");
      const { defaultCacheRoot } = await import("./io/cache-root");
      const { readRefreshCache } = await import("./core/knowledge/refresh-cache");
      const cacheRoot = defaultCacheRoot();
      return knowledgeList(
        agent,
        defaultKnowledgePaths(),
        {
          loadDeclaredSources: async (name) => {
            const reg = await loadRegistry(canonicalRegistryPath());
            const all = await loadAllBundles(reg);
            const bundle = all.bundles.find((b) => b.config.name === name);
            if (!bundle) return null;
            return bundle.config.knowledge?.sources ?? [];
          },
          readRefreshCache: (sourceId) => readRefreshCache(cacheRoot, agent, sourceId),
        },
        { json: opts.json ?? false },
      );
    }),
  );

knowledgeCmd
  .command("info <agent>")
  .description(
    "Show <agent>'s knowledge index diagnostics (hybrid status, embedder, vector coverage)",
  )
  .option("--json", "Emit machine-readable JSON instead of human output")
  .action(
    wrap("knowledge info", async (agent: string, opts: { json?: boolean }) => {
      const { knowledgeInfo } = await import("./cli/commands/knowledge/info");
      const { defaultKnowledgePaths } = await import("./cli/install-paths");
      const { canonicalRegistryPath, loadRegistry } = await import("./io/registry");
      const { loadAllBundles } = await import("./cli/load-all");
      return knowledgeInfo(
        agent,
        defaultKnowledgePaths(),
        {
          loadDeclaredSources: async (name) => {
            const reg = await loadRegistry(canonicalRegistryPath());
            const all = await loadAllBundles(reg);
            const bundle = all.bundles.find((b) => b.config.name === name);
            if (!bundle) return null;
            return bundle.config.knowledge?.sources ?? [];
          },
        },
        { json: opts.json ?? false },
      );
    }),
  );

knowledgeCmd
  .command("fetch <agent>")
  .description("Fetch (or refresh) <agent>'s knowledge sources into its bundle")
  .option("--source <id>", "Fetch only the source with this id")
  .option(
    "--force-unlock",
    "Drop a stuck per-agent install lock (left by a killed run) before fetching",
  )
  .action(
    wrap(
      "knowledge fetch",
      async (agent: string, opts: { source?: string; forceUnlock?: boolean }) => {
        const { knowledgeFetch } = await import("./cli/commands/knowledge/fetch");
        const { install } = await import("./cli/commands/install");
        return knowledgeFetch(agent, opts.source, {
          install,
          ...(opts.forceUnlock ? { forceUnlock: true } : {}),
        });
      },
    ),
  );

knowledgeCmd
  .command("refresh-session")
  .description(
    "Refresh session-mode knowledge sources for installed agents. Called by platform hooks; soft-fails always.",
  )
  .option("--agent <name>", "Refresh only this agent's session/always sources")
  .option(
    "--platform <id>",
    "Platform that invoked us: claude-code|codex|kiro|opencode. When 'codex' and --agent is omitted, the parent process is sniffed for --profile <name>.",
  )
  .option("--timeout <ms>", "Override the 5s global wall-clock budget", intArg("--timeout"))
  .option("--json", "Emit structured JSON result to stdout")
  .action(
    wrap(
      "knowledge refresh-session",
      async (opts: { agent?: string; timeout?: number; json?: boolean; platform?: string }) => {
        const { knowledgeRefreshSession } = await import(
          "./cli/commands/knowledge/refresh-session"
        );
        const { listInstalledAgentsForRefresh } = await import(
          "./cli/commands/knowledge/refresh-session-agents"
        );
        const { refreshOneSource } = await import("./cli/commands/knowledge/refresh-session-fetch");
        // Narrow string → PlatformFilter; silently drop unknown values
        // (commander has no native enum support and a typo'd --platform
        // shouldn't fail the hook). The runner treats `undefined` as
        // "no platform filter," matching the pre-flag behaviour.
        const platform =
          opts.platform === "claude-code" ||
          opts.platform === "codex" ||
          opts.platform === "kiro" ||
          opts.platform === "opencode"
            ? opts.platform
            : undefined;
        return knowledgeRefreshSession(
          { ...opts, platform },
          {
            listAgents: listInstalledAgentsForRefresh,
            refreshSource: refreshOneSource,
            log: (m) => console.log(m),
            err: (m) => console.error(m),
          },
        );
      },
    ),
  );

knowledgeCmd
  .command("add <agent> <type-or-url> [path-or-url]")
  .description(
    "Add a knowledge source to <agent>'s bundle. Pass an Atlassian/web URL as the second arg for the URL shortcut (no <path-or-url> needed).",
  )
  .option("--id <id>", "Stable id for the source (defaults to a slug of <path-or-url>)")
  .option("--delivery <delivery>", "How the source is delivered: 'inline' or 'file'")
  .option("--description <text>", "Human description shown in `knowledge list`")
  .option("--optional", "Mark this source as optional (won't fail validate if missing)")
  .option("--lazy", "URL sources only: do not fetch at install; agent fetches at runtime")
  .option("--no-install", "Do not auto-run 'smith agent install <agent>' after adding")
  // Confluence-only flags.
  .option(
    "--pages <list>",
    "Confluence: comma-separated page titles or `id:N` refs (e.g. 'Onboarding,id:123,Runbook')",
  )
  .option("--max-pages <n>", "Confluence: maximum page count (1-100)", intArg("--max-pages"))
  .option("--include-children", "Confluence: recurse into child pages")
  .option("--format <fmt>", "Confluence: body format (storage|view|markdown)")
  // Jira-only flags.
  .option("--fields <list>", "Jira: comma-separated field names (or '*all' for every field)")
  .option("--max-results <n>", "Jira: maximum result count (1-500)", intArg("--max-results"))
  // Web-only flags.
  .option("--mode <mode>", "web: crawl | llms-txt | openapi (default crawl)")
  .option("--depth <n>", "web crawl: max link depth (1-5)", intArg("--depth"))
  .option("--same-origin", "web crawl: restrict to seed origin (default on)")
  .option("--no-same-origin", "web crawl: allow cross-origin links")
  .option("--include <glob>", "web crawl: include path glob (repeatable)", collectRepeatable, [])
  .option("--exclude <glob>", "web crawl: exclude path glob (repeatable)", collectRepeatable, [])
  // MCP-only flags.
  .option("--server <name>", "mcp: MCP server name")
  .option("--tool <name>", "mcp: tool to call")
  .option("--arg <k=v>", "mcp: tool argument (repeatable)", collectKv, {})
  .option("--preset <name>", "mcp: preset connector")
  .option("--allow-write-tool", "mcp: permit a write-shaped tool name")
  // Retrieval (all types).
  .option("--retrieval <mode>", "Search mode for this source: off | bm25 | hybrid | external-mcp")
  .option(
    "--retrieval-mcp-url <url>",
    "URL of the external retrieval MCP (required when --retrieval external-mcp)",
  )
  .action(
    wrap(
      "knowledge add",
      async (
        agent: string,
        typeOrUrl: string,
        pathOrUrl: string | undefined,
        opts: {
          id?: string;
          delivery?: string;
          description?: string;
          optional?: boolean;
          lazy?: boolean;
          install?: boolean;
          pages?: string;
          maxPages?: number;
          includeChildren?: boolean;
          format?: string;
          fields?: string;
          maxResults?: number;
          mode?: string;
          depth?: number;
          sameOrigin?: boolean;
          include?: string[];
          exclude?: string[];
          server?: string;
          tool?: string;
          arg?: Record<string, string>;
          preset?: string;
          allowWriteTool?: boolean;
          retrieval?: string;
          retrievalMcpUrl?: string;
        },
      ) => {
        const { knowledgeAdd } = await import("./cli/commands/knowledge/add");
        const { parseAtlassianUrl } = await import("./cli/atlassian-url");
        const { canonicalRegistryPath, loadRegistry } = await import("./io/registry");
        const { findBundleOrFail, loadAllBundles } = await import("./cli/load-all");
        const { SmithError } = await import("./core/smith-error");
        const reg = await loadRegistry(canonicalRegistryPath());
        const all = await loadAllBundles(reg);
        const bundleDir = findBundleOrFail(all, agent).bundlePath;

        // URL-shortcut detection: second positional starts with http(s).
        if (/^https?:\/\//i.test(typeOrUrl)) {
          const parsed = parseAtlassianUrl(typeOrUrl);
          if (parsed === null) {
            throw new SmithError({
              code: "validation-failed",
              what: "URL argument",
              reasons: [`${typeOrUrl}: not a valid http(s) URL`],
            });
          }
          // Translate parsed URL → KnowledgeAddOptions. Flag overrides apply
          // by only filling fields the user did not explicitly pass.
          type AddOpts = Parameters<typeof knowledgeAdd>[0];
          type Base = Omit<AddOpts, "type" | "pathOrUrl">;
          const base: Base = {
            bundleDir,
            agentName: agent,
            installAfter: opts.install !== false,
            runInstall: async (name) => install({ name }),
            ...(opts.id ? { id: opts.id } : {}),
            ...(opts.delivery
              ? {
                  delivery: opts.delivery as import("./core/knowledge/types").KnowledgeDelivery,
                }
              : {}),
            ...(opts.description ? { description: opts.description } : {}),
            ...(opts.optional ? { optional: true } : {}),
            ...(opts.lazy === true ? { lazy: true } : {}),
            ...(opts.retrieval ? { retrieval: opts.retrieval } : {}),
            ...(opts.retrievalMcpUrl ? { retrievalMcpUrl: opts.retrievalMcpUrl } : {}),
          };

          switch (parsed.kind) {
            case "confluence-page":
              return knowledgeAdd({
                ...base,
                type: "confluence",
                pathOrUrl: parsed.space,
                pages: opts.pages ?? `id:${parsed.pageId}`,
                ...(opts.maxPages !== undefined ? { maxPages: opts.maxPages } : {}),
                ...(opts.includeChildren ? { includeChildren: true } : {}),
                format: (opts.format ??
                  "markdown") as import("./core/knowledge/types").ConfluenceFormat,
                urlMode: {
                  label: "Confluence page",
                  titleId: { title: parsed.title, numericId: parsed.pageId },
                },
              });
            case "confluence-blog":
              return knowledgeAdd({
                ...base,
                type: "confluence",
                pathOrUrl: parsed.space,
                pages: opts.pages ?? `id:${parsed.postId}`,
                ...(opts.maxPages !== undefined ? { maxPages: opts.maxPages } : {}),
                ...(opts.includeChildren ? { includeChildren: true } : {}),
                format: (opts.format ??
                  "markdown") as import("./core/knowledge/types").ConfluenceFormat,
                urlMode: {
                  label: "Confluence blog post",
                  titleId: { title: parsed.title, numericId: parsed.postId },
                },
              });
            case "confluence-space":
              return knowledgeAdd({
                ...base,
                type: "confluence",
                pathOrUrl: parsed.space,
                ...(opts.pages ? { pages: opts.pages } : {}),
                ...(opts.maxPages !== undefined ? { maxPages: opts.maxPages } : {}),
                ...(opts.includeChildren ? { includeChildren: true } : {}),
                format: (opts.format ??
                  "markdown") as import("./core/knowledge/types").ConfluenceFormat,
                urlMode: { label: "Confluence space" },
              });
            case "jira-issue":
              return knowledgeAdd({
                ...base,
                type: "jira",
                pathOrUrl: `key = ${parsed.key}`,
                ...(opts.fields ? { fields: opts.fields } : {}),
                ...(opts.maxResults !== undefined ? { maxResults: opts.maxResults } : {}),
                urlMode: { label: "Jira issue" },
              });
            case "jira-jql":
              return knowledgeAdd({
                ...base,
                type: "jira",
                pathOrUrl: parsed.jql,
                ...(opts.fields ? { fields: opts.fields } : {}),
                ...(opts.maxResults !== undefined ? { maxResults: opts.maxResults } : {}),
                urlMode: { label: "Jira JQL query" },
              });
            case "plain-url":
              return knowledgeAdd({
                ...base,
                type: "webpage",
                pathOrUrl: parsed.url,
                urlMode: { label: "plain web URL" },
              });
            default: {
              const _exhaustive: never = parsed;
              throw new Error(`unhandled parsed.kind: ${(_exhaustive as { kind: string }).kind}`);
            }
          }
        }

        // Flag-form path (unchanged from before).
        if (pathOrUrl === undefined && typeOrUrl !== "mcp") {
          throw new SmithError({
            code: "validation-failed",
            what: "knowledge add arguments",
            reasons: [
              "missing <path-or-url> argument (required unless the second arg is an http(s) URL)",
            ],
          });
        }
        return knowledgeAdd({
          bundleDir,
          agentName: agent,
          installAfter: opts.install !== false,
          runInstall: async (name) => install({ name }),
          type: typeOrUrl as import("./core/knowledge/types").KnowledgeSourceType,
          ...(pathOrUrl !== undefined ? { pathOrUrl } : {}),
          ...(opts.id ? { id: opts.id } : {}),
          ...(opts.delivery
            ? { delivery: opts.delivery as import("./core/knowledge/types").KnowledgeDelivery }
            : {}),
          ...(opts.description ? { description: opts.description } : {}),
          ...(opts.optional ? { optional: true } : {}),
          ...(opts.lazy === true ? { lazy: true } : {}),
          ...(opts.pages ? { pages: opts.pages } : {}),
          ...(opts.maxPages !== undefined ? { maxPages: opts.maxPages } : {}),
          ...(opts.includeChildren ? { includeChildren: true } : {}),
          ...(opts.format
            ? { format: opts.format as import("./core/knowledge/types").ConfluenceFormat }
            : {}),
          ...(opts.fields ? { fields: opts.fields } : {}),
          ...(opts.maxResults !== undefined ? { maxResults: opts.maxResults } : {}),
          ...(opts.mode ? { mode: opts.mode as "crawl" | "llms-txt" | "openapi" } : {}),
          ...(opts.depth !== undefined ? { depth: opts.depth } : {}),
          ...(opts.sameOrigin !== undefined ? { sameOrigin: opts.sameOrigin } : {}),
          ...(opts.include && opts.include.length > 0 ? { include: opts.include } : {}),
          ...(opts.exclude && opts.exclude.length > 0 ? { exclude: opts.exclude } : {}),
          ...(opts.server ? { server: opts.server } : {}),
          ...(opts.tool ? { tool: opts.tool } : {}),
          ...(opts.arg && Object.keys(opts.arg).length > 0 ? { args: opts.arg } : {}),
          ...(opts.preset ? { preset: opts.preset } : {}),
          ...(opts.allowWriteTool ? { allowWriteTool: true } : {}),
          ...(opts.retrieval ? { retrieval: opts.retrieval } : {}),
          ...(opts.retrievalMcpUrl ? { retrievalMcpUrl: opts.retrievalMcpUrl } : {}),
        });
      },
    ),
  );

knowledgeCmd
  .command("migrate-codex")
  .description(
    "Claim ownership of an existing ~/.codex/hooks.json that only contains 'smith knowledge refresh-session' hooks (upgrade path from <0.15)",
  )
  .option("--path <path>", "Path to the codex hooks file (defaults to ~/.codex/hooks.json)")
  .action(
    wrap("knowledge migrate-codex", async (opts: { path?: string }) => {
      const { migrateCodexHooks } = await import("./cli/commands/knowledge/migrate-codex");
      const { homedir } = await import("node:os");
      const { join } = await import("node:path");
      const target = opts.path ?? join(homedir(), ".codex/hooks.json");
      const result = await migrateCodexHooks(target);
      if (result.action === "noop") {
        console.log(`No migration needed: ${result.reason}`);
        return 0;
      }
      if (result.action === "claimed") {
        console.log(
          `✓ Claimed ownership of ${target}. 'smith agent install --target codex' will now manage it.`,
        );
        return 0;
      }
      // conflict — surface via SmithError so wrap()'s renderer formats it
      // consistently with the rest of the CLI and the exit code is mapped
      // by exitCodeFor("validation-failed").
      const reasons = result.unrelated.map((u) =>
        u.matcher !== undefined
          ? `${u.event}[${u.matcher}]: ${u.command}`
          : `${u.event}: ${u.command}`,
      );
      reasons.push(
        "Resolve manually: remove or relocate the unrelated hooks, then re-run 'smith knowledge migrate-codex'.",
      );
      throw new SmithError({
        code: "validation-failed",
        what: `codex hooks.json at ${target} contains unrelated hooks`,
        reasons,
      });
    }),
  );

knowledgeCmd
  .command("validate [agent]")
  .description("Validate knowledge sources for <agent>, or all agents if omitted")
  .action(
    wrap("knowledge validate", async (agent: string | undefined) => {
      const { knowledgeValidate } = await import("./cli/commands/knowledge/validate");
      return knowledgeValidate(agent);
    }),
  );

knowledgeCmd
  .command("compile [name]")
  .description(
    "Compile <name>'s knowledge sources into a TOC stanza + compile-manifest.json. Requires `knowledge.compile.progressive: true` in agent.config.json.",
  )
  .option("--all", "Compile every registered bundle that has compile.progressive=true")
  .action(
    wrap("knowledge compile", async (name: string | undefined, opts: { all?: boolean }) => {
      const { runKnowledgeCompile } = await import("./cli/commands/knowledge/compile");
      return runKnowledgeCompile({
        ...(name ? { name } : {}),
        ...(opts.all ? { all: true } : {}),
      });
    }),
  );

knowledgeCmd
  .command("serve <name>")
  .description(
    "Serve <name>'s knowledge over MCP (knowledge.search + knowledge.fetch). Stdio transport.",
  )
  .option("--stdio", "Serve over stdio (MCP); default and only transport in v1", true)
  .action(
    wrap("knowledge serve", async (name: string, opts: { stdio?: boolean }) => {
      const { runKnowledgeServe } = await import("./cli/commands/knowledge/serve");
      await runKnowledgeServe({ name, stdio: opts.stdio !== false });
      return 0;
    }),
  );

knowledgeCmd
  .command("remove <agent> <source-id>")
  .description("Remove a knowledge source from <agent>'s bundle by source id")
  .action(
    wrap("knowledge remove", async (agent: string, sourceId: string) => {
      const { knowledgeRemove } = await import("./cli/commands/knowledge/remove");
      const { canonicalRegistryPath, loadRegistry } = await import("./io/registry");
      const { findBundleOrFail, loadAllBundles } = await import("./cli/load-all");
      const reg = await loadRegistry(canonicalRegistryPath());
      const all = await loadAllBundles(reg);
      const bundleDir = findBundleOrFail(all, agent).bundlePath;
      return knowledgeRemove({ bundleDir, sourceId });
    }),
  );

knowledgeCmd
  .command("wire <agent>")
  .description(
    "Wire <agent>'s knowledge MCP server (`<agent>-knowledge`) into every detected AI client's global MCP config",
  )
  .option(
    "--platforms <list>",
    "Comma-separated subset of opencode,claude-code,codex,kiro (default: all detected)",
  )
  .action(
    wrap("knowledge wire", async (agent: string, opts: { platforms?: string }) => {
      const { runKnowledgeWire } = await import("./cli/commands/knowledge/wire");
      const result = await runKnowledgeWire({
        agent,
        mode: "wire",
        ...(opts.platforms ? { platforms: opts.platforms } : {}),
      });
      return result.exitCode;
    }),
  );

knowledgeCmd
  .command("unwire <agent>")
  .description(
    "Remove <agent>'s knowledge MCP server entry from every detected AI client's global MCP config",
  )
  .option(
    "--platforms <list>",
    "Comma-separated subset of opencode,claude-code,codex,kiro (default: all detected)",
  )
  .action(
    wrap("knowledge unwire", async (agent: string, opts: { platforms?: string }) => {
      const { runKnowledgeWire } = await import("./cli/commands/knowledge/wire");
      const result = await runKnowledgeWire({
        agent,
        mode: "unwire",
        ...(opts.platforms ? { platforms: opts.platforms } : {}),
      });
      return result.exitCode;
    }),
  );

knowledgeCmd
  .command("route <agent>")
  .description(
    "Run the MCP server/tool picker against existing URL knowledge sources to set via: in bulk",
  )
  .option("--source <id>", "Route only the source with this id (default: all unrouted URL sources)")
  .option("--clear-via", "Remove via from the targeted source (requires --source)")
  .action(
    wrap(
      "knowledge route",
      async (agent: string, opts: { source?: string; clearVia?: boolean }) => {
        const { knowledgeRoute } = await import("./cli/commands/knowledge/route");
        const { canonicalRegistryPath, loadRegistry } = await import("./io/registry");
        const { findBundleOrFail, loadAllBundles } = await import("./cli/load-all");
        const reg = await loadRegistry(canonicalRegistryPath());
        const all = await loadAllBundles(reg);
        const bundleDir = findBundleOrFail(all, agent).bundlePath;
        return knowledgeRoute({
          bundleDir,
          agentName: agent,
          ...(opts.source ? { sourceId: opts.source } : {}),
          ...(opts.clearVia ? { clearVia: true } : {}),
        });
      },
    ),
  );

program
  .command("jack-out")
  .description(`Full offboarding: uninstall everything and remove ${stateHome()}`)
  .option("--dry-run", "Preview without removing anything")
  .option("--yes", "Skip the typed-token confirmation")
  .action(
    wrap("jack-out", async (opts: { dryRun?: boolean; yes?: boolean }) => {
      const { runJackOutCli } = await import("./cli/commands/jack-out");
      return runJackOutCli({
        ...(opts.dryRun ? { dryRun: true } : {}),
        ...(opts.yes ? { yes: true } : {}),
      });
    }),
  );

program
  .command("status")
  .description("Show registry and config locations")
  .action(wrap("status", () => status()));

program.addCommand(createGuiCommand());

program
  .command("doctor")
  .description(
    "Check platform mapping freshness (OpenCode auto-diff, Claude Code/Codex provenance)",
  )
  .option("--offline", "Skip the live OpenCode fetch; report vendored-only")
  .option("--no-cache", "Force a fresh fetch (bypass the 24h cache)")
  .option("--json", "Emit machine-readable JSON instead of human-formatted text")
  .option(
    "--skip-model-resolution",
    "Skip the v0.6.0 model-resolution check (curated fallbacks + installed agents)",
  )
  .addOption(
    new Option(
      "-v, --verbose",
      "Print full per-section detail report (pre-v0.13 default)",
    ).conflicts("quiet"),
  )
  .addOption(
    new Option("-q, --quiet", "Suppress all human output; preserve exit code (for CI)").conflicts(
      "verbose",
    ),
  )
  .option(
    "--fix-knowledge-refresh",
    "Auto-repair knowledge-refresh drift findings (re-register missing hooks, delete corrupt cache entries, clear orphaned consents)",
  )
  .option(
    "--fix-knowledge-compile",
    "Auto-repair knowledge-compile drift findings (re-run `smith knowledge compile <agent>` for each missing-manifest or drift finding)",
  )
  .option(
    "--fix-knowledge-index",
    "Rebuild stale/incompatible knowledge indexes (schema-mismatch or corrupt DBs). Materialized-but-unindexed agents are reported only — run `smith agent install <agent>` to build those",
  )
  .option(
    "--fix-mcp-commands",
    'Auto-repair fragile MCP server `command` fields by rewriting bare names (e.g. "smith") to absolute paths so GUI launches from Spotlight/dock spawn correctly',
  )
  .action(
    wrap(
      "doctor",
      async (opts: {
        offline?: boolean;
        cache?: boolean;
        json?: boolean;
        skipModelResolution?: boolean;
        verbose?: boolean;
        quiet?: boolean;
        fixKnowledgeRefresh?: boolean;
        fixKnowledgeCompile?: boolean;
        fixKnowledgeIndex?: boolean;
        fixMcpCommands?: boolean;
      }) => {
        const { runDoctorCli } = await import("./cli/commands/doctor");
        // commander inverts --no-cache → opts.cache: false, so we negate.
        return runDoctorCli({
          offline: opts.offline ?? false,
          noCache: opts.cache === false,
          json: opts.json ?? false,
          skipModelResolution: opts.skipModelResolution ?? false,
          verbose: opts.verbose ?? false,
          quiet: opts.quiet ?? false,
          fixKnowledgeRefresh: opts.fixKnowledgeRefresh ?? false,
          fixKnowledgeCompile: opts.fixKnowledgeCompile ?? false,
          fixKnowledgeIndex: opts.fixKnowledgeIndex ?? false,
          fixMcpCommands: opts.fixMcpCommands ?? false,
        });
      },
    ),
  );

program
  .command("update")
  .description("Pull the latest agent-smith from origin/main, install deps, and verify the install")
  .option("--dry-run", "Show what `smith update` would do without modifying anything", false)
  .action(
    wrap("update", async (opts: { dryRun?: boolean }) => {
      const { runUpdateCli } = await import("./cli/commands/update");
      return runUpdateCli({ dryRun: opts.dryRun ?? false });
    }),
  );

const configCmd = program.command("config").description("Manage model resolution settings");
configCmd
  .command("get [key]")
  .description("Show config value (or full overview if no key given)")
  .action(
    wrap("config get", async (key: string | undefined) => {
      const { runConfigGetCli } = await import("./cli/commands/config");
      return runConfigGetCli(key);
    }),
  );
configCmd
  .command("set <key> <value>")
  .description("Set a config key")
  .action(
    wrap("config set", async (key: string, value: string) => {
      const { runConfigSetCli } = await import("./cli/commands/config");
      return runConfigSetCli(key, value);
    }),
  );
configCmd
  .command("unset <key>")
  .description("Remove a config key")
  .action(
    wrap("config unset", async (key: string) => {
      const { runConfigUnsetCli } = await import("./cli/commands/config");
      return runConfigUnsetCli(key);
    }),
  );

const dcmd = program.command("daemon").description("Background watcher + git pull");
dcmd
  .command("start")
  .description("Start daemon detached")
  .action(wrap("daemon start", daemonStart));
dcmd.command("stop").description("Stop daemon").action(wrap("daemon stop", daemonStop));
dcmd
  .command("status")
  .description("Show daemon status")
  .action(wrap("daemon status", daemonStatus));
dcmd
  .command("run")
  .description("Run daemon in foreground (used by start)")
  .action(
    wrap("daemon run", async () => {
      // Env-var overrides for the two intervals — useful for operators who
      // want faster pull cadence in dev environments and for manual smoke
      // testing of the per-source state / heartbeat behavior without
      // waiting 15 minutes for a tick. Invalid or non-positive values are
      // ignored so the production defaults always apply when the env vars
      // are missing or malformed.
      const parsePositiveInt = (raw: string | undefined): number | undefined => {
        if (!raw) return undefined;
        const n = Number.parseInt(raw, 10);
        return Number.isFinite(n) && n > 0 ? n : undefined;
      };
      const pullIntervalMs = parsePositiveInt(process.env.SMITH_PULL_INTERVAL_MS);
      const heartbeatIntervalMs = parsePositiveInt(process.env.SMITH_HEARTBEAT_INTERVAL_MS);
      await runDaemon({
        ...(pullIntervalMs !== undefined ? { pullIntervalMs } : {}),
        ...(heartbeatIntervalMs !== undefined ? { heartbeatIntervalMs } : {}),
      });
      // Block forever — the SIGTERM/SIGINT/SIGHUP handlers installed by
      // runDaemon call process.exit on shutdown. Without this await,
      // wrap()'s `deps.exit(0)` would fire when the action returns and
      // kill the daemon despite the setInterval timers keeping the
      // event loop alive. See Appendix B of
      // .docs/2026-05-27-gui-daemon-start-state-root-split.md.
      await new Promise<number>(() => {});
      return 0; // unreachable
    }),
  );

try {
  await program.parseAsync(process.argv);
} catch (err) {
  // commander's usage errors flow here. --help and --version also throw.
  const code = (err as { code?: string }).code;
  if (
    code === "commander.help" ||
    code === "commander.helpDisplayed" ||
    code === "commander.version"
  ) {
    process.exit(0);
  }
  // Surface usage errors via formatCommanderError → same renderer the wrap shim uses.
  const sm = formatCommanderError(err);
  // formatCommanderError always returns SmithError with payload.code === "usage-error"
  // payload.message holds the actionable text.
  console.error(`\u2717 smith: ${(sm.payload as { message: string }).message}`);
  process.exit(2);
}
