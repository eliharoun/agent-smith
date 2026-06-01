#!/usr/bin/env bash
# Shared bash helpers for tests/bin/install.test.sh.
# Hermetic-test rule: every helper that creates files puts them under a
# tmpdir owned by the test; nothing touches the user's real $HOME or
# real ~/.agent-smith/.
#
# Note: deliberately NOT using `set -e` here. Test functions need to
# examine non-zero exit codes from commands under test, and the assert_*
# helpers signal failure via `return 1` so run_test's PASS/FAIL accounting
# works. Adding -e would abort the driver on the first failed assertion
# and skip the summary.

set -uo pipefail

# Tracks tmpdirs created by helpers so cleanup_tmp_dirs can rm them all.
TMP_DIRS=()

make_tmp_home() {
  local d
  d="$(mktemp -d -t smith-test-home.XXXXXX)"
  TMP_DIRS+=("$d")
  echo "$d"
}

# Creates a tmpdir containing a minimal agent-smith-shaped clone:
# package.json with the right name, src/index.ts with the shebang,
# bin/install (copied from the worktree under test). Skips node_modules,
# tests, docs for speed.
#
# Initializes the tmpdir as a real git repo with a single commit so that
# step 4 of bin/install (`git diff-index --quiet HEAD --` for dirty-tree
# detection in update mode) has a HEAD to compare against. Git config is
# set locally (not --global) so the test never touches the user's git
# config. Tests that want a "dirty tree" can simply modify a file after
# calling make_tmp_repo; tests that want clean tree do nothing extra.
make_tmp_repo() {
  local repo_root
  repo_root="$(mktemp -d -t smith-test-repo.XXXXXX)"
  TMP_DIRS+=("$repo_root")
  cp "${SOURCE_REPO}/package.json" "$repo_root/"
  mkdir -p "$repo_root/src" "$repo_root/bin" "$repo_root/scripts"
  cp "${SOURCE_REPO}/src/index.ts" "$repo_root/src/"
  cp "${SOURCE_REPO}/bin/install" "$repo_root/bin/"
  chmod +x "$repo_root/bin/install"
  # Stub bootstrap so `bun install`'s postinstall doesn't try to do real work.
  cat > "$repo_root/scripts/bootstrap.ts" <<'TS'
// Test stub — does nothing so postinstall is a no-op in the test harness.
TS
  # Initialize as a git repo with one clean commit. Local config only —
  # never --global, so the user's ~/.gitconfig is untouched. Additionally,
  # GIT_CONFIG_GLOBAL=/dev/null and GIT_CONFIG_NOSYSTEM=1 isolate this
  # subshell from the user's global hooks, commit templates, signing
  # config, and aliases so test fixtures are fully hermetic.
  ( cd "$repo_root" || exit 1
    export GIT_CONFIG_GLOBAL=/dev/null
    export GIT_CONFIG_NOSYSTEM=1
    git init -q
    git config user.email test@smith-test.local
    git config user.name "smith-test"
    git config commit.gpgsign false
    git add -A
    git commit -q -m "initial test fixture"
  ) >/dev/null
  echo "$repo_root"
}

# Asserts string equality. `return 1` (not `exit 1`) so run_test's
# PASS/FAIL accounting can tally the failure and continue with the next
# test rather than aborting the whole driver.
assert_eq() {
  local label="$1" expected="$2" actual="$3"
  if [[ "$expected" != "$actual" ]]; then
    echo "FAIL: $label" >&2
    echo "  expected: $expected" >&2
    echo "  actual:   $actual" >&2
    return 1
  fi
}

assert_contains() {
  local label="$1" haystack="$2" needle="$3"
  if [[ "$haystack" != *"$needle"* ]]; then
    echo "FAIL: $label" >&2
    echo "  haystack: $haystack" >&2
    echo "  expected to contain: $needle" >&2
    return 1
  fi
}

assert_file_exists() {
  local label="$1" path="$2"
  if [[ ! -e "$path" ]]; then
    echo "FAIL: $label" >&2
    echo "  expected file at: $path" >&2
    return 1
  fi
}

assert_symlink_target() {
  local label="$1" link="$2" expected_target="$3"
  if [[ ! -L "$link" ]]; then
    echo "FAIL: $label" >&2
    echo "  $link is not a symlink" >&2
    return 1
  fi
  local actual
  actual="$(readlink "$link")"
  if [[ "$actual" != "$expected_target" ]]; then
    echo "FAIL: $label" >&2
    echo "  link: $link" >&2
    echo "  expected target: $expected_target" >&2
    echo "  actual target:   $actual" >&2
    return 1
  fi
}

# Assert that $launcher is a regular executable bash wrapper that exec's
# bun at $bun_path with the entry script at $entry_path. This is the
# replacement for assert_symlink_target after the launcher migration:
# the symlink-shebang model fails under stripped-PATH spawn contexts
# (Spotlight, MCP clients, cron) because env can't find bun, so the
# installer now writes a wrapper that hardcodes both paths.
#
# Asserts:
#   1. $launcher exists and is a regular file (not a symlink).
#   2. $launcher is executable.
#   3. $launcher's body contains `exec "$bun_path" "$entry_path" "$@"`
#      (literal — paths embedded directly in the script).
# Canonicalize a path the same way bin/install does (resolve_path),
# so test fixtures written under /var/... compare equal to the
# /private/var/... form the installer embeds in the wrapper. Falls
# back to the input path if neither readlink -f nor python3 is
# available.
canonicalize_path() {
  local p="$1" resolved
  if resolved="$(readlink -f -- "$p" 2>/dev/null)" && [[ -n "$resolved" ]]; then
    echo "$resolved"; return 0
  fi
  if command -v python3 >/dev/null 2>&1; then
    if resolved="$(python3 -c 'import os,sys; print(os.path.realpath(sys.argv[1]))' "$p" 2>/dev/null)" \
       && [[ -n "$resolved" ]]; then
      echo "$resolved"; return 0
    fi
  fi
  echo "$p"
}

assert_launcher_wrapper() {
  local label="$1" launcher="$2" bun_path="$3" entry_path="$4"
  if [[ -L "$launcher" ]]; then
    echo "FAIL: $label" >&2
    echo "  $launcher is a symlink; expected regular file (wrapper)" >&2
    return 1
  fi
  if [[ ! -f "$launcher" ]]; then
    echo "FAIL: $label" >&2
    echo "  $launcher does not exist or is not a regular file" >&2
    return 1
  fi
  if [[ ! -x "$launcher" ]]; then
    echo "FAIL: $label" >&2
    echo "  $launcher is not executable" >&2
    return 1
  fi
  # Canonicalize both paths — the installer embeds canonical forms so
  # update-mode detection works on macOS (/var → /private/var).
  local canon_bun canon_entry
  canon_bun="$(canonicalize_path "$bun_path")"
  canon_entry="$(canonicalize_path "$entry_path")"
  local expected_line="exec \"$canon_bun\" \"$canon_entry\" \"\$@\""
  if ! grep -qF "$expected_line" "$launcher"; then
    echo "FAIL: $label" >&2
    echo "  $launcher does not contain the expected exec line" >&2
    echo "  expected: $expected_line" >&2
    echo "  actual body:" >&2
    sed 's/^/    /' "$launcher" >&2
    return 1
  fi
}

# Creates a fake `bun` shim on a tmpdir directory and echoes the dir.
# Use to satisfy step 3's `command -v bun` check in tests where step 3
# isn't the focus. The shim does nothing useful when invoked but is
# executable and on PATH, so command -v succeeds.
#
#   bun_dir="$(make_fake_bun_dir)"
#   env -i HOME="$home" PATH="$bun_dir:/usr/bin:/bin" bash "$repo/bin/install"
make_fake_bun_dir() {
  local d
  d="$(mktemp -d -t smith-test-bun.XXXXXX)"
  TMP_DIRS+=("$d")
  cat > "$d/bun" <<'EOF'
#!/usr/bin/env bash
# Fake bun shim for hermetic tests. Does nothing; exists only so
# `command -v bun` succeeds and step 3's bun-bootstrap branch is skipped.
# Also returns 0 when invoked as `bun install` so step 5 can succeed in
# tests that go through to step 5 without setting SMITH_INSTALLER_BUN_INSTALL_DEPS_CMD.
exit 0
EOF
  chmod +x "$d/bun"
  echo "$d"
}

cleanup_tmp_dirs() {
  local d
  for d in "${TMP_DIRS[@]:-}"; do
    [[ -d "$d" ]] && rm -rf "$d"
  done
  TMP_DIRS=()
}

trap cleanup_tmp_dirs EXIT
