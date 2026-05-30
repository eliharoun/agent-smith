import { z } from "zod";

export const OnboardingState = z.enum(["FIRST_RUN", "NEEDS_USER_MD", "ZERO_AGENTS", "HOME"]);
export type OnboardingState = z.infer<typeof OnboardingState>;

export const OnboardingStatus = z.object({
  state: OnboardingState,
  detectedTools: z.object({
    opencode: z.boolean(),
    claudeCode: z.boolean(),
    codex: z.boolean(),
  }),
  agentCount: z.number(),
});
export type OnboardingStatus = z.infer<typeof OnboardingStatus>;
