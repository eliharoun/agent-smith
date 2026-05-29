import { useDoctor } from "@/hooks/useDoctor";
import { deriveOverallHealth, flattenChecks, isRefusal } from "@/lib/doctor-overall";

export function useDoctorRadialData() {
  const q = useDoctor();
  const report = q.data;
  if (!report) {
    return {
      score: 0,
      label: "...",
      loading: q.isLoading,
      refusal: false,
      error: q.error as Error | null,
      refetch: q.refetch,
    };
  }
  const checks = flattenChecks(report);
  const total = checks.length;
  const passed = checks.filter((c) => c.status === "ok").length;
  return {
    score: total > 0 ? Math.round((passed / total) * 100) : 100,
    label: deriveOverallHealth(report),
    loading: false,
    refusal: isRefusal(report),
    error: null as Error | null,
    refetch: q.refetch,
  };
}
