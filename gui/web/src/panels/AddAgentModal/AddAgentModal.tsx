import type { JobRequest } from "gui-shared";
import { useEffect, useRef, useState } from "react";
import { classifySource, type SourceKind } from "./classifySource";
import { useDebounced } from "@/lib/use-debounced";
import { AgentCreateWizard } from "@/panels/AgentCreateWizard";
import { InstallExistingForm } from "@/panels/InstallExistingForm";
import { CatalogRegisterForm } from "@/panels/CatalogRegisterForm";

type View = "menu" | "template" | "install" | "register";

const BADGE_LABEL: Record<SourceKind, string> = {
  archive: "[archive]",
  directory: "[local directory]",
  "git-url": "[git url]",
  unknown: "",
};

interface Props {
  open: boolean;
  onClose: () => void;
  onDispatch: (req: JobRequest) => void;
  onAgentCreated?: (name: string) => void;
  initialView?: View;
  initialRegistry?: "agent" | "skill";
  lockedView?: boolean;
}

export function AddAgentModal({ open, onClose, onDispatch, onAgentCreated, initialView, initialRegistry, lockedView }: Props) {

  const [view, setView] = useState<View>(initialView ?? "menu");
  const [smartInput, setSmartInput] = useState("");
  const prevFocusRef = useRef<Element | null>(null);

  useEffect(() => {
    if (open) {
      prevFocusRef.current = document.activeElement;
    }
  }, [open]);

  useEffect(() => {
    if (!open && prevFocusRef.current instanceof HTMLElement) {
      prevFocusRef.current.focus();
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    if (open) {
      setView(initialView ?? "menu");
      setSmartInput("");
    }
  }, [open, initialView]);

  const debouncedInput = useDebounced(smartInput, 400);
  const liveKind = classifySource(smartInput);

  useEffect(() => {
    if (view !== "menu") return;
    if (debouncedInput.trim() === "") return;
    if (smartInput.trim() === "") return;
    if (classifySource(debouncedInput) !== "unknown") {
      setView("install");
    }
  }, [debouncedInput, view, smartInput]);

  if (!open) return null;

  function handleBack() {
    setView("menu");
    setSmartInput("");
  }

  const isSubForm = view !== "menu";
  const titleId = "add-agent-modal-title";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
      onClick={onClose}
    >
      <div
        className="border border-matrix-green bg-black p-6 w-[40rem] max-w-[92vw] font-mono max-h-[80vh] overflow-y-auto min-h-[28rem]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            {isSubForm && !lockedView && (
              <button
                type="button"
                aria-label="back"
                onClick={handleBack}
                className="text-matrix-green-muted hover:text-matrix-green text-xs font-mono"
              >
                {"<- back"}
              </button>
            )}
            <h2 id={titleId} className="text-matrix-green text-sm uppercase tracking-widest">
              {view === "menu" ? "// add agent" :
               view === "template" ? "// start from template" :
               view === "install" ? "// install existing agent(s)" :
               "// register catalog"}
            </h2>
          </div>
          <button
            type="button"
            aria-label="close"
            onClick={onClose}
            className="text-matrix-green-muted hover:text-matrix-green text-sm"
          >
            x
          </button>
        </div>

        {view === "menu" && (
          <div className="flex flex-col gap-4">
            <div>
              <label className="block font-mono text-[10px] uppercase tracking-widest text-matrix-green-muted mb-1">
                paste a URL, file path, or archive…
              </label>
              <input
                type="text"
                autoFocus
                value={smartInput}
                onChange={(e) => setSmartInput(e.target.value)}
                placeholder="git@github.com:acme/team-agents.git"
                className="w-full bg-black border border-matrix-line px-2 py-1 font-mono text-sm text-matrix-body focus:outline-none focus:border-matrix-green"
              />
              {liveKind !== "unknown" && (
                <span className="block mt-1 font-mono text-[10px] text-matrix-green-muted">
                  {BADGE_LABEL[liveKind]} · auto-jumping to install…
                </span>
              )}
            </div>

            <div className="flex items-center gap-2 text-[10px] font-mono text-matrix-line">
              <div className="flex-1 h-px bg-matrix-line" />
              or pick a starting point
              <div className="flex-1 h-px bg-matrix-line" />
            </div>

            <div className="grid grid-cols-3 gap-3">
              {[
                { view: "template" as View, label: "Start from template", description: "Scaffold a brand-new agent." },
                { view: "install" as View, label: "Install existing", description: "Pull a prebuilt agent from git, tgz, or local." },
                { view: "register" as View, label: "Register catalog", description: "Add a git repo or local dir full of agents." },
              ].map((card) => (
                <button
                  key={card.view}
                  type="button"
                  onClick={() => setView(card.view)}
                  className="text-left p-3 border border-matrix-line text-xs font-mono text-matrix-body hover:border-matrix-green hover:text-matrix-green transition-colors"
                >
                  <div className="font-semibold mb-1">{card.label}</div>
                  <div className="text-matrix-green-muted text-[10px] leading-snug">{card.description}</div>
                </button>
              ))}
            </div>
          </div>
        )}

        {view === "template" && (
          <AgentCreateWizard
            onDispatch={onDispatch}
            onSuccess={(name) => { onClose(); onAgentCreated?.(name); }}
          />
        )}
        {view === "install" && (
          <InstallExistingForm
            kind="agent"
            open={true}
            embedded
            onClose={onClose}
            onDispatch={onDispatch}
            {...(liveKind !== "unknown" ? { initialUrl: smartInput } : {})}
          />
        )}
        {view === "register" && (
          <CatalogRegisterForm
            onDispatch={onDispatch}
            onClose={onClose}
            {...(initialRegistry ? { initialRegistry } : {})}
          />
        )}
      </div>
    </div>
  );
}
