import { z } from "zod";

export const GitVerifyRequest = z.object({
  path: z.string().min(1),
  gitRemote: z.string().url().optional(),
  // When true, returns success without running git (mirrors --skip-git-check).
  skipGitCheck: z.boolean().default(false),
});
export type GitVerifyRequest = z.infer<typeof GitVerifyRequest>;

export const GitRemote = z.object({
  name: z.string(),
  url: z.string(),
});

export const GitVerifyResult = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    skipped: z.boolean(),
    remotes: z.array(GitRemote).optional(),
  }),
  z.object({ ok: z.literal(false), reason: z.literal("not-a-git-repo") }),
  z.object({
    ok: z.literal(false),
    reason: z.literal("remote-mismatch"),
    found: z.array(GitRemote),
  }),
]);
export type GitVerifyResult = z.infer<typeof GitVerifyResult>;
