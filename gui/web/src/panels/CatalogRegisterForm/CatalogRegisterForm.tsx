import type { GitVerifyResult, JobRequest } from "gui-shared";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useGitVerify } from "@/hooks/useGitVerify";
import { useStartJob } from "@/hooks/useStartJob";
import { classifySource } from "@/panels/AddAgentModal/classifySource";
import { previewFor } from "@/lib/argv-preview";
import { useDebounced } from "@/lib/use-debounced";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { Chip } from "@/ui/Chip";
import { CliPreview } from "@/ui/CliPreview";
import { FieldHelp } from "@/ui/FieldHelp";
import { FormField } from "@/ui/FormField";
import { Toggle } from "@/ui/Toggle";

type Registry = "agent" | "skill";

const AGENT_KINDS = ["user-global", "project", "registered"] as const;
const SKILL_KINDS = ["user-global", "user-local", "team-shared"] as const;

type AgentKind = (typeof AGENT_KINDS)[number];
type SkillKind = (typeof SKILL_KINDS)[number];

interface KindMeta {
  label: string;
  subtitle: string;
}

const AGENT_KIND_META: Record<AgentKind, KindMeta> = {
  "user-global": {
    label: "For me",
    subtitle: "Install just for you, available in every project.",
  },
  project: {
    label: "For this project",
    subtitle: "Install into the current project only (.agent-smith/).",
  },
  registered: {
    label: "Shared with team",
    subtitle: "Register in a shared catalog accessible to the whole team.",
  },
};

const SKILL_KIND_META: Record<SkillKind, KindMeta> = {
  "user-global": {
    label: "For me",
    subtitle: "Install just for you, available in every project.",
  },
  "user-local": {
    label: "For this project",
    subtitle: "Install into the current project only (.agent-smith/).",
  },
  "team-shared": {
    label: "Shared with team",
    subtitle: "Publish to the team-shared skill registry.",
  },
};

interface Props {
  initialRegistry?: Registry;
  lockRegistry?: boolean;
  onDispatch?: (request: JobRequest) => void;
  onClose?: () => void;
}

/**
 * New-catalog form. Supports both agent and skill registries — the toggle at
 * the top of the form decides which `smith ... register` command is dispatched.
 *
 * Auto-verify: path is debounced 400ms → POST /api/git-verify (no job). Inline
 * chip reports the result. Register button is disabled until verify returns ok
 * OR skipGitCheck is on.
 *
 * Optional onDispatch/onClose props: when provided the form dispatches via the
 * caller (modal-embeddable); when absent it falls back to useStartJob + nav
 * (standalone /catalogs/register route).
 *
 * JobCompletionListener invalidates ['catalogs'] on agent.register/skill.register
 * (see Task 19), so the catalogs list refreshes after navigation.
 */
export function CatalogRegisterForm({ initialRegistry = "agent", lockRegistry, onDispatch, onClose }: Props = {}) {
  const [registry, setRegistry] = useState<Registry>(initialRegistry);
  const [path, setPath] = useState("");
  const [kind, setKind] = useState<string>("user-global");
  const [label, setLabel] = useState("");
  const [gitRemote, setGitRemote] = useState("");
  const [skipGitCheck, setSkipGitCheck] = useState(false);
  const [allowEmpty, setAllowEmpty] = useState(false);
  const [verifyResult, setVerifyResult] = useState<GitVerifyResult | null>(null);
  const verify = useGitVerify();
  const start = useStartJob();
  const nav = useNavigate();

  const kinds = registry === "agent" ? AGENT_KINDS : SKILL_KINDS;
  const kindMeta = registry === "agent" ? AGENT_KIND_META : SKILL_KIND_META;

  // Reset kind when registry changes if current kind is invalid for new registry.
  const switchRegistry = (next: Registry) => {
    setRegistry(next);
    const validKinds = next === "agent" ? AGENT_KINDS : SKILL_KINDS;
    if (!(validKinds as readonly string[]).includes(kind)) {
      setKind(validKinds[0]);
    }
    // Verify result is path/remote-specific but registry-agnostic, so leave it.
  };

  // Debounced auto-verify — fires 400ms after the user stops typing path/gitRemote.
  const debouncedPath = useDebounced(path, 400);
  const debouncedGitRemote = useDebounced(gitRemote, 400);

  useEffect(() => {
    if (!debouncedPath || skipGitCheck) return;
    verify.mutate(
      {
        path: debouncedPath,
        ...(debouncedGitRemote ? { gitRemote: debouncedGitRemote } : {}),
        skipGitCheck,
      },
      {
        onSuccess: (result) => setVerifyResult(result),
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedPath, debouncedGitRemote]);

  const canRegister = path.length > 0 && (skipGitCheck || verifyResult?.ok === true);

  const request =
    registry === "agent"
      ? ({
          command: "agent.register" as const,
          path: path || "<path>",
          kind: kind as AgentKind,
          ...(label ? { label } : {}),
          ...(gitRemote ? { gitRemote } : {}),
          allowEmpty,
          skipGitCheck,
        } as const)
      : ({
          command: "skill.register" as const,
          path: path || "<path>",
          kind: kind as SkillKind,
          ...(label ? { label } : {}),
          ...(gitRemote ? { gitRemote } : {}),
          allowEmpty,
          skipGitCheck,
        } as const);

  const onRegister = async () => {
    if (onDispatch) {
      onDispatch(request);
      onClose?.();
    } else {
      await start.mutateAsync(request);
      nav("/catalogs");
    }
  };

  return (
    <Card>
      <div className="font-mono text-[10px] uppercase tracking-widest text-matrix-green-muted mb-3">
        // register catalog
      </div>

      <p className="font-mono text-xs text-matrix-body mb-4">
        A catalog is a folder or git repo full of {registry === "agent" ? "agents" : "skills"} that smith can browse and install from.
      </p>

      {!lockRegistry && (
        <div className="flex gap-2 mb-3">
          {(["agent", "skill"] as Registry[]).map((r) => (
            <Button
              key={r}
              variant={registry === r ? "primary" : "ghost"}
              onClick={() => switchRegistry(r)}
            >
              {r === "agent" ? "Agent" : "Skill"}
            </Button>
          ))}
        </div>
      )}

      <FormField
        label="path"
        fieldId="catalog.path"
        placeholder="~/my-agents  or  /abs/path/to/repo"
        value={path}
        onChange={(e) => {
          setPath(e.target.value);
          setVerifyResult(null);
        }}
      />
      {/* The path field wants a LOCAL folder. If the user pastes a URL or
          archive, point them at the Install flow before they hit a confusing
          "not a git repo" verification error. */}
      {(() => {
        const looksRemote = classifySource(path) === "git-url" || classifySource(path) === "archive";
        if (!looksRemote) return null;
        return (
          <div className="mt-1 flex items-center gap-2" role="note">
            <Chip tone="amber">looks like a URL</Chip>
            <span className="font-mono text-[10px] text-matrix-green-muted">
              this field registers a folder already on disk. To pull from a URL or archive, use
              “Install from URL” instead.
            </span>
          </div>
        );
      })()}

      <div className="mt-3 flex flex-col gap-1">
        <FieldHelp fieldId="catalog.kind" htmlFor="f-kind-group">
          kind
        </FieldHelp>
        <fieldset id="f-kind-group" className="flex flex-col gap-2 border-0 p-0 m-0">
          <legend className="sr-only">kind</legend>
          {kinds.map((k) => {
            const meta: KindMeta | undefined = (kindMeta as Record<string, KindMeta | undefined>)[k];
            const selected = kind === k;
            if (!meta) return null;
            return (
              <label
                key={k}
                className={`flex flex-col gap-0.5 cursor-pointer font-mono text-xs px-2 py-1 border ${
                  selected
                    ? "border-matrix-green text-matrix-body"
                    : "border-matrix-line text-matrix-muted hover:border-matrix-green-muted"
                }`}
              >
                <span className="inline-flex items-center gap-2">
                  <input
                    type="radio"
                    name="catalog-kind"
                    value={k}
                    checked={selected}
                    onChange={() => setKind(k)}
                    className="accent-matrix-green"
                  />
                  {meta.label}
                </span>
                {selected && (
                  <span className="text-[10px] text-matrix-green-muted pl-5">{meta.subtitle}</span>
                )}
              </label>
            );
          })}
        </fieldset>
      </div>

      <div className="mt-3">
        <FormField label="label" value={label} onChange={(e) => setLabel(e.target.value)} />
      </div>
      <div className="mt-3">
        <FormField
          label="git remote"
          fieldId="catalog.gitRemote"
          value={gitRemote}
          onChange={(e) => {
            setGitRemote(e.target.value);
            setVerifyResult(null);
          }}
          placeholder="https://github.com/owner/repo  (optional — auto-detected)"
        />
      </div>

      <details className="mt-3">
        <summary className="font-mono text-[10px] uppercase tracking-widest text-matrix-green-muted cursor-pointer select-none">
          // advanced
        </summary>
        <div className="mt-2 flex flex-wrap gap-4">
          <span className="inline-flex items-center gap-1">
            <Toggle label="skip git check" checked={skipGitCheck} onChange={setSkipGitCheck} />
            <FieldHelp fieldId="catalog.skipGitCheck" iconOnly>
              skip git check
            </FieldHelp>
          </span>
          <span className="inline-flex items-center gap-1">
            <Toggle label="allow empty" checked={allowEmpty} onChange={setAllowEmpty} />
            <FieldHelp fieldId="catalog.allowEmpty" iconOnly>
              allow empty
            </FieldHelp>
          </span>
        </div>
      </details>

      {verify.isPending && (
        <div className="mt-3">
          <span className="font-mono text-[10px] text-matrix-green-muted">// verifying…</span>
        </div>
      )}
      {verifyResult && (
        <div className="mt-3">
          <VerifyChip result={verifyResult} />
        </div>
      )}

      <div className="mt-4">
        <CliPreview command={previewFor(request)} />
      </div>

      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose ?? (() => nav("/catalogs"))}>
          Cancel
        </Button>
        <Button disabled={!canRegister || start.isPending} onClick={onRegister}>
          Register
        </Button>
      </div>
    </Card>
  );
}

function VerifyChip({ result }: { result: GitVerifyResult }) {
  if (result.ok && result.skipped) {
    return <Chip tone="green">skipped (--skip-git-check)</Chip>;
  }
  if (result.ok) {
    const names = (result.remotes ?? []).map((r) => `${r.name}=${r.url}`).join(", ");
    return (
      <span className="flex items-center gap-2">
        <Chip tone="green">verified</Chip>
        {names && <span className="font-mono text-[10px] text-matrix-green-muted">{names}</span>}
      </span>
    );
  }
  if (result.reason === "not-a-git-repo") {
    return (
      <span className="flex items-center gap-2">
        <Chip tone="amber">not a git repo</Chip>
        <span className="font-mono text-[10px] text-matrix-green-muted">
          toggle skip-git-check or pick a different path
        </span>
      </span>
    );
  }
  // remote-mismatch
  const found = result.found.map((r) => `${r.name}=${r.url}`).join(", ");
  return (
    <span className="flex items-center gap-2">
      <Chip tone="red">remote mismatch</Chip>
      <span className="font-mono text-[10px] text-matrix-green-muted">{found}</span>
    </span>
  );
}
