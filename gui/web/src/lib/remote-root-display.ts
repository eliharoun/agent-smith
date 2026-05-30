// gui/web/src/lib/remote-root-display.ts
//
// [v1-task RC2-8] Display-only constant for the smith-managed clone root.
//
// Path mirrors src/io/remote-root.ts:defaultRemoteRoot() — but in the
// web bundle we never compute a real path (no process.env, no os.homedir).
// Modals and previews use this string for "preview where this will clone
// to" displays passed into deriveRemotePathWeb().
//
// Kept in sync with the CLI by hand. RC2-1 relocated the clone tree from
// $XDG_CONFIG_HOME/agent-smith/remote to $XDG_STATE_HOME/agent-smith/remote
// (default ~/.local/state/agent-smith/remote). Updating this constant is
// the second half of that relocation — every previously-hardcoded
// "~/.config/agent-smith/remote" literal in the web bundle has been
// replaced with REMOTE_ROOT_DISPLAY.

export const REMOTE_ROOT_DISPLAY = "~/.local/state/agent-smith/remote";
