import { smithBinaryPath } from "./smith-binary";

export interface SmithRun { stdout: string; stderr: string; code: number; }

/** Spawn the smith CLI and capture stdout/stderr. Injectable for tests. */
export async function runSmith(args: string[]): Promise<SmithRun> {
  const proc = Bun.spawn([smithBinaryPath(), ...args], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  await proc.exited;
  return { stdout, stderr, code: proc.exitCode ?? 1 };
}
