#!/usr/bin/env bash
# Hermetic test driver for bin/install.
# Usage: bash tests/bin/install.test.sh
# Each test_* function is invoked sequentially. First failure exits 1.
# All file operations target tmpdirs; nothing touches the real $HOME.

set -uo pipefail

# SOURCE_REPO = the repo this test driver lives in (the one under test).
SOURCE_REPO="$(cd "$(dirname "$0")/../.." && pwd)"
export SOURCE_REPO

# shellcheck source=tests/bin/_helpers.sh
source "$(dirname "$0")/_helpers.sh"

PASS=0
FAIL=0

run_test() {
  local name="$1"
  echo ""
  echo "=== $name ==="
  if "$name"; then
    echo "PASS: $name"
    PASS=$((PASS + 1))
  else
    echo "FAIL: $name" >&2
    FAIL=$((FAIL + 1))
  fi
}

# --- Tests ---

test_sanity_refuses_outside_a_clone() {
  local tmp out code
  tmp="$(mktemp -d -t smith-test-bare.XXXXXX)"
  TMP_DIRS+=("$tmp")
  # Copy ONLY bin/install into a directory with no package.json. The script
  # should refuse because the parent dir doesn't look like an agent-smith clone.
  mkdir -p "$tmp/bin"
  cp "$SOURCE_REPO/bin/install" "$tmp/bin/"
  chmod +x "$tmp/bin/install"
  # Capture exit code without aborting. Driver runs under -uo pipefail
  # (no -e), so a non-zero exit from the command-substitution does NOT
  # abort the test function — it just sets $? for the next command.
  out="$(bash "$tmp/bin/install" 2>&1)"
  code=$?
  assert_eq "exit code" "1" "$code" || return 1
  assert_contains "error message names the missing thing" "$out" "must be run from inside an agent-smith clone" || return 1
}

test_mode_fresh_install_when_no_smith_on_path() {
  local home repo bun_dir out code
  home="$(make_tmp_home)"
  repo="$(make_tmp_repo)"
  # Provide a fake bun on PATH so step 3 (bun-availability check) is skipped.
  # This test is about mode detection (step 2), not bun bootstrapping.
  bun_dir="$(make_fake_bun_dir)"
  out="$(env -i HOME="$home" PATH="$bun_dir:/usr/bin:/bin" bash "$repo/bin/install" 2>&1)"
  code=$?
  # In Task 2, the script exits 0 after mode detection (steps 4-8 not yet
  # implemented). It should print "Fresh install" or similar.
  assert_eq "exit code" "0" "$code" || return 1
  assert_contains "fresh-install banner" "$out" "Fresh install" || return 1
}

test_mode_update_when_smith_points_into_repo_root() {
  local home repo bin_dir bun_dir out code
  home="$(make_tmp_home)"
  repo="$(make_tmp_repo)"
  bin_dir="$home/.local/bin"
  mkdir -p "$bin_dir"
  ln -s "$repo/src/index.ts" "$bin_dir/smith"
  # Provide a fake bun on PATH so step 3 is skipped (this test is about step 2).
  bun_dir="$(make_fake_bun_dir)"
  # Skip step 4's git pull (no `origin` remote in tmp repo) and step 5's
  # bun install (no real bun and no need to hit the registry). `:` is
  # bash's no-op builtin; both seams accept any shell command.
  out="$(env -i HOME="$home" PATH="$bin_dir:$bun_dir:/usr/bin:/bin" \
    SMITH_INSTALLER_GIT_PULL_CMD=":" \
    SMITH_INSTALLER_BUN_INSTALL_DEPS_CMD=":" \
    bash "$repo/bin/install" 2>&1)"
  code=$?
  assert_eq "exit code" "0" "$code" || return 1
  assert_contains "update-mode banner" "$out" "already installed; updating" || return 1
}

test_mode_conflict_when_smith_points_elsewhere() {
  local home repo elsewhere out code
  home="$(make_tmp_home)"
  repo="$(make_tmp_repo)"
  elsewhere="$(mktemp -d -t smith-test-elsewhere.XXXXXX)"
  TMP_DIRS+=("$elsewhere")
  # Pretend the user has an old `bun link`-style install: a smith binary on
  # PATH whose target is NOT under $repo.
  cat > "$elsewhere/smith" <<'EOF'
#!/usr/bin/env bash
echo "fake old smith"
EOF
  chmod +x "$elsewhere/smith"
  out="$(env -i HOME="$home" PATH="$elsewhere:/usr/bin:/bin" bash "$repo/bin/install" 2>&1)"
  code=$?
  assert_eq "exit code" "1" "$code" || return 1
  assert_contains "conflict error names the offending path" "$out" "$elsewhere/smith" || return 1
  assert_contains "conflict error mentions migration" "$out" "remove the existing install" || return 1
}

test_bun_missing_consent_yes_runs_installer_command() {
  local home repo marker out code stub_bun
  home="$(make_tmp_home)"
  repo="$(make_tmp_repo)"
  marker="$home/bun-installer-was-run"
  # The test seam command "installs" a bun shim that:
  #   1. creates the marker (so the test can verify the installer was invoked),
  #   2. is a real bash script that succeeds when later invoked as `bun install`
  #      by step 5 of bin/install — without actually running the real bun.
  # The shim ignores arguments and exits 0, which is enough to satisfy step
  # 5's `bun install` call hermetically (no network, no real bun side effects).
  stub_bun="$home/.bun/bin/bun"
  out="$(env -i HOME="$home" PATH="/usr/bin:/bin" \
    SMITH_INSTALLER_BUN_INSTALL_CMD="mkdir -p $home/.bun/bin && printf '%s\n' '#!/usr/bin/env bash' '# stub bun for test_bun_missing_consent_yes_runs_installer_command' 'exit 0' > $stub_bun && chmod +x $stub_bun && touch $marker" \
    bash -c "echo Y | bash $repo/bin/install" 2>&1)"
  code=$?
  assert_eq "exit code" "0" "$code" || return 1
  assert_file_exists "marker (installer was invoked)" "$marker" || return 1
  assert_contains "consent prompt was shown" "$out" "Install Bun now?" || return 1
}

test_bun_missing_consent_no_exits_with_manual_install_message() {
  local home repo out code
  home="$(make_tmp_home)"
  repo="$(make_tmp_repo)"
  out="$(env -i HOME="$home" PATH="/usr/bin:/bin" \
    bash -c "echo n | bash $repo/bin/install" 2>&1)"
  code=$?
  assert_eq "exit code" "1" "$code" || return 1
  assert_contains "consent prompt was shown" "$out" "Install Bun now?" || return 1
  assert_contains "manual install hint" "$out" "Install Bun manually from https://bun.sh" || return 1
}

test_bun_missing_no_tty_exits_with_clear_error() {
  # Regression: when bun is not installed AND stdin is not a TTY (e.g. CI,
  # `cat /dev/null | bash bin/install`, certain SSH wrappers), the consent
  # prompt cannot be answered. The installer must refuse with a clear,
  # actionable message INSTEAD of silently aborting via `read` returning
  # nonzero under `set -e`.
  local home repo out code
  home="$(make_tmp_home)"
  repo="$(make_tmp_repo)"
  out="$(env -i HOME="$home" PATH="/usr/bin:/bin" \
    bash -c "bash $repo/bin/install </dev/null" 2>&1)"
  code=$?
  assert_eq "exit code" "1" "$code" || return 1
  assert_contains "names the non-interactive problem" "$out" "interactive terminal" || return 1
  assert_contains "points at the seam as an escape hatch" "$out" "SMITH_INSTALLER_BUN_INSTALL_CMD" || return 1
}

test_update_mode_refuses_dirty_git_tree() {
  local home repo bin_dir bun_dir out code
  home="$(make_tmp_home)"
  repo="$(make_tmp_repo)"   # already a clean git repo with one commit
  bin_dir="$home/.local/bin"
  mkdir -p "$bin_dir"
  ln -s "$repo/src/index.ts" "$bin_dir/smith"
  # Dirty the working tree (no need to git init — make_tmp_repo did that).
  echo "dirty change" >> "$repo/package.json"
  # Use a fake bun shim: this test focuses on step 4 (dirty-tree refusal),
  # which fires BEFORE step 5's `bun install`, so we don't need a real bun.
  # We do need bun on PATH so step 3 (availability) doesn't prompt.
  bun_dir="$(make_fake_bun_dir)"
  out="$(env -i HOME="$home" PATH="$bin_dir:$bun_dir:/usr/bin:/bin" \
    bash "$repo/bin/install" 2>&1)"
  code=$?
  assert_eq "exit code" "1" "$code" || return 1
  assert_contains "dirty-tree error" "$out" "uncommitted changes" || return 1
}

test_fresh_install_runs_bun_install() {
  local home repo bun_dir marker out code
  home="$(make_tmp_home)"
  repo="$(make_tmp_repo)"
  marker="$home/bun-install-was-invoked"
  # Use a fake bun shim (step 3 sees `command -v bun`, doesn't actually
  # invoke it). Use the SMITH_INSTALLER_BUN_INSTALL_DEPS_CMD seam to verify
  # step 5 invoked `bun install` without actually running it (real `bun
  # install` requires network + working cert chain + a real registry).
  bun_dir="$(make_fake_bun_dir)"
  out="$(env -i HOME="$home" PATH="$bun_dir:/usr/bin:/bin" \
    SMITH_INSTALLER_BUN_INSTALL_DEPS_CMD="touch $marker" \
    bash "$repo/bin/install" 2>&1)"
  code=$?
  assert_eq "exit code" "0" "$code" || return 1
  assert_file_exists "marker (bun install was invoked in step 5)" "$marker" || return 1
}

test_fresh_install_runs_gui_build() {
  local home repo bun_dir marker out code
  home="$(make_tmp_home)"
  repo="$(make_tmp_repo)"
  marker="$home/gui-build-was-invoked"
  bun_dir="$(make_fake_bun_dir)"
  # Verify Step 5b invokes the GUI build by replacing the real command
  # with a marker-touching stub via the seam.
  out="$(env -i HOME="$home" PATH="$bun_dir:/usr/bin:/bin" \
    SMITH_INSTALLER_BUN_INSTALL_DEPS_CMD=: \
    SMITH_INSTALLER_GUI_BUILD_CMD="touch $marker" \
    bash "$repo/bin/install" 2>&1)"
  code=$?
  assert_eq "exit code" "0" "$code" || return 1
  assert_file_exists "marker (gui build was invoked in step 5b)" "$marker" || return 1
  assert_contains "build banner" "$out" "Building GUI bundle" || return 1
}

test_gui_build_failure_warns_and_continues() {
  local home repo bun_dir out code
  home="$(make_tmp_home)"
  repo="$(make_tmp_repo)"
  bun_dir="$(make_fake_bun_dir)"
  # Simulate a GUI build that fails. Install must still succeed (warn-and-continue).
  # The seam is invoked via `eval` in the parent shell; wrap in a subshell
  # so `exit 1` only aborts the simulated build, not bin/install itself.
  out="$(env -i HOME="$home" PATH="$bun_dir:/usr/bin:/bin" \
    SMITH_INSTALLER_BUN_INSTALL_DEPS_CMD=: \
    SMITH_INSTALLER_GUI_BUILD_CMD="(exit 1)" \
    bash "$repo/bin/install" 2>&1)"
  code=$?
  assert_eq "exit code (warn-and-continue)" "0" "$code" || return 1
  assert_contains "warn message" "$out" "GUI build failed" || return 1
  assert_contains "retry pointer" "$out" "bun run gui:build" || return 1
  # Symlink must still be created — the CLI works without GUI.
  assert_symlink_target "smith symlink despite gui build failure" \
    "$home/.local/bin/smith" "$repo/src/index.ts" || return 1
}

test_fresh_install_creates_symlink() {
  local home repo bun_dir out code
  home="$(make_tmp_home)"
  repo="$(make_tmp_repo)"
  # Use a fake bun dir (real ~/.bun/bin may contain a stale `smith` from
  # prior installs, which would trigger conflict-mode in step 2).
  bun_dir="$(make_fake_bun_dir)"
  out="$(env -i HOME="$home" SHELL="/bin/zsh" PATH="$bun_dir:/usr/bin:/bin" \
    SMITH_INSTALLER_BUN_INSTALL_DEPS_CMD=: \
    bash "$repo/bin/install" 2>&1)"
  code=$?
  assert_eq "exit code" "0" "$code" || return 1
  assert_symlink_target "smith symlink" "$home/.local/bin/smith" "$repo/src/index.ts" || return 1
}

test_fresh_install_appends_marker_block_to_zshrc() {
  local home repo bun_dir out code rc
  home="$(make_tmp_home)"
  repo="$(make_tmp_repo)"
  bun_dir="$(make_fake_bun_dir)"
  rc="$home/.zshrc"
  out="$(env -i HOME="$home" SHELL="/bin/zsh" PATH="$bun_dir:/usr/bin:/bin" \
    SMITH_INSTALLER_BUN_INSTALL_DEPS_CMD=: \
    bash "$repo/bin/install" 2>&1)"
  code=$?
  assert_eq "exit code" "0" "$code" || return 1
  assert_file_exists "rc file" "$rc" || return 1
  assert_contains "marker open" "$(cat "$rc")" "# >>> agent-smith installer >>>" || return 1
  assert_contains "marker close" "$(cat "$rc")" "# <<< agent-smith installer <<<" || return 1
  assert_contains "PATH export" "$(cat "$rc")" 'export PATH="$HOME/.local/bin:$PATH"' || return 1
}

test_idempotency_marker_block_appended_at_most_once() {
  local home repo bun_dir rc count second_out
  home="$(make_tmp_home)"
  repo="$(make_tmp_repo)"
  bun_dir="$(make_fake_bun_dir)"
  rc="$home/.zshrc"
  # First run: fresh install (no smith on PATH).
  env -i HOME="$home" SHELL="/bin/zsh" PATH="$bun_dir:/usr/bin:/bin" \
    SMITH_INSTALLER_BUN_INSTALL_DEPS_CMD=: \
    bash "$repo/bin/install" >/dev/null 2>&1
  # Second run: smith symlink now points into $repo, so this is update mode.
  # Both git pull and bun install must be stubbed (tmp repo has no origin remote
  # and bun install's cert chain breaks under env -i). Capture output to also
  # assert the summary's already-configured branch fires.
  second_out="$(env -i HOME="$home" SHELL="/bin/zsh" PATH="$home/.local/bin:$bun_dir:/usr/bin:/bin" \
    SMITH_INSTALLER_GIT_PULL_CMD=: \
    SMITH_INSTALLER_BUN_INSTALL_DEPS_CMD=: \
    bash "$repo/bin/install" 2>&1 || true)"
  count="$(grep -c '# >>> agent-smith installer >>>' "$rc" || true)"
  assert_eq "marker block count" "1" "$count" || return 1
  assert_contains "summary already-configured branch" "$second_out" "already configured" || return 1
}

test_no_modify_path_skips_rc_edit() {
  local home repo bun_dir out code rc
  home="$(make_tmp_home)"
  repo="$(make_tmp_repo)"
  bun_dir="$(make_fake_bun_dir)"
  rc="$home/.zshrc"
  out="$(env -i HOME="$home" SHELL="/bin/zsh" PATH="$bun_dir:/usr/bin:/bin" \
    SMITH_INSTALLER_BUN_INSTALL_DEPS_CMD=: \
    bash "$repo/bin/install" --no-modify-path 2>&1)"
  code=$?
  assert_eq "exit code" "0" "$code" || return 1
  if [[ -f "$rc" ]]; then
    if grep -q "agent-smith installer" "$rc"; then
      echo "FAIL: --no-modify-path should not have edited $rc" >&2
      cat "$rc" >&2
      return 1
    fi
  fi
  assert_symlink_target "smith symlink" "$home/.local/bin/smith" "$repo/src/index.ts" || return 1
  assert_contains "summary mentions opt-out" "$out" "PATH:" || return 1
  assert_contains "summary tells user what to add" "$out" '$HOME/.local/bin' || return 1
}

test_unwritable_rc_skips_rc_edit_without_aborting() {
  # If the user's rc file exists but is read-only, the installer must skip
  # the PATH edit gracefully (symlink still created, exit 0) rather than
  # crash mid-install on `cat >>` and leave a half-configured state.
  local home repo bun_dir code rc out
  home="$(make_tmp_home)"
  repo="$(make_tmp_repo)"
  bun_dir="$(make_fake_bun_dir)"
  rc="$home/.zshrc"
  : > "$rc"
  chmod 0444 "$rc"
  out="$(env -i HOME="$home" SHELL="/bin/zsh" PATH="$bun_dir:/usr/bin:/bin" \
    SMITH_INSTALLER_BUN_INSTALL_DEPS_CMD=: \
    bash "$repo/bin/install" 2>&1)"
  code=$?
  # Restore perms so cleanup_tmp_dirs can rm -rf the tmpdir.
  chmod 0644 "$rc"
  assert_eq "exit code" "0" "$code" || return 1
  assert_symlink_target "smith symlink" "$home/.local/bin/smith" "$repo/src/index.ts" || return 1
  if grep -q "agent-smith installer" "$rc"; then
    echo "FAIL: read-only rc should not have been edited" >&2
    cat "$rc" >&2
    return 1
  fi
  assert_contains "summary names unwritable status" "$out" "rc file not writable" || return 1
}

test_end_to_end_fresh_install_summary() {
  local home repo bun_dir out code
  home="$(make_tmp_home)"
  repo="$(make_tmp_repo)"
  bun_dir="$(make_fake_bun_dir)"
  out="$(env -i HOME="$home" SHELL="/bin/zsh" PATH="$bun_dir:/usr/bin:/bin" \
    SMITH_INSTALLER_BUN_INSTALL_DEPS_CMD=: \
    bash "$repo/bin/install" 2>&1)"
  code=$?
  assert_eq "exit code" "0" "$code" || return 1
  assert_contains "summary banner" "$out" "agent-smith installed." || return 1
  assert_contains "source path"     "$out" "Source:" || return 1
  assert_contains "binary path"     "$out" "Binary:" || return 1
  assert_contains "PATH status"     "$out" "PATH:" || return 1
  assert_contains "next steps"      "$out" "smith doctor" || return 1
}

test_chmod_plus_x_preserved_on_update_mode() {
  # Update mode should restore +x on src/index.ts even if a prior `git pull`
  # dropped the executable bit. Strip +x and commit the mode change first
  # (so the working tree is clean for step 4's dirty-tree check), then
  # invoke install in update mode and assert the bit was restored.
  local home repo bin_dir bun_dir code
  home="$(make_tmp_home)"
  repo="$(make_tmp_repo)"
  bin_dir="$home/.local/bin"
  mkdir -p "$bin_dir"
  ln -s "$repo/src/index.ts" "$bin_dir/smith"
  bun_dir="$(make_fake_bun_dir)"
  ( cd "$repo" || return 1
    chmod -x src/index.ts
    GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 \
      git update-index --chmod=-x src/index.ts >/dev/null
    GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 \
      git -c user.email=t@t -c user.name=t -c commit.gpgsign=false \
        commit -qm "drop +x" >/dev/null
  ) || return 1
  if [[ -x "$repo/src/index.ts" ]]; then
    echo "FAIL: precondition: chmod -x via git did not strip executable bit" >&2
    return 1
  fi
  env -i HOME="$home" PATH="$bin_dir:$bun_dir:/usr/bin:/bin" \
    SMITH_INSTALLER_GIT_PULL_CMD=: \
    SMITH_INSTALLER_BUN_INSTALL_DEPS_CMD=: \
    bash "$repo/bin/install" >/dev/null 2>&1
  code=$?
  assert_eq "exit code" "0" "$code" || return 1
  if [[ ! -x "$repo/src/index.ts" ]]; then
    echo "FAIL: chmod +x was not restored on src/index.ts" >&2
    ls -l "$repo/src/index.ts" >&2
    return 1
  fi
}

test_update_mode_invokes_git_pull() {
  # Positive assertion: update mode actually runs the git_pull_cmd seam
  # (analogous to test_fresh_install_runs_bun_install). Sets the seam to
  # a marker-touching command and asserts the marker exists post-install.
  local home repo bin_dir bun_dir marker code
  home="$(make_tmp_home)"
  repo="$(make_tmp_repo)"
  bin_dir="$home/.local/bin"
  mkdir -p "$bin_dir"
  ln -s "$repo/src/index.ts" "$bin_dir/smith"
  bun_dir="$(make_fake_bun_dir)"
  marker="$home/git-pull-was-invoked"
  env -i HOME="$home" PATH="$bin_dir:$bun_dir:/usr/bin:/bin" \
    SMITH_INSTALLER_GIT_PULL_CMD="touch \"$marker\"" \
    SMITH_INSTALLER_BUN_INSTALL_DEPS_CMD=: \
    bash "$repo/bin/install" >/dev/null 2>&1
  code=$?
  assert_eq "exit code" "0" "$code" || return 1
  assert_file_exists "git pull marker" "$marker" || return 1
}

test_bash_shell_routes_to_appropriate_rc() {
  # SHELL=/bin/bash should route to ~/.bash_profile on macOS (Darwin) or
  # ~/.bashrc on Linux. We can't fake `uname` (it's a system binary); we
  # detect the host platform and assert the expected target.
  local home repo bun_dir code expected_rc other_rc
  home="$(make_tmp_home)"
  repo="$(make_tmp_repo)"
  bun_dir="$(make_fake_bun_dir)"
  if [[ "$(uname)" == "Darwin" ]]; then
    expected_rc="$home/.bash_profile"
    other_rc="$home/.bashrc"
  else
    expected_rc="$home/.bashrc"
    other_rc="$home/.bash_profile"
  fi
  env -i HOME="$home" SHELL="/bin/bash" PATH="$bun_dir:/usr/bin:/bin" \
    SMITH_INSTALLER_BUN_INSTALL_DEPS_CMD=: \
    bash "$repo/bin/install" >/dev/null 2>&1
  code=$?
  assert_eq "exit code" "0" "$code" || return 1
  assert_file_exists "expected rc was edited" "$expected_rc" || return 1
  assert_contains "marker in expected rc" "$(cat "$expected_rc")" "# >>> agent-smith installer >>>" || return 1
  if [[ -f "$other_rc" ]]; then
    if grep -q "agent-smith installer" "$other_rc"; then
      echo "FAIL: $other_rc was edited but should not have been on this platform" >&2
      return 1
    fi
  fi
}

test_fresh_install_invokes_smith_agent_install_step() {
  # After binary symlink + PATH wiring, bin/install must materialize the
  # agent-smith bundle by invoking `smith agent install agent-smith`. This test
  # asserts the step is reached and that bin/install exits 0 regardless
  # of whether the inner install succeeds.
  #
  # Why we don't assert the materialized knowledge file exists: the
  # harness fixture (make_tmp_repo) deliberately ships only a minimal
  # repo skeleton — no agents/ or guide/ — to keep tests fast and
  # hermetic. The fake bun shim exits 0 for any invocation, so the
  # smith subprocess returns success without doing real work; either
  # way (success or failure), bin/install must continue. We assert the
  # banner text printed BEFORE the invocation, which proves the step
  # ran. Exit-0 proves the warn-and-continue path doesn't abort.
  local home repo bun_dir out code
  home="$(make_tmp_home)"
  repo="$(make_tmp_repo)"
  bun_dir="$(make_fake_bun_dir)"
  out="$(env -i HOME="$home" SHELL="/bin/zsh" PATH="$bun_dir:/usr/bin:/bin" \
    SMITH_INSTALLER_BUN_INSTALL_DEPS_CMD=: \
    bash "$repo/bin/install" 2>&1)"
  code=$?
  assert_eq "exit code" "0" "$code" || return 1
  assert_contains "install-step banner" "$out" "Installing agent-smith bundle" || return 1
}

test_fresh_install_invokes_smith_init_step() {
  # New for rc.3: bin/install must invoke `smith init` between the
  # summary and the agent-smith bundle install. This step defines the
  # no-manual-init contract — fresh installer users never need to run
  # `smith init` themselves. We use the SMITH_INSTALLER_INIT_CMD env
  # var seam to substitute a marker-touching command in place of the
  # real binary, then assert the marker file was created and the
  # banner appeared in the output.
  local home repo bun_dir out code marker
  home="$(make_tmp_home)"
  repo="$(make_tmp_repo)"
  bun_dir="$(make_fake_bun_dir)"
  marker="$home/init-was-called.marker"
  out="$(env -i HOME="$home" SHELL="/bin/zsh" PATH="$bun_dir:/usr/bin:/bin" \
    SMITH_INSTALLER_BUN_INSTALL_DEPS_CMD=: \
    SMITH_INSTALLER_INIT_CMD="touch '$marker'" \
    bash "$repo/bin/install" 2>&1)"
  code=$?
  assert_eq "exit code" "0" "$code" || return 1
  assert_contains "init-step banner" "$out" "Initializing smith state" || return 1
  if [[ ! -f "$marker" ]]; then
    echo "FAIL: marker file '$marker' was not created — init step did not run" >&2
    echo "$out" >&2
    return 1
  fi
}

test_smith_init_failure_aborts_installer() {
  # If the init step fails, the installer must exit non-zero with a
  # clear error message. This is the contract: init failure is
  # installer-fatal because it defines the no-manual-init guarantee.
  local home repo bun_dir out code
  home="$(make_tmp_home)"
  repo="$(make_tmp_repo)"
  bun_dir="$(make_fake_bun_dir)"
  set +e
  out="$(env -i HOME="$home" SHELL="/bin/zsh" PATH="$bun_dir:/usr/bin:/bin" \
    SMITH_INSTALLER_BUN_INSTALL_DEPS_CMD=: \
    SMITH_INSTALLER_INIT_CMD="false" \
    bash "$repo/bin/install" 2>&1)"
  code=$?
  set -e
  if [[ "$code" -eq 0 ]]; then
    echo "FAIL: installer exited 0 despite init failure" >&2
    echo "$out" >&2
    return 1
  fi
  assert_contains "init failure error" "$out" "smith init failed" || return 1
}

test_unsupported_shell_skips_rc_edit() {
  # SHELL=/bin/fish (or anything not bash/zsh) should fall through to the
  # opt-out treatment: PATH_STATUS=skipped, no rc file edited, exit 0,
  # summary still printed with manual-add instructions.
  local home repo bun_dir out code
  home="$(make_tmp_home)"
  repo="$(make_tmp_repo)"
  bun_dir="$(make_fake_bun_dir)"
  out="$(env -i HOME="$home" SHELL="/usr/local/bin/fish" PATH="$bun_dir:/usr/bin:/bin" \
    SMITH_INSTALLER_BUN_INSTALL_DEPS_CMD=: \
    bash "$repo/bin/install" 2>&1)"
  code=$?
  assert_eq "exit code" "0" "$code" || return 1
  for rc in "$home/.zshrc" "$home/.bashrc" "$home/.bash_profile" "$home/.config/fish/config.fish"; do
    if [[ -f "$rc" ]] && grep -q "agent-smith installer" "$rc"; then
      echo "FAIL: $rc was edited but no rc should have been touched for fish" >&2
      return 1
    fi
  done
  assert_contains "summary mentions opt-out PATH" "$out" "PATH:" || return 1
  assert_contains "summary tells user what to add" "$out" '$HOME/.local/bin' || return 1
}

# --- Driver ---

run_test test_sanity_refuses_outside_a_clone
run_test test_mode_fresh_install_when_no_smith_on_path
run_test test_mode_update_when_smith_points_into_repo_root
run_test test_mode_conflict_when_smith_points_elsewhere
run_test test_bun_missing_consent_yes_runs_installer_command
run_test test_bun_missing_consent_no_exits_with_manual_install_message
run_test test_bun_missing_no_tty_exits_with_clear_error
run_test test_update_mode_refuses_dirty_git_tree
run_test test_fresh_install_runs_bun_install
run_test test_fresh_install_runs_gui_build
run_test test_gui_build_failure_warns_and_continues
run_test test_fresh_install_creates_symlink
run_test test_fresh_install_appends_marker_block_to_zshrc
run_test test_idempotency_marker_block_appended_at_most_once
run_test test_no_modify_path_skips_rc_edit
run_test test_unwritable_rc_skips_rc_edit_without_aborting
run_test test_end_to_end_fresh_install_summary
run_test test_chmod_plus_x_preserved_on_update_mode
run_test test_update_mode_invokes_git_pull
run_test test_bash_shell_routes_to_appropriate_rc
run_test test_unsupported_shell_skips_rc_edit
run_test test_fresh_install_invokes_smith_agent_install_step
run_test test_fresh_install_invokes_smith_init_step
run_test test_smith_init_failure_aborts_installer

echo ""
echo "===================="
echo "PASS: $PASS  FAIL: $FAIL"
if [[ $FAIL -gt 0 ]]; then
  exit 1
fi
exit 0
