import { useJobToast } from "@/hooks/useJobToast";
import { Button } from "@/ui/Button";

/**
 * One-click `smith skill validate <name>` dispatcher. Lives in the
 * SkillEditor header. Progress/success/error toasts are shown via
 * useJobToast. Disabled while a job is in-flight.
 */
export function SkillValidate({ name }: { name: string }) {
  const validateToast = useJobToast({
    command: "skill.validate",
    label: {
      progress: () => `Validating ${name}…`,
      success: () => `Validated ${name}`,
      error: () => "Validate failed",
    },
    dedupKey: `job-toast:skill.validate:${name}`,
  });
  const onValidate = () => {
    validateToast.dispatch({ command: "skill.validate", name });
  };
  return (
    <Button variant="ghost" onClick={onValidate} disabled={validateToast.isPending}>
      validate
    </Button>
  );
}
