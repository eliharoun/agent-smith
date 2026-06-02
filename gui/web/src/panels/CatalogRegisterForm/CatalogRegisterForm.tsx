import type { GitVerifyResult } from "gui-shared";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useGitVerify } from "@/hooks/useGitVerify";
import { useStartJob } from "@/hooks/useStartJob";
import { previewFor } from "@/lib/argv-preview";
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

interface Props {
  initialRegistry?: Registry;
}

/**
 * New-catalog form. Supports both agent and skill registries — the toggle at
 * the top of the form decides which `smith ... register` command is dispatched.
 *
 * Verify button calls POST /api/git-verify (no job). Inline chip reports the
 * result. Register button is disabled until verify returns ok OR skipGitCheck
 * is on.
 *
 * JobCompletionListener invalidates ['catalogs'] on agent.register/skill.register
 * (see Task 19), so the catalogs list refreshes after navigation.
 */
export function CatalogRegisterForm({ initialRegistry = "agent" }: Props) {
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
  // Reset kind when registry changes if current kind is invalid for new registry.
  const switchRegistry = (next: Registry) => {
    setRegistry(next);
    const validKinds = next === "agent" ? AGENT_KINDS : SKILL_KINDS;
    if (!(validKinds as readonly string[]).includes(kind)) {
      setKind(validKinds[0]);
    }
    // Verify result is path/remote-specific but registry-agnostic, so leave it.
  };

  const canRegister = path.length > 0 && (skipGitCheck || verifyResult?.ok === true);

  const request =
    registry === "agent"
      ? ({
          command: "agent.register" as const,
          path: path || "<path>",
          kind: kind as "user-global" | "project" | "registered",
          ...(label ? { label } : {}),
          ...(gitRemote ? { gitRemote } : {}),
          allowEmpty,
          skipGitCheck,
        } as const)
      : ({
          command: "skill.register" as const,
          path: path || "<path>",
          kind: kind as "user-global" | "user-local" | "team-shared",
          ...(label ? { label } : {}),
          ...(gitRemote ? { gitRemote } : {}),
          allowEmpty,
          skipGitCheck,
        } as const);

  const onVerify = async () => {
    const result = await verify.mutateAsync({
      path,
      ...(gitRemote ? { gitRemote } : {}),
      skipGitCheck,
    });
    setVerifyResult(result);
  };

  const onRegister = async () => {
    await start.mutateAsync(request);
    nav("/catalogs");
  };

  return (
    <Card>
      <div className="font-mono text-[10px] uppercase tracking-widest text-matrix-green-muted mb-3">
        // register catalog
      </div>

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

      <FormField
        label="path"
        value={path}
        onChange={(e) => {
          setPath(e.target.value);
          setVerifyResult(null);
        }}
      />

      <div className="mt-3 flex flex-col gap-1">
        <FieldHelp fieldId="catalog.kind" htmlFor="f-kind">
          kind
        </FieldHelp>
        <select
          id="f-kind"
          value={kind}
          onChange={(e) => setKind(e.target.value)}
          className="bg-black border border-matrix-line px-2 py-1 font-mono text-sm text-matrix-body focus:outline-none focus:border-matrix-green focus:shadow-matrix-focus"
        >
          {kinds.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-3">
        <FormField label="label" value={label} onChange={(e) => setLabel(e.target.value)} />
      </div>
      <div className="mt-3">
        <FormField
          label="git remote"
          value={gitRemote}
          onChange={(e) => {
            setGitRemote(e.target.value);
            setVerifyResult(null);
          }}
          placeholder="https://github.com/owner/repo"
        />
      </div>

      <div className="mt-3 flex flex-wrap gap-4">
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

      <div className="mt-4 flex items-center gap-2">
        <Button variant="ghost" disabled={!path || verify.isPending} onClick={onVerify}>
          Verify
        </Button>
        {verify.isPending && (
          <span className="font-mono text-[10px] text-matrix-green-muted">// verifying…</span>
        )}
        {verifyResult && <VerifyChip result={verifyResult} />}
      </div>

      <div className="mt-4">
        <CliPreview command={previewFor(request)} />
      </div>

      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={() => nav("/catalogs")}>
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
