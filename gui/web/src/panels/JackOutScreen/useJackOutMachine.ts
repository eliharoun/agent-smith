import { useCallback, useEffect, useReducer, useRef } from "react";
import { jobsApi } from "@/api/jobs";

export type Stage = "warning" | "confirming" | "running" | "succeeded" | "failed";

export type State = {
  stage: Stage;
  jobId: string | null;
  sawStdout: boolean;
  errorMessage: string | null;
};

export type Action =
  | { type: "confirm" }
  | { type: "cancel" }
  | { type: "spawned"; jobId: string }
  | { type: "stdout" }
  | { type: "exit"; code: number }
  | { type: "disconnect" }
  | { type: "fail"; message: string };

/**
 * Pure reducer for the jack-out screen state machine.
 *
 * Notable transitions:
 * - `disconnect` while `running` is treated as success ONLY when stdout was
 *   already observed — jack-out kills the GUI server mid-stream, so a
 *   disconnect after the CLI started writing means the destructive work
 *   ran. A disconnect with no prior stdout indicates an early
 *   server/auth/network failure and stays `running` (caller can layer a
 *   timeout if desired).
 * - `exit code 0` → `succeeded`; non-zero → `failed`.
 * - `fail` is an escape hatch (e.g. dry-run fetch failed) and is accepted
 *   from any stage.
 *
 * Exported for direct unit-testing — see `useJackOutMachine.test.ts`.
 */
export function reducer(s: State, a: Action): State {
  switch (a.type) {
    case "confirm":
      return s.stage === "warning" ? { ...s, stage: "confirming" } : s;
    case "cancel":
      return s.stage === "confirming" ? { ...s, stage: "warning" } : s;
    case "spawned":
      return { ...s, stage: "running", jobId: a.jobId, sawStdout: false };
    case "stdout":
      return s.stage === "running" ? { ...s, sawStdout: true } : s;
    case "exit":
      if (s.stage !== "running") return s;
      return a.code === 0
        ? { ...s, stage: "succeeded" }
        : { ...s, stage: "failed", errorMessage: `exit code ${a.code}` };
    case "disconnect":
      if (s.stage === "running" && s.sawStdout) return { ...s, stage: "succeeded" };
      return s;
    case "fail":
      return { ...s, stage: "failed", errorMessage: a.message };
    default:
      return s;
  }
}

const INITIAL: State = { stage: "warning", jobId: null, sawStdout: false, errorMessage: null };

export function useJackOutMachine() {
  const [state, dispatch] = useReducer(reducer, INITIAL);
  const esRef = useRef<EventSource | null>(null);
  const linesRef = useRef<string[]>([]);

  const subscribe = useCallback((jobId: string, onLine?: (text: string) => void) => {
    const es = new EventSource(jobsApi.streamUrl(jobId));
    esRef.current = es;
    const handleData = (e: MessageEvent) => {
      const text = String(e.data ?? "");
      linesRef.current.push(text);
      if (onLine) onLine(text);
      dispatch({ type: "stdout" });
    };
    es.addEventListener("stdout", handleData);
    es.addEventListener("stderr", handleData);
    es.addEventListener("exit", (e: MessageEvent) => {
      try {
        const parsed = JSON.parse(String(e.data)) as { code: number };
        dispatch({ type: "exit", code: parsed.code });
      } catch {
        dispatch({ type: "exit", code: 1 });
      }
    });
    es.onerror = () => dispatch({ type: "disconnect" });
  }, []);

  useEffect(
    () => () => {
      esRef.current?.close();
    },
    [],
  );

  return { state, dispatch, subscribe };
}
