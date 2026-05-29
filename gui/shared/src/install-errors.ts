/** Stable error codes emitted by the CLI `--json`/install paths and rendered by the GUI. */
export type InstallErrorCode =
  | "invalid-url"
  | "invalid-ref"
  | "git-clone-failed"
  | "empty-repo"
  | "usage-error";
