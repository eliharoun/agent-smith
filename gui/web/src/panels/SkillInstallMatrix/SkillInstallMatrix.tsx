import type { Platform } from "gui-shared";
import { useState } from "react";
import { useStartJob } from "@/hooks/useStartJob";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { Toggle } from "@/ui/Toggle";

const PLATFORMS: Platform[] = ["opencode", "claude-code", "codex", "kiro"];

interface Props {
  name: string;
  installedOn: Platform[];
}

/**
 * Per-platform install matrix for a single skill. Toggles compute an
 * install/uninstall queue based on the difference between user intent
 * and current `installedOn` (sourced from installed-skills.json via
 * SkillDetail). Unlike the agent install matrix, skills do not trigger
 * knowledge refresh, so there is no RefreshConsent step.
 *
 * The Update button uses `skill.update` with the panel's name to pull
 * the latest catalog SKILL.md onto every platform where the skill is
 * already installed.
 *
 * JobCompletionListener invalidates ['skills'] and ['installed-skills']
 * on skill.* exit (Task 19) so the panel refreshes after each job.
 */
export function SkillInstallMatrix({ name, installedOn }: Props) {
  const start = useStartJob();
  const [desired, setDesired] = useState<Partial<Record<Platform, boolean>>>({});

  function checkedFor(p: Platform): boolean {
    return desired[p] ?? installedOn.includes(p);
  }
  function toggle(p: Platform, v: boolean) {
    setDesired((prev) => ({ ...prev, [p]: v }));
  }

  const installs = PLATFORMS.filter((p) => checkedFor(p) && !installedOn.includes(p));
  const uninstalls = PLATFORMS.filter((p) => !checkedFor(p) && installedOn.includes(p));

  async function apply() {
    if (installs.length > 0) {
      await start.mutateAsync({ command: "skill.install", name, targets: installs });
    }
    if (uninstalls.length > 0) {
      // skill.uninstall is whole-skill; there is no per-platform variant.
      // Only invoke it if the user is uninstalling EVERY currently-installed
      // platform; otherwise display a disabled state hint (handled in render).
      await start.mutateAsync({ command: "skill.uninstall", name });
    }
    setDesired({});
  }

  const fullUninstall = uninstalls.length > 0 && uninstalls.length === installedOn.length;
  const partialUninstallAttempt = uninstalls.length > 0 && !fullUninstall;
  const canApply =
    !start.isPending && (installs.length > 0 || fullUninstall) && !partialUninstallAttempt;

  return (
    <Card>
      <div className="font-mono text-[10px] uppercase tracking-widest text-matrix-green-muted mb-2">
        // install matrix
      </div>
      <table className="w-full text-sm">
        <tbody>
          {PLATFORMS.map((p) => (
            <tr key={p} className="border-t border-matrix-line">
              <td className="py-2 font-mono text-matrix-body">{p}</td>
              <td className="py-2 text-right">
                <Toggle
                  aria-label={`${name} · ${p}`}
                  checked={checkedFor(p)}
                  onChange={(v) => toggle(p, v)}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {partialUninstallAttempt && (
        <div className="mt-2 text-[10px] font-mono text-matrix-amber">
          // skill uninstall removes the skill from ALL platforms. Toggle every installed platform
          off to apply.
        </div>
      )}
      <div className="mt-3 flex justify-between gap-2">
        <Button
          variant="ghost"
          disabled={installedOn.length === 0 || start.isPending}
          onClick={() => start.mutate({ command: "skill.update", name, all: false })}
          title="re-pull latest catalog SKILL.md onto every installed platform"
        >
          Update
        </Button>
        <Button disabled={!canApply} onClick={apply}>
          Apply changes
        </Button>
      </div>
    </Card>
  );
}
