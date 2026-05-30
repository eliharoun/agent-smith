import { z } from "zod";
export const UserMdContent = z.object({ content: z.string().max(64_000) });
export type UserMdContent = z.infer<typeof UserMdContent>;
