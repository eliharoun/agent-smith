import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useGitVerify } from "@/hooks/useGitVerify";
import { useStartJob } from "@/hooks/useStartJob";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { Chrome } from "@/ui/Chrome";
import { CliPreview } from "@/ui/CliPreview";
import { FormField } from "@/ui/FormField";
import { ScreenShell } from "@/ui/ScreenShell";
import { Toggle } from "@/ui/Toggle";

type Mode = "register" | "install";
type Kind = "user-global" | "user-local" | "team-shared";

/**
 * Two-mode skill onboarding screen:
 *
 *   register — register an existing skill catalog directory. Path, kind,
 *              optional label + git remote. Verify remote button calls
 *              POST /api/git/verify-remote so the user gets feedback
 *              before triggering skill.register.
 *
 *   install  — quick-install an individual skill by `<catalog>/<name>` ref
 *              OR by `--from <path>`. The CLI accepts either; this UI
 *              exposes a single text field and infers from the value
 *              (presence of '/' or leading './' → path mode).
 *
 * CliPreview shows the resolved invocation in either mode.
 */
export function SkillNew() {
  const [mode, setMode] = useState<Mode>("register");
  const nav = useNavigate();

  // register-mode state
  const [path, setPath] = useState("");
  const [kind, setKind] = useState<Kind>("user-global");
  const [label, setLabel] = useState("");
  const [gitRemote, setGitRemote] = useState("");
  const [allowEmpty, setAllowEmpty] = useState(false);
  const [skipGitCheck, setSkipGitCheck] = useState(false);

  // install-mode state
  const [installRef, setInstallRef] = useState("");
  const [installAs, setInstallAs] = useState("");

  const start = useStartJob();
  const verify = useGitVerify();

  const preview = useMemo(() => {
    if (mode === "register") {
      const parts = ["smith", "skill", "register", path || "<path>", "--kind", kind];
      if (label) parts.push("--label", label);
      if (gitRemote) parts.push("--git-remote", gitRemote);
      if (allowEmpty) parts.push("--allow-empty");
      if (skipGitCheck) parts.push("--skip-git-check");
      return parts.join(" ");
    }
    // install mode
    const looksLikePath =
      installRef.startsWith("/") || installRef.startsWith("./") || installRef.startsWith("../");
    const parts = ["smith", "skill", "install"];
    if (looksLikePath) parts.push("--from", installRef || "<path>");
    else parts.push(installRef || "<catalog>/<name>");
    if (installAs) parts.push("--as", installAs);
    return parts.join(" ");
  }, [mode, path, kind, label, gitRemote, allowEmpty, skipGitCheck, installRef, installAs]);

  function submitRegister() {
    if (!path) return;
    start.mutate(
      {
        command: "skill.register",
        path,
        kind,
        ...(label ? { label } : {}),
        ...(gitRemote ? { gitRemote } : {}),
        allowEmpty,
        skipGitCheck,
      },
      { onSuccess: () => nav("/skills") },
    );
  }

  function submitInstall() {
    if (!installRef) return;
    const looksLikePath =
      installRef.startsWith("/") || installRef.startsWith("./") || installRef.startsWith("../");
    start.mutate(
      looksLikePath
        ? {
            command: "skill.install",
            from: installRef,
            ...(installAs ? { as: installAs } : {}),
            targets: [],
          }
        : {
            command: "skill.install",
            name: installRef,
            ...(installAs ? { as: installAs } : {}),
            targets: [],
          },
      { onSuccess: () => nav("/skills") },
    );
  }

  return (
    <ScreenShell
      chrome={<Chrome title="Register skill" subtitle="add a catalog or install one skill" />}
    >
      <Card>
        <div className="flex gap-2 mb-4">
          <Button
            variant={mode === "register" ? "primary" : "ghost"}
            onClick={() => setMode("register")}
          >
            Register catalog
          </Button>
          <Button
            variant={mode === "install" ? "primary" : "ghost"}
            onClick={() => setMode("install")}
          >
            Quick install
          </Button>
        </div>

        {mode === "register" ? (
          <div className="space-y-3">
            <FormField
              label="Catalog path"
              placeholder="/absolute/path/to/skill-catalog"
              value={path}
              onChange={(e) => setPath(e.target.value)}
            />
            <div className="flex flex-col gap-1">
              <label className="font-mono text-[10px] uppercase tracking-widest text-matrix-green-muted">
                // Kind
                <select
                  className="bg-black border border-matrix-line px-2 py-1 font-mono text-sm text-matrix-body focus:outline-none focus:border-matrix-green"
                  value={kind}
                  onChange={(e) => setKind(e.target.value as Kind)}
                >
                  <option value="user-global">user-global</option>
                  <option value="user-local">user-local</option>
                  <option value="team-shared">team-shared</option>
                </select>
              </label>
            </div>
            <FormField
              label="Label (optional)"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
            <FormField
              label="Git remote (optional, https://…)"
              value={gitRemote}
              onChange={(e) => setGitRemote(e.target.value)}
            />
            <div className="flex flex-wrap gap-4">
              <Toggle label="allow-empty" checked={allowEmpty} onChange={setAllowEmpty} />
              <Toggle label="skip-git-check" checked={skipGitCheck} onChange={setSkipGitCheck} />
              <Button
                variant="ghost"
                disabled={!path || verify.isPending}
                onClick={() =>
                  verify.mutate({
                    path,
                    ...(gitRemote ? { gitRemote } : {}),
                    skipGitCheck,
                  })
                }
              >
                Verify remote
              </Button>
            </div>
            {verify.data && (
              <div
                className={`font-mono text-xs ${
                  verify.data.ok ? "text-matrix-green" : "text-matrix-red"
                }`}
              >
                {verify.data.ok
                  ? verify.data.skipped
                    ? "// remote check skipped"
                    : `// ok — ${verify.data.remotes?.length ?? 0} remote(s)`
                  : `// failed — ${verify.data.reason}`}
              </div>
            )}
            <CliPreview command={preview} />
            <div className="flex justify-end">
              <Button disabled={!path || start.isPending} onClick={submitRegister}>
                Register
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <FormField
              label="Catalog ref or path"
              hint="catalog/name (e.g. default/tdd) OR /absolute/path/to/skill"
              value={installRef}
              onChange={(e) => setInstallRef(e.target.value)}
            />
            <FormField
              label="Install as (optional)"
              value={installAs}
              onChange={(e) => setInstallAs(e.target.value)}
            />
            <CliPreview command={preview} />
            <div className="flex justify-end">
              <Button disabled={!installRef || start.isPending} onClick={submitInstall}>
                Install
              </Button>
            </div>
          </div>
        )}
      </Card>
    </ScreenShell>
  );
}
