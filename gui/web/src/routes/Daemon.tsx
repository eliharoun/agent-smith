import { DaemonControl } from "@/panels/DaemonControl";
import { DaemonLogTail } from "@/panels/DaemonLogTail";
import { SmithEnvForm } from "@/panels/SmithEnvForm";

export function Daemon() {
  return (
    <div className="p-6 space-y-4">
      <DaemonControl />
      <DaemonLogTail />
      <SmithEnvForm />
    </div>
  );
}
