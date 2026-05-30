import { createInterface } from "node:readline/promises";

/**
 * Read a single line from the user, with the given prompt prefix.
 * Returns the trimmed answer.
 *
 * Tests should NOT call this directly — they should inject their own
 * `(prompt) => Promise<string>` via the relevant command's options bag.
 * This default exists so the production CLI doesn't need to wire readline
 * itself in every command file.
 */
export async function readToken(prompt: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(prompt)).trim();
  } finally {
    rl.close();
  }
}

export type ConsentChoice = "yes" | "no" | "details";

export interface ConsentReader {
  read: () => Promise<string>;
}

/** Read a yes/no/details consent reply. Repeats on invalid input.
 *  Empty (just pressing enter) accepts the default ("yes"). */
export async function readConsentChoice(
  reader: ConsentReader,
): Promise<ConsentChoice> {
  while (true) {
    const raw = (await reader.read()).trim().toLowerCase();
    if (raw === "" || raw === "y" || raw === "yes") return "yes";
    if (raw === "n" || raw === "no") return "no";
    if (raw === "d" || raw === "details") return "details";
    // Loop: caller's `read` function is expected to re-prompt visually.
  }
}
