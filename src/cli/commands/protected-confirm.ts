import pc from "picocolors";
import {
  cloneRepoRoot,
  isLocalSmithClone,
  isProtectedAgent,
  isProtectedSkill,
  type ProtectedVerb,
  refusalMessage,
} from "../../core/protected-bundles";
import { SmithError } from "../../core/smith-error";
import { readToken } from "../prompt";

/**
 * DI seam for the clone-mode confirmation prompt. Production wires `prompt` to
 * the existing `readToken` helper (or a command's own injected prompt); tests
 * inject a stub.
 */
export interface ConfirmDeps {
  prompt: (question: string) => Promise<string>;
  log: (line: string) => void;
  errLog: (line: string) => void;
}

export interface ConfirmArgs {
  entity: string;
  verb: string;
  repoRoot: string;
}

export interface ConfirmResult {
  confirmed: boolean;
}

/**
 * Clone-mode confirmation. End-users never reach this (their guards hard-refuse
 * before getting here); only maintainers running smith from a clone see it.
 *
 * `SMITH_CLONE_CONFIRM_ALL=1` is a developer affordance that auto-confirms so a
 * maintainer iterating in a clone isn't prompted on every invocation. It is
 * opt-in only and never bypasses the end-user hard refusal.
 */
export async function protectedConfirm(
  deps: ConfirmDeps,
  args: ConfirmArgs,
): Promise<ConfirmResult> {
  if (process.env.SMITH_CLONE_CONFIRM_ALL === "1") {
    return { confirmed: true };
  }
  deps.log(pc.yellow(`[clone-mode] You're running smith from ${args.repoRoot}.`));
  deps.log(
    `${args.verb} on protected entity "${args.entity}" mutates source files in this clone, ` +
      `not just the rendered output. Continue?`,
  );
  const answer = (await deps.prompt("Proceed? [y/N] ")).trim().toLowerCase();
  return { confirmed: answer === "y" || answer === "yes" };
}

/**
 * Shared CLI guard for a protected agent mutation. On an end-user (npm)
 * machine, throws `protected-bundle`. In clone mode, prompts for confirmation
 * and throws `user-aborted` on decline. No-op when `name` is not protected.
 *
 * `confirmFn` lets callers inject their own prompt (tests, or a command that
 * already owns a prompt seam); defaults to `readToken`.
 */
export async function guardProtectedAgent(
  name: string,
  verb: ProtectedVerb,
  confirmFn?: (question: string) => Promise<string>,
): Promise<void> {
  if (!isProtectedAgent(name)) return;
  if (isLocalSmithClone()) {
    const repoRoot = cloneRepoRoot() ?? "<repo>";
    const r = await protectedConfirm(
      { prompt: confirmFn ?? readToken, log: (l) => console.log(l), errLog: (l) => console.error(l) },
      { entity: name, verb, repoRoot },
    );
    if (!r.confirmed) throw new SmithError({ code: "user-aborted", what: verb.replace(".", " ") });
    return;
  }
  throw new SmithError({
    code: "protected-bundle",
    message: refusalMessage({ entity: name, kind: "agent", verb }),
  });
}

/**
 * Shared CLI guard for a protected (bundled) skill mutation. Same shape as
 * {@link guardProtectedAgent} but keyed on the skill list and reporting
 * `kind: "skill"`.
 */
export async function guardProtectedSkill(
  name: string,
  verb: ProtectedVerb,
  confirmFn?: (question: string) => Promise<string>,
): Promise<void> {
  if (!isProtectedSkill(name)) return;
  if (isLocalSmithClone()) {
    const repoRoot = cloneRepoRoot() ?? "<repo>";
    const r = await protectedConfirm(
      { prompt: confirmFn ?? readToken, log: (l) => console.log(l), errLog: (l) => console.error(l) },
      { entity: name, verb, repoRoot },
    );
    if (!r.confirmed) {
      throw new SmithError({ code: "user-aborted", what: `skill ${verb.replace(".", " ")}` });
    }
    return;
  }
  throw new SmithError({
    code: "protected-bundle",
    message: refusalMessage({ entity: name, kind: "skill", verb }),
  });
}
