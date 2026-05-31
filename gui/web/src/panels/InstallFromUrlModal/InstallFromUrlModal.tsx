import type { JobRequest } from "gui-shared";
import { useEffect, useState } from "react";
import { useDiscoverFromUrl } from "@/hooks/useDiscoverFromUrl";
import { useStartJob } from "@/hooks/useStartJob";
import { Button } from "@/ui/Button";
import { FormField } from "@/ui/FormField";

type Platform = "opencode" | "claude-code" | "codex" | "kiro";

interface Props {
  kind: "agent" | "skill";
  open: boolean;
  onClose: () => void;
  initialUrl?: string;
}

export function InstallFromUrlModal({ kind, open, onClose, initialUrl }: Props) {
  const [url, setUrl] = useState(initialUrl ?? "");
  const [ref, setRef] = useState("");
  const [autoInstallSkills, setAutoInstallSkills] = useState(true);
  const [allowMissingCli, setAllowMissingCli] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [platforms, setPlatforms] = useState<Set<string>>(new Set());
  const start = useStartJob();
  const { status, data, error, discover, reset } = useDiscoverFromUrl(kind);

  // Seed url from initialUrl prop when it changes (only when idle)
  useEffect(() => {
    if (initialUrl && status === "idle") setUrl(initialUrl);
  }, [initialUrl, status]);

  // Reset all state when modal closes (parent-driven close)
  useEffect(() => {
    if (!open) { reset(); setSelected(new Set()); setPlatforms(new Set()); }
  }, [open, reset]);

  // Default-check all detected platforms when entering select step
  useEffect(() => {
    if (status === "select" && data) {
      setPlatforms(new Set(data.detectedTargets));
    }
  }, [status, data]);

  if (!open) return null;

  const discoverDisabled = url.trim().length === 0 || status === "discovering";

  function handleDiscover() {
    if (discoverDisabled) return;
    discover(url.trim(), ref.trim() || undefined);
  }

  function handleBack() {
    reset();
    setSelected(new Set());
    setPlatforms(new Set());
  }

  function handleClose() {
    reset();
    setSelected(new Set());
    setPlatforms(new Set());
    setUrl(initialUrl ?? "");
    setRef("");
    onClose();
  }

  function toggleBundle(name: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function togglePlatform(p: string) {
    setPlatforms((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  }

  function handleInstall(names: string[]) {
    const trimmedRef = ref.trim() || undefined;
    const platformList = [...platforms] as Platform[];
    let req: JobRequest;
    if (kind === "agent") {
      req = {
        command: "agent.install",
        from: url.trim(),
        agents: names,
        platforms: platformList,
        withSkills: autoInstallSkills,
        ...(allowMissingCli ? { allowMissingCli: true } : {}),
        ref: trimmedRef,
      };
    } else {
      req = {
        command: "skill.install",
        from: url.trim(),
        skills: names,
        targets: platformList,
        ref: trimmedRef,
      };
    }
    start.mutate(req);
    onClose();
  }

  const installableCount = data?.bundles.filter((b) => !b.alreadyInstalled).length ?? 0;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
    >
      <div className="border border-matrix-green bg-black p-6 w-[42rem] max-w-[92vw] font-mono max-h-[80vh] overflow-y-auto">
        <h2 className="text-matrix-green text-sm uppercase tracking-widest mb-4">
          // install {kind} from url
        </h2>

        {status === "select" && data ? (
          /* Step 2: bundle + platform selection */
          <div className="flex flex-col gap-3">
            <div className="text-xs text-matrix-body mb-2">
              Found {data.bundles.length} bundle(s) in{" "}
              <span className="text-matrix-green">{url.trim()}</span>
            </div>

            {/* Bundle checkboxes — aligned name / description / status columns */}
            <fieldset className="border border-matrix-line p-2">
              <legend className="text-[10px] uppercase tracking-widest text-matrix-green-muted px-1">
                // bundles
              </legend>
              <div className="grid grid-cols-[auto_auto_1fr_auto] items-baseline gap-x-4 gap-y-1.5 text-xs">
                {/* column header */}
                <div className="contents text-[10px] uppercase tracking-widest text-matrix-green-muted">
                  <span aria-hidden="true" />
                  <span>name</span>
                  <span>description</span>
                  <span className="text-right">status</span>
                </div>
                {data.bundles.map((b) => (
                  <label key={b.name} className="contents text-matrix-body">
                    <input
                      type="checkbox"
                      className="self-center"
                      checked={selected.has(b.name)}
                      disabled={b.alreadyInstalled}
                      onChange={() => toggleBundle(b.name)}
                      aria-label={b.name}
                    />
                    <span className="whitespace-nowrap text-matrix-green">{b.name}</span>
                    <span className="text-matrix-green-muted">{b.description}</span>
                    <span className="whitespace-nowrap text-right text-[10px] uppercase tracking-wide text-matrix-amber">
                      {b.alreadyInstalled ? "installed" : ""}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            {/* Platform checkboxes */}
            <fieldset className="border border-matrix-line p-2">
              <legend className="text-[10px] uppercase tracking-widest text-matrix-green-muted px-1">
                // platforms
              </legend>
              {data.detectedTargets.map((p) => (
                <label key={p} className="flex items-center gap-2 text-xs text-matrix-body py-0.5">
                  <input
                    type="checkbox"
                    checked={platforms.has(p)}
                    onChange={() => togglePlatform(p)}
                    aria-label={p}
                  />
                  {p}
                </label>
              ))}
            </fieldset>

            {/* Agent: auto-install-skills toggle */}
            {kind === "agent" && (
              <label className="flex items-center gap-2 text-xs text-matrix-body mt-1 font-mono">
                <input
                  type="checkbox"
                  checked={autoInstallSkills}
                  onChange={(e) => setAutoInstallSkills(e.target.checked)}
                />
                auto-install required skills
              </label>
            )}

            {/* Allow missing CLI toggle */}
            {kind === "agent" && (
              <label className="flex items-center gap-2 text-xs text-matrix-body mt-1 font-mono">
                <input
                  type="checkbox"
                  checked={allowMissingCli}
                  onChange={(e) => setAllowMissingCli(e.target.checked)}
                />
                Render even if the target platform CLI isn't installed
              </label>
            )}

            <div className="mt-4 flex gap-2 justify-end">
              <Button variant="ghost" onClick={handleBack}>
                back
              </Button>
              <Button variant="ghost" onClick={handleClose}>
                cancel
              </Button>
              {selected.size > 0 && (
                <Button onClick={() => handleInstall([...selected])}>
                  install selected ({selected.size})
                </Button>
              )}
              <Button
                onClick={() => {
                  const all = data.bundles.filter((b) => !b.alreadyInstalled).map((b) => b.name);
                  handleInstall(all);
                }}
                disabled={installableCount === 0}
              >
                install all ({installableCount})
              </Button>
            </div>
          </div>
        ) : (
          /* Step 1: URL + ref input */
          <div className="flex flex-col gap-3">
            <FormField
              label="git url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://… or git@host:…"
            />
            <FormField
              label="git ref (branch / tag / sha)"
              value={ref}
              onChange={(e) => setRef(e.target.value)}
              placeholder="default: HEAD"
            />
            {error && (
              <div className="text-xs text-matrix-red font-mono">{error}</div>
            )}
            {status === "discovering" && (
              <div className="text-xs text-matrix-green-muted font-mono">// discovering…</div>
            )}
            <div className="mt-4 flex gap-2 justify-end">
              <Button variant="ghost" onClick={handleClose}>
                cancel
              </Button>
              <Button disabled={discoverDisabled} onClick={handleDiscover}>
                discover
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
