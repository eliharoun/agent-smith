import { z } from "zod";

export const AtlassianEnvSource = z.enum([
  "env", // process env (SMITH_*)
  "smith-env-file", // ~/.config/agent-smith/.env
  "none",
]);
export type AtlassianEnvSource = z.infer<typeof AtlassianEnvSource>;

export const AtlassianEnvStatus = z.object({
  source: AtlassianEnvSource,
  email: z.string().optional(), // never the token
  hasToken: z.boolean(),
  baseUrl: z.string().url().optional(),
  // Whether the token in `~/.config/agent-smith/.env` is editable by the GUI
  // (i.e., source is "smith-env-file" or "none"). When source is process env,
  // the GUI shows a read-only card and explains how to override.
  editable: z.boolean(),
});
export type AtlassianEnvStatus = z.infer<typeof AtlassianEnvStatus>;

export const AtlassianEnvUpdate = z.object({
  email: z.string().email(),
  // Token may be empty string to mean "do not change" (the GUI uses
  // placeholder UX).
  apiToken: z.string(),
  baseUrl: z.string().url().optional(),
});
export type AtlassianEnvUpdate = z.infer<typeof AtlassianEnvUpdate>;
