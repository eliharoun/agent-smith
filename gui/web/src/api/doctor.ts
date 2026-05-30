import type { DoctorResponse } from "gui-shared";
import { apiFetch } from "./client";
export const doctorApi = { get: () => apiFetch<DoctorResponse>("/api/doctor") };
