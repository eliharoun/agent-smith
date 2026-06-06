import type { JobRequest } from "gui-shared";
import { useEffect, useState } from "react";
import { useDiscoverFromUrl } from "@/hooks/useDiscoverFromUrl";
import { Button } from "@/ui/Button";
import { FormField } from "@/ui/FormField";

type SourceKind = "archive" | "directory" | "git-url" | "unknown";

function classifySource(s: string): SourceKind {
  if (s.length === 0) return "unknown";
  if (s.endsWith(".smith-bundle.tgz") || s.endsWith(".tgz")) return "archive";
  if (/^(https:\/\/|git@|ssh:\/\/)/.test(s)) return "git-url";
  if (/^[\/~]|^\.\//.test(s)) return "directory";
  return "unknown";
}

const BADGE_LABEL: Record<SourceKind, string> = {
  archive: "[archive]",
  directory: "[local directory]",
  "git-url": "[git url]",
  unknown: "",
};

function DropZone({ onUploaded }: { onUploaded: (path: string) => void }) {
  const [hover, setHover] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setHover(true);
      }}
      onDragLeave={() => setHover(false)}
      onDrop={async (e) => {
        e.preventDefault();
        setHover(false);
        setError(null);
        const files = Array.from(e.dataTransfer.files);
        if (files.length === 0) return;
        if (files.length > 1) {
          setError("drop a single .smith-bundle.tgz file");
          return;
        }
        const file = files[0]!;
        // Browsers surface folder drops as a zero-byte file with no extension.
        if (file.size === 0 && !file.name.includes(".")) {
          setError("folder drops aren't supported by the browser. Paste the absolute path into the field above.");
          return;
        }
        if (!file.name.endsWith(".smith-bundle.tgz")) {
          setError("expected a .smith-bundle.tgz file");
          return;
        }
        const fd = new FormData();
        fd.append("file", file);
        try {
          const r = await fetch("/api/import/stage", { method: "POST", body: fd });
          if (!r.ok) {
            const body = (await r.json().catch(() => ({}))) as { error?: string };
            setError(body.error ?? `upload failed (${r.status})`);
            return;
          }
          const body = (await r.json()) as { path: string };
          onUploaded(body.path);
        } catch (err) {
          setError(err instanceof Error ? err.message : "upload failed");
        }
      }}
      className={`border border-dashed border-matrix-green-muted rounded p-3 text-center text-xs font-mono ${
        hover ? "bg-matrix-green/10" : ""
      }`}
    >
      drop a <code>.smith-bundle.tgz</code> here
      {error && <div className="text-matrix-red mt-1">{error}</div>}
    </div>
  );
}

type Platform = "opencode" | "claude-code" | "codex" | "kiro";

interface Props {
  kind: "agent" | "skill";
  open: boolean;
  onClose: () => void;
  onDispatch: (req: JobRequest) => void;
  initialUrl?: string;
}

export function InstallFromUrlModal({ kind, open, onClose, onDispatch, initialUrl }: Props) {
  const [url, setUrl] = useState(initialUrl ?? "");
  const [ref, setRef] = useState("");
  const [autoInstallSkills, setAutoInstallSkills] = useState(true);
  const [allowMissingCli, setAllowMissingCli] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [platforms, setPlatforms] = useState<Set<string>>(new Set());
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
  const kind_ = classifySource(url.trim());

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
    onDispatch(req);
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

            {/* Bundle checkboxes */}
            <fieldset className="border border-matrix-line p-2">
              <legend className="text-[10px] uppercase tracking-widest text-matrix-green-muted px-1">
                // bundles
              </legend>
              <div className="grid grid-cols-[auto_auto_1fr_auto] items-baseline gap-x-4 gap-y-1.5 text-xs">
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
            <DropZone onUploaded={(path) => setUrl(path)} />
            <FormField
              label="git url or bundle archive"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://… or git@host:… or path to .smith-bundle.tgz"
            />
            {kind_ !== "unknown" && (
              <span className="text-[10px] font-mono text-matrix-green-muted -mt-2">
                {BADGE_LABEL[kind_]}
              </span>
            )}
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
