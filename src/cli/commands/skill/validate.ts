import pc from "picocolors";
import { SmithError } from "../../../core/smith-error";
import { toMessage } from "../../../core/to-message";
import {
  discoverSkills,
  type FindSkillResult,
  findSkillByName,
} from "../../../io/skill-discovery";
import {
  canonicalSkillRegistryPath,
  loadSkillRegistry,
  type SkillRegistry,
} from "../../../io/skill-registry";

export interface ValidateSkillCliOptions {
  name: string;
  /** Test seam: override $HOME so registry path resolves into a tmp dir. */
  homeDirOverride?: string;
  print?: (msg: string) => void;
  printErr?: (msg: string) => void;
}

/**
 * Validate a single registered skill by name.
 *
 * Exit codes (mirroring `smith agent validate <name>`):
 *   0  — valid
 *   1  — not found
 *   2  — invalid frontmatter OR ambiguous (multiple catalogs)
 */
export async function validateSkillCli(opts: ValidateSkillCliOptions): Promise<number> {
  const print = opts.print ?? ((m) => console.log(m));
  const printErr = opts.printErr ?? ((m) => console.error(m));
  const registryPath = opts.homeDirOverride
    ? `${opts.homeDirOverride}/.config/agent-smith/skill-catalogs.json`
    : canonicalSkillRegistryPath();

  let reg: SkillRegistry;
  try {
    reg = await loadSkillRegistry(registryPath);
  } catch (err) {
    printErr(pc.red(`skill registry unreadable: ${toMessage(err)}`));
    return 2;
  }

  let result: FindSkillResult;
  try {
    result = await findSkillByName(reg, opts.name);
  } catch (err) {
    // findSkillByName swallows per-catalog errors internally, but
    // discoverSkills's frontmatter checks throw SmithError. A throw here
    // means one of the matching skills had invalid frontmatter.
    if (err instanceof SmithError) {
      printErr(pc.red(`FAIL ${opts.name}`));
      const reasons =
        err.payload.code === "validation-failed" ? err.payload.reasons : [toMessage(err)];
      for (const r of reasons) {
        printErr(pc.red(`  error ${r}`));
      }
      return 2;
    }
    throw err;
  }

  if ("error" in result) {
    if (result.error === "not-found") {
      // findSkillByName swallows per-catalog errors with `catch{continue}` so
      // a skill whose SKILL.md has invalid frontmatter looks "not found" from
      // its perspective. Re-walk each catalog WITHOUT swallowing so we can
      // distinguish a genuine miss (exit 1) from a malformed-but-named-match
      // (exit 2). See plan Amendment AA.
      for (const cat of reg.catalogs) {
        try {
          const found = await discoverSkills(cat);
          if (found.some((s) => s.name === opts.name)) {
            // Shouldn't happen — findSkillByName would have returned it.
            // Treat defensively as a pass to avoid a spurious failure.
            print(`${pc.green("PASS")} ${opts.name}  [${cat.label}]`);
            return 0;
          }
        } catch (err) {
          if (err instanceof SmithError && err.payload.code === "validation-failed") {
            // discoverSkills throws on the first bad SKILL.md it encounters.
            // We can't cheaply confirm it was THIS skill's SKILL.md, but the
            // reasons array includes the file path so the user can tell.
            // Only surface as a validation failure if a reason references
            // the requested name's directory; otherwise keep walking.
            const relevant = err.payload.reasons.filter((r) =>
              r.includes(`/${opts.name}/SKILL.md`),
            );
            if (relevant.length > 0) {
              printErr(pc.red(`FAIL ${opts.name}`));
              for (const r of relevant) {
                printErr(pc.red(`  error ${r}`));
              }
              return 2;
            }
            // unrelated catalog corruption — keep searching other catalogs
            continue;
          }
          throw err;
        }
      }
      printErr(pc.red(`skill '${opts.name}' not found in any registered catalog`));
      return 1;
    }
    // ambiguous
    printErr(
      pc.red(
        `skill '${opts.name}' is ambiguous — appears in ${result.matches.length} catalogs:`,
      ),
    );
    for (const m of result.matches) {
      printErr(pc.red(`  - ${m.catalogLabel}: ${m.path}`));
    }
    printErr(pc.dim("Disambiguate with '<catalog>/<name>' in skill install / update."));
    return 2;
  }

  print(`${pc.green("PASS")} ${result.name}  [${result.catalogLabel}]`);
  return 0;
}
