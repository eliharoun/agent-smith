import { useState } from "react";
import { useStartJob } from "@/hooks/useStartJob";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { CliPreview } from "@/ui/CliPreview";
import { Toggle } from "@/ui/Toggle";

const PLATFORMS = ["opencode", "claude-code", "codex", "kiro"] as const;
type Platform = (typeof PLATFORMS)[number];

/**
 * Drives `smith skill bootstrap [--dry-run] [--targets a,b,...]`.
 *
 * Targets behavior matches the CLI: empty array (all toggles off) is
 * treated as "all platforms" by the CLI default. The UI exposes this
 * intentionally — toggles let the user narrow, not widen.
 *
 * `JobCompletionListener` invalidates ['skills'], ['installed-skills'],
 * and ['skill-catalogs'] on skill.* exit (see Task 19), so the rest of
 * the screen refreshes after the job completes.
 */
export function SkillBootstrap() {
  const [dryRun, setDryRun] = useState(false);
  const [targets, setTargets] = useState<Record<Platform, boolean>>({
    opencode: false,
    "claude-code": false,
    codex: false,
    kiro: false,
  });
  const start = useStartJob();

  const selectedTargets = PLATFORMS.filter((p) => targets[p]);
  const previewParts = ["smith", "skill", "bootstrap"];
  if (dryRun) previewParts.push("--dry-run");
  if (selectedTargets.length > 0) {
    previewParts.push("--targets", selectedTargets.join(","));
  }
  const preview = previewParts.join(" ");

  return (
    <Card>
      <div className="font-mono text-[10px] uppercase tracking-widest text-matrix-green-muted mb-2">
        // bootstrap bundled skills
      </div>
      <div className="font-mono text-xs text-matrix-body mb-3">
        Reinstalls the bundled the-architect and the-keymaker skills onto the selected platforms.
        Useful for recovery if the postinstall hook didn't run.
      </div>
      <div className="flex flex-wrap gap-4 mb-3">
        {PLATFORMS.map((p) => (
          <Toggle
            key={p}
            label={p}
            checked={targets[p]}
            onChange={(next) => setTargets((s) => ({ ...s, [p]: next }))}
          />
        ))}
        <Toggle label="dry-run" checked={dryRun} onChange={setDryRun} />
      </div>
      <CliPreview command={preview} />
      <div className="flex justify-end mt-3">
        <Button
          onClick={() =>
            start.mutate({
              command: "skill.bootstrap",
              dryRun,
              targets: selectedTargets,
            })
          }
        >
          Bootstrap
        </Button>
      </div>
    </Card>
  );
}
