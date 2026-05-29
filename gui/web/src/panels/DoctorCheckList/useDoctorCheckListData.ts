import { useDoctor } from "@/hooks/useDoctor";
import { flattenChecks, isRefusal } from "@/lib/doctor-overall";

export function useDoctorCheckListData() {
  const q = useDoctor();
  const checks = q.data ? flattenChecks(q.data) : [];
  const refusal = q.data ? isRefusal(q.data) : false;
  return {
    checks,
    loading: q.isLoading,
    error: q.error,
    refusal,
    refetch: q.refetch,
  };
}
