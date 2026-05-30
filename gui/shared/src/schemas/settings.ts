import { z } from "zod";

export const GuiState = z.object({
  schemaVersion: z.literal(1),
  tourCompleted: z.boolean().default(false),
  lastSeenVersion: z.string(),
  mode: z.enum(["guided", "expert"]).default("guided"),
  theme: z.object({
    intensity: z.enum(["low", "medium", "high"]).default("medium"),
  }),
  port: z.number().int().positive().default(7777),
});
export type GuiState = z.infer<typeof GuiState>;

export const GuiStatePatch = GuiState.partial().omit({ schemaVersion: true });
export type GuiStatePatch = z.infer<typeof GuiStatePatch>;
