# Publishing agent-smith to npm

This runbook walks the full publish flow for a new version of the `@eliharoun/agent-smith` npm package to npmjs.com.

> **Automated publish (preferred).** `.github/workflows/publish.yml` publishes
> automatically when a version tag is pushed. The normal release is now:
> bump the version (package.json + src/index.ts + CHANGELOG) → merge to main →
> `git tag vX.Y.Z && git push origin vX.Y.Z`. CI then runs the full test
> gauntlet, verifies the tag matches package.json, skips if the version is
> already on npm, and publishes via **npm Trusted Publishing (OIDC)** — no
> token, with build provenance. The manual steps below remain as a fallback
> and for understanding what CI does.
>
> **One-time setup on npmjs.com:** Package → Settings → "Trusted Publisher" →
> add this GitHub repo (`eliharoun/agent-smith`) and workflow (`publish.yml`).
> Until that link exists, the CI publish step will fail auth — fall back to a
> manual `npm publish`.

> **Naming note.** The project is `agent-smith` (GitHub repo, brand, CLI command); the npm package is `@eliharoun/agent-smith` because npm rejected the unscoped `agent-smith` name as too similar to an existing `agentsmith` package. The CLI binary stays `smith` regardless. References below use whichever name applies in context.

## Prerequisites (one-time)

1. **npm account with publish rights.** Sign up at https://www.npmjs.com/signup if you don't have one. The package name is `@eliharoun/agent-smith` (unscoped); the publishing user is `eliharoun` (or whoever owns the package).

2. **`npm login` once per machine.** `npm login` opens a browser for OAuth. Verify with `npm whoami`.

3. **2FA on the npm account.** Strongly recommended for unscoped public packages. Set under Account Settings → 2FA. Use auth-token mode (TOTP) — required for `npm publish`.

4. **`bun >= 1.1.0` installed locally.** This is the package's runtime contract; you'll be running tests + smoke checks under bun.

## Pre-publish checklist

For every release, verify in this order:

### 1. Working tree is clean

```bash
git status
git log --oneline -5
```

Working tree should be clean. HEAD should be on `main` and pushed (`git fetch && git diff origin/main`). If not, commit and push first.

### 2. Tests are green

```bash
bun run typecheck
bun test tests/
SMITH_DISABLE_SELF_SOURCE=1 bun test gui/server gui/shared
cd gui/web && bunx vitest run && cd ../..
```

All four must pass. Don't ship if any fails.

### 3. Inspect the tarball

```bash
npm pack --dry-run 2>&1 | tail -20
```

Verify:
- File count is reasonable (~315 for v1.14.1; should be ±10).
- Tarball size < 5MB (we're ~786KB; well under).
- No surprises in the file list (no `*.test.ts`, no `gui/`, no `tests/`, no `docs/`, no `.claude/`).
- `data/`, `guide/`, `bin/`, `agents/`, `skills/`, `examples/`, `src/` all present.

### 4. Hands-on smoke test (do this every time)

This catches package-shape regressions that npm-pack won't:

```bash
# Pack
mkdir -p /tmp/smith-publish-test
cd /tmp/smith-publish-test
rm -f *.tgz
npm pack /Users/eliha/.agent-smith 2>&1 | tail -3

# Install into a fresh dir
mkdir -p /tmp/smith-fake-user
cd /tmp/smith-fake-user
rm -rf node_modules package*.json 2>/dev/null
npm init -y > /dev/null
npm install /tmp/smith-publish-test/agent-smith-*.tgz 2>&1 | tail -5

# Verify the bin entry
ls -la node_modules/.bin/smith

# Verify smith runs
node_modules/.bin/smith --version
# Expected: 1.x.y matching the package.json version

# Verify smith agent install agent-smith works (the load-bearing test)
node_modules/.bin/smith agent install agent-smith 2>&1 | head -20
# Expected: ✓ installed agent-smith ... knowledge: 16 source(s)

# Cleanup
cd /
rm -rf /tmp/smith-publish-test /tmp/smith-fake-user
```

If any of those steps fail, the publish is BLOCKED. Fix and try again.

## Bumping the version

Decide between patch / minor / major per [Semantic Versioning](https://semver.org).
- **Patch** (`1.14.1` → `1.14.2`): bug fixes, doc updates, internal cleanup.
- **Minor** (`1.14.1` → `1.15.0`): new features, no breaking changes.
- **Major** (`1.14.1` → `2.0.0`): breaking changes to the CLI surface, schema, or runtime contract.

Bump in three places:

```bash
# package.json:3
# src/index.ts (program.version("..."))
# CHANGELOG.md (new entry above the previous version)
```

Or use `npm version <patch|minor|major>` which bumps `package.json` and creates a `vX.Y.Z` git tag automatically. Then manually update `src/index.ts` and `CHANGELOG.md`.

## Publishing

### 1. Final dry-run

```bash
npm publish --dry-run 2>&1 | tail -20
```

Expected output ends with `+ @eliharoun/agent-smith@<version>`. Capture any new warnings.

### 2. Publish

```bash
npm publish
```

You'll be prompted for your 2FA token. After ~10s the package appears at https://www.npmjs.com/package/@eliharoun/agent-smith.

For the FIRST publish only (or if the package was previously private):

```bash
npm publish --access public
```

For all subsequent publishes, `npm publish` alone is sufficient.

### 3. Tag and push

```bash
git tag -a v<version> -m "v<version>: <one-line summary>"
git push origin main
git push origin v<version>
```

### 4. Verify

```bash
npm view @eliharoun/agent-smith version
# Expected: <version> you just published

npm install -g @eliharoun/agent-smith
smith --version
# Expected: <version>
```

If `npm install -g` fails for any reason, you can unpublish within 72 hours via `npm unpublish @eliharoun/agent-smith@<version>` (after that, only npm support can do it).

## What gets shipped

Per `package.json:files`:

- `src/` — all TypeScript sources for the CLI
- `data/` — translator tool maps + schemas (loaded at module init)
- `guide/` — the 16 markdown files the bundled `agent-smith` agent uses as its knowledge corpus
- `bin/` — `bin/install` (from-source bootstrap) and `bin/smith.js` (npm CLI entry)
- `agents/` — the bundled `agent-smith` self-tutoring agent and example agents
- `skills/` — `the-architect` and `the-keymaker` skill bundles
- `examples/` — example agent bundles
- `scripts/bootstrap.ts` + `scripts/postinstall-preflight.cjs` — the postinstall flow
- `LICENSE`, `README.md`, `GUIDE.md`, `CHANGELOG.md`

Excluded by `.npmignore`:
- `gui/` (the GUI server + web SPA — only available from source install)
- `tests/`, `*.test.ts` (test files)
- `docs/` (planning docs)
- `.claude/`, `.yolo-sisyphus/` (worktrees and coordination state)

## What postinstall does

Runs `scripts/postinstall-preflight.cjs` (node-compatible) which:

1. Checks for opt-out env vars (`AGENT_SMITH_SKIP_POSTINSTALL=1`, `CI=true`).
2. Detects transitive-dep installs (`INIT_CWD` ≠ package dir without `--global`) and silently exits 0. This means `agent-smith` is safe as a transitive dep — postinstall only fires for the user's own explicit install.
3. Detects bun on PATH. If absent, prints a hint pointing at https://bun.sh and exits 0. The package installs successfully without bun, but smith won't run until bun is installed.
4. Delegates to `bun run scripts/bootstrap.ts --mode=postinstall` which:
   - Copies bundled `the-architect` + `the-keymaker` skills to `~/.config/opencode/skills/`, `~/.claude/skills/`, `~/.agents/skills/` (if those dirs exist).
   - Restarts a running `smith daemon` (with a 60s recency guard) so it picks up the new code. Set `SMITH_NO_DAEMON_AUTO_RESTART=1` to opt out.

## Troubleshooting

### `npm publish` says "you must be logged in"

`npm login` again. Token may have expired.

### `npm publish` says "403 Forbidden"

You don't have publish rights on the package. Verify with `npm owner ls @eliharoun/agent-smith`. Add yourself with `npm owner add <username> @eliharoun/agent-smith` (requires being an existing owner).

### Tarball ships empty `agents/` or `skills/`

Check `.npmignore` and `.gitignore` — they may be excluding subdirectories. Use `npm pack --dry-run` to inspect.

### `smith --version` after `npm install -g` produces "Cannot find module"

Some required runtime asset (likely `data/*.json` or `guide/*`) is missing from `files` or being filtered by `.npmignore`. Re-pack and re-test before publishing.

### npm install hangs or fails on bun preflight

The `postinstall-preflight.cjs` should exit 0 even on failure. If it's hanging, kill the install and check whether bun is on PATH; if absent, the preflight should print a hint and exit. If it's still hanging, the bug is in the preflight script.

## Unpublishing

You have 72 hours after publishing to unpublish a version. After that, only npm support can remove it (and they generally won't unless there's a security concern).

```bash
npm unpublish @eliharoun/agent-smith@<version>
```

Note: unpublishing breaks downstream installs that pinned that version. Prefer to publish a fix as `<version>+1` instead.

## See also

- [`docs/release-notes/`](./release-notes/) — release notes per version (if you keep them separately from CHANGELOG.md)
- [`CHANGELOG.md`](../CHANGELOG.md) — canonical change log
- [npm publishing docs](https://docs.npmjs.com/cli/v10/commands/npm-publish)
