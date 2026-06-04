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
  /** Absolute filesystem path the GUI defaults to when exporting bundles.
   *  Empty string means "no preference; use the server's home/Downloads". */
  exportDir: z.string().default(""),
});
export type GuiState = z.infer<typeof GuiState>;

export const GuiStatePatch = GuiState.partial().omit({ schemaVersion: true });
export type GuiStatePatch = z.infer<typeof GuiStatePatch>;
