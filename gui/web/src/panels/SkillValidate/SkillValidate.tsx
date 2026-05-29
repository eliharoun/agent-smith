import { useStartJob } from "@/hooks/useStartJob";
import { Button } from "@/ui/Button";

/**
 * One-click `smith skill validate <name>` dispatcher. Lives in the
 * SkillEditor header. The global JobStreamModal renders the spawn output
 * and exit. Disabled while a job is in-flight.
 */
export function SkillValidate({ name }: { name: string }) {
  const start = useStartJob();
  const onValidate = () => {
    start.mutate({ command: "skill.validate", name });
  };
  return (
    <Button variant="ghost" onClick={onValidate} disabled={start.isPending}>
      validate
    </Button>
  );
}
