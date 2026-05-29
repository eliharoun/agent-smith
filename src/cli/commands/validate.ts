import pc from "picocolors";
import { assembleBody } from "../../core/assembler";
import type { AgentBundle } from "../../core/types";
import { validate as runValidate } from "../../core/validator";
import { canonicalRegistryPath, loadRegistry } from "../../io/registry";
import type { Registry } from "../../io/registry";
import {
  aggregateLoadFailures,
  findBundleOrFail,
  loadAllBundles,
  type LoadAllBundlesResult,
  warnUnrelatedLoadFailures,
} from "../load-all";

export interface ValidateCliOptions {
  name?: string;
  loadRegistry?: (path: string) => Promise<Registry>;
  loadAllBundles?: (registry: Registry) => Promise<LoadAllBundlesResult>;
  print?: (msg: string) => void;
  printErr?: (msg: string) => void;
}

export async function validate(opts: ValidateCliOptions | string = {}): Promise<number> {
  // Back-compat: a positional string is treated as { name }. The CLI entry
  // point in src/index.ts still calls validate(name), and so do older callers.
  const o: ValidateCliOptions = typeof opts === "string" ? { name: opts } : opts;
  const loadReg = o.loadRegistry ?? loadRegistry;
  const loadBundles = o.loadAllBundles ?? loadAllBundles;
  const print = o.print ?? ((m: string) => console.log(m));
  const printErr = o.printErr ?? ((m: string) => console.error(m));

  const reg = await loadReg(canonicalRegistryPath());
  const result = await loadBundles(reg);

  let targets: AgentBundle[];
  if (o.name) {
    // Surface unrelated load failures as warnings before lookup. The basename
    // check matches findBundleOrFail's heuristic so the target failure is
    // re-surfaced as a partial-failure SmithError rather than double-printed.
    warnUnrelatedLoadFailures(result.failures, o.name, printErr);
    targets = [findBundleOrFail(result, o.name)];
  } else {
    // No name: validate all loaded bundles. Load failures are aggregated
    // below into a single partial-failure SmithError alongside any
    // validation failures, so wrap.ts can surface them structurally.
    targets = result.bundles;
    if (targets.length === 0 && result.failures.length === 0) {
      printErr(pc.red("No agent found"));
      return 1;
    }
  }

  let bad = 0;
  // Mirror formatFailureDetail's `[<label>] <id>: <reason>` shape so machine
  // consumers (daemon, JSON output, smith-doctor) can enumerate validation
  // failures from the partial-failure envelope, not just load failures.
  const validationFailDetails: string[] = [];
  for (const b of targets) {
    const body = assembleBody(b.files);
    const r = runValidate({ config: b.config, files: b.files, assembledBody: body });
    if (r.ok) {
      print(`${pc.green("PASS")} ${b.config.name}`);
      for (const w of r.warnings) print(`${pc.yellow("  warn")} ${w}`);
    } else {
      bad++;
      print(`${pc.red("FAIL")} ${b.config.name}`);
      for (const e of r.errors) print(`${pc.red("  error")} ${e}`);
      for (const w of r.warnings) print(`${pc.yellow("  warn")} ${w}`);
      const n = r.errors.length;
      validationFailDetails.push(
        `[${b.source.label}] ${b.config.name}: validation failed (${n} error${n === 1 ? "" : "s"})`,
      );
    }
  }

  // Unfiltered branch: combine load failures with validation failures into
  // a single partial-failure SmithError so the wrap.ts envelope can surface
  // them structurally. Per-error text is already printed inline above; the
  // envelope details summarize one line per failed bundle.
  if (!o.name) {
    const err = aggregateLoadFailures(
      "validate",
      targets.length - bad,
      result.failures,
      validationFailDetails,
      bad,
    );
    if (err) throw err;
    return 0;
  }
  return bad === 0 ? 0 : 1;
}
