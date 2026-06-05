import { z } from "zod";
import { Platform } from "./agents";

export const DetectedPlatformsResponse = z.object({
  detected: z.array(Platform),
});
export type DetectedPlatformsResponse = z.infer<typeof DetectedPlatformsResponse>;
