import type { JobRequest } from "gui-shared";
import { useState } from "react";
import { useStartJob } from "@/hooks/useStartJob";
import { deriveRemotePathWeb } from "@/lib/remote-path";
import { REMOTE_ROOT_DISPLAY } from "@/lib/remote-root-display";
import { Button } from "@/ui/Button";
import { FormField } from "@/ui/FormField";

interface Props {
  kind: "agent" | "skill";
  open: boolean;
  onClose: () => void;
}

/**
 * InstallFromUrlModal (C4.5.1 scaffolding)
 *
 * Single-screen form that collects a git URL + optional ref (and, for
 * kind=agent, the auto-install-skills flag) and dispatches an install
 * job via the daemon. C4.5.1 ships only the scaffolding — URL validation
 * and dispatch wiring land in C4.5.2 and C4.5.4 respectively.
 *
 * Why a single screen (no wizard): brainstorm decision — multi-bundle
 * URLs return the CLI error verbatim, so there's no per-bundle picker.
 */
export function InstallFromUrlModal({ kind, open, onClose }: Props) {
  const [url, setUrl] = useState("");
  const [ref, setRef] = useState("");
  const [autoInstallSkills, setAutoInstallSkills] = useState(true);
  const start = useStartJob();

  if (!open) return null;

  // URL validation: defer to the CLI-mirror parser; if it accepts the URL,
  // it also passes the transport allowlist and option-injection guard.
  const urlError = (() => {
    if (!url) return null;
    try {
      deriveRemotePathWeb(url, "/preview");
      return null;
    } catch (e) {
      return (e as Error).message;
    }
  })();

  // Ref validation: leading-dash trips git's option-injection surface;
  // shell metacharacters and control chars are forbidden defensively even
  // though the daemon never spawns a shell — keeps user input clean.
  const refError = (() => {
    if (!ref) return null;
    if (ref.startsWith("-")) return "ref must not start with '-'";
    // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional reject of control chars in ref input
    if (/[;|`$\n\r\u0000-\u001f\u007f]/.test(ref)) return "ref contains forbidden character";
    return null;
  })();

  const installDisabled = url.trim().length === 0 || !!urlError || !!refError;

  // Live clone-path preview: shown only when URL parses successfully.
  // The displayed root is a human-readable placeholder; the real on-disk
  // root is resolved CLI-side at job execution time.
  const preview = (() => {
    if (!url || urlError) return null;
    try {
      return deriveRemotePathWeb(url, REMOTE_ROOT_DISPLAY);
    } catch {
      return null;
    }
  })();

  const handleInstall = () => {
    if (installDisabled) return;
    const trimmedRef = ref.trim() || undefined;
    let req: JobRequest;
    if (kind === "agent") {
      // from-only shape: schema's .refine() permits name+platforms to be omitted
      // when `from` is set; CLI derives name from the bundle and prompts for
      // platforms over SSE.
      req = {
        command: "agent.install",
        platforms: [],
        withSkills: autoInstallSkills,
        from: url,
        ref: trimmedRef,
      };
    } else {
      req = {
        command: "skill.install",
        from: url,
        targets: [],
        ref: trimmedRef,
      };
    }
    start.mutate(req);
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
    >
      <div className="border border-matrix-green bg-black p-6 w-[32rem] font-mono">
        <h2 className="text-matrix-green text-sm uppercase tracking-widest mb-4">
          // install {kind} from url
        </h2>
        <div className="flex flex-col gap-3">
          <FormField
            label="git url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://… or git@host:…"
            error={urlError ?? undefined}
          />
          <FormField
            label="ref"
            value={ref}
            onChange={(e) => setRef(e.target.value)}
            placeholder="branch, tag, or sha (default: HEAD)"
            error={refError ?? undefined}
          />
          {kind === "agent" && (
            <label className="flex items-center gap-2 text-xs text-matrix-body mt-2 font-mono">
              <input
                type="checkbox"
                checked={autoInstallSkills}
                onChange={(e) => setAutoInstallSkills(e.target.checked)}
              />
              auto-install required skills
            </label>
          )}
          {preview && (
            <div className="text-[10px] text-matrix-green-muted font-mono mt-2 break-all">
              // clone target: {preview}/
            </div>
          )}
        </div>
        <div className="mt-6 flex gap-2 justify-end">
          <Button variant="ghost" onClick={onClose}>
            cancel
          </Button>
          <Button disabled={installDisabled} onClick={handleInstall}>
            install
          </Button>
        </div>
      </div>
    </div>
  );
}
