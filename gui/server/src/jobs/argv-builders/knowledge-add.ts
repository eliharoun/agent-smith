import type { BuiltArgv } from "./types";
import { previewOf } from "./types";

interface Req {
  agent: string;
  typeOrUrl: string;
  pathOrUrl?: string | undefined;
  id?: string | undefined;
  delivery?: "inline" | "file" | "auto" | undefined;
  description?: string | undefined;
  optional: boolean;
  install: boolean;
  pages?: string | undefined;
  maxPages?: number | undefined;
  includeChildren: boolean;
  format?: "storage" | "view" | "markdown" | undefined;
  fields?: string | undefined;
  maxResults?: number | undefined;
}

export function buildKnowledgeAdd(req: Req): BuiltArgv {
  const argv: string[] = ["knowledge", "add", req.agent, req.typeOrUrl];
  if (req.pathOrUrl !== undefined) argv.push(req.pathOrUrl);

  if (req.id) argv.push("--id", req.id);
  if (req.delivery) argv.push("--delivery", req.delivery);
  if (req.description) argv.push("--description", req.description);
  if (req.optional) argv.push("--optional");
  if (!req.install) argv.push("--no-install");

  if (req.pages) argv.push("--pages", req.pages);
  if (req.maxPages !== undefined) argv.push("--max-pages", String(req.maxPages));
  if (req.includeChildren) argv.push("--include-children");
  if (req.format) argv.push("--format", req.format);

  if (req.fields) argv.push("--fields", req.fields);
  if (req.maxResults !== undefined) argv.push("--max-results", String(req.maxResults));

  // The auto-materialize tail (when install: true) acquires the agent lock
  // because it shells out to `smith agent install <agent>`. Always lock the
  // agent — over-locking is safe; under-locking races with reconfigure.
  return {
    argv,
    lockKeys: [`knowledge:${req.agent}`, `agent:${req.agent}`],
    preview: previewOf(argv),
  };
}
