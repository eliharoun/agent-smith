import type { JobRequest } from "gui-shared";
import { useEffect, useRef, useState } from "react";
import { classifySkillSource, type SkillSourceKind } from "./classifySkillSource";
import { useDebounced } from "@/lib/use-debounced";
import { FieldHelp } from "@/ui/FieldHelp";
import { InstallExistingForm } from "@/panels/InstallExistingForm";
import { CatalogRegisterForm } from "@/panels/CatalogRegisterForm";

type View = "menu" | "install" | "register";

const BADGE_LABEL: Record<SkillSourceKind, string> = {
  archive: "[archive]",
  directory: "[local directory]",
  "git-url": "[git url]",
  "catalog-ref": "[catalog ref]",
  unknown: "",
};

const BADGE_SUFFIX: Record<SkillSourceKind, string> = {
  archive: "· auto-jumping to install…",
  directory: "· auto-jumping to install…",
  "git-url": "· auto-jumping to install…",
  "catalog-ref": "· install by reference…",
  unknown: "",
};

interface Props {
  open: boolean;
  onClose: () => void;
  onDispatch: (req: JobRequest) => void;
  initialView?: View;
}

export function AddSkillModal({ open, onClose, onDispatch, initialView }: Props) {
  const [view, setView] = useState<View>(initialView ?? "menu");
  const [smartInput, setSmartInput] = useState("");
  const [refInput, setRefInput] = useState("");
  const prevFocusRef = useRef<Element | null>(null);

  // Capture focus before opening for restoration on close.
  useEffect(() => {
    if (open) {
      prevFocusRef.current = document.activeElement;
    }
  }, [open]);

  // Restore focus when modal closes.
  useEffect(() => {
    if (!open && prevFocusRef.current instanceof HTMLElement) {
      prevFocusRef.current.focus();
    }
  }, [open]);

  // Escape key handler.
  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  // Reset state when opening / re-opening.
  useEffect(() => {
    if (open) {
      setView(initialView ?? "menu");
      setSmartInput("");
      setRefInput("");
    }
  }, [open, initialView]);

  const debouncedInput = useDebounced(smartInput, 400);
  const liveKind = classifySkillSource(smartInput);

  // Debounced bypass: auto-jump to install view for any recognized source kind.
  useEffect(() => {
    if (view !== "menu") return;
    if (debouncedInput.trim() === "") return;
    if (smartInput.trim() === "") return;
    const kind = classifySkillSource(debouncedInput);
    if (kind !== "unknown") {
      if (kind === "catalog-ref") {
        setRefInput(debouncedInput.trim());
      }
      setView("install");
    }
  }, [debouncedInput, view, smartInput]);

  if (!open) return null;

  function handleBack() {
    setView("menu");
    setSmartInput("");
    setRefInput("");
  }

  const isSubForm = view !== "menu";
  const titleId = "add-skill-modal-title";

  // When auto-bypassed to install view via a source kind (not catalog-ref),
  // pass the smart input value as initialUrl to InstallExistingForm.
  const installInitialUrl =
    liveKind !== "unknown" && liveKind !== "catalog-ref" ? smartInput : undefined;

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
            {isSubForm && (
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
              {view === "menu"
                ? "// add skill"
                : view === "install"
                  ? "// install existing skill(s)"
                  : "// register catalog"}
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
              <div className="mb-1">
                <FieldHelp fieldId="install.skillSmartInput" htmlFor="add-skill-smart-input">
                  paste a URL, file path, archive, or catalog/name…
                </FieldHelp>
              </div>
              <input
                id="add-skill-smart-input"
                type="text"
                autoFocus
                value={smartInput}
                onChange={(e) => setSmartInput(e.target.value)}
                placeholder="default/tdd  ·  https://github.com/acme/skills  ·  ~/my-skills  ·  bundle.tgz"
                className="w-full bg-black border border-matrix-line px-2 py-1 font-mono text-sm text-matrix-body focus:outline-none focus:border-matrix-green"
              />
              {liveKind !== "unknown" && (
                <span className="block mt-1 font-mono text-[10px] text-matrix-green-muted">
                  {BADGE_LABEL[liveKind]} {BADGE_SUFFIX[liveKind]}
                </span>
              )}
            </div>

            <div className="flex items-center gap-2 text-[10px] font-mono text-matrix-line">
              <div className="flex-1 h-px bg-matrix-line" />
              or pick a starting point
              <div className="flex-1 h-px bg-matrix-line" />
            </div>

            <div className="grid grid-cols-2 gap-3">
              {[
                {
                  view: "install" as View,
                  label: "Install existing",
                  description:
                    "Pull a skill from a git repo, archive, local dir, or catalog/name ref.",
                },
                {
                  view: "register" as View,
                  label: "Register catalog",
                  description: "Add a folder or git repo full of skills to your registry.",
                },
              ].map((card) => (
                <button
                  key={card.view}
                  type="button"
                  onClick={() => setView(card.view)}
                  className="text-left p-3 border border-matrix-line text-xs font-mono text-matrix-body hover:border-matrix-green hover:text-matrix-green transition-colors"
                >
                  <div className="font-semibold mb-1">{card.label}</div>
                  <div className="text-matrix-green-muted text-[10px] leading-snug">
                    {card.description}
                  </div>
                </button>
              ))}
            </div>

            {/* Subdued 2-card explainer note */}
            <p className="font-mono text-[10px] text-matrix-green-muted">
              // skills are authored externally — write a SKILL.md, then install or register.
            </p>
          </div>
        )}

        {view === "install" && (
          <>
            {/* Context-sensitive install view:
                - catalog-ref bypass → show ONLY the ref field (suppress InstallExistingForm)
                - URL/archive/dir bypass → show ONLY InstallExistingForm (suppress ref field)
                - Manual card click (liveKind unknown) → show InstallExistingForm + ref field
                  collapsed under a <details> disclosure */}
            {liveKind === "catalog-ref" ? (
              /* Entered via catalog-ref bypass: ref field only */
              <div className="flex flex-col gap-4">
                <div>
                  <label className="block font-mono text-[10px] uppercase tracking-widest text-matrix-green-muted mb-1">
                    install by reference (catalog/name)
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={refInput}
                      onChange={(e) => setRefInput(e.target.value)}
                      placeholder="default/tdd"
                      className="flex-1 bg-black border border-matrix-line px-2 py-1 font-mono text-sm text-matrix-body focus:outline-none focus:border-matrix-green"
                    />
                    <button
                      type="button"
                      disabled={!refInput.trim()}
                      onClick={() => {
                        if (!refInput.trim()) return;
                        onDispatch({
                          command: "skill.install",
                          name: refInput.trim(),
                          targets: [],
                        });
                        onClose();
                      }}
                      className="px-3 py-1 border border-matrix-line font-mono text-xs text-matrix-body hover:border-matrix-green hover:text-matrix-green disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      install
                    </button>
                  </div>
                  <span className="block mt-1 font-mono text-[10px] text-matrix-green-muted">
                    e.g. default/tdd — installs the named skill from the matching registered catalog
                  </span>
                </div>
              </div>
            ) : liveKind !== "unknown" ? (
              /* Entered via URL/archive/dir bypass: InstallExistingForm only */
              <InstallExistingForm
                kind="skill"
                open={true}
                embedded
                onClose={onClose}
                onDispatch={onDispatch}
                {...(installInitialUrl !== undefined ? { initialUrl: installInitialUrl } : {})}
              />
            ) : (
              /* Manual card click: InstallExistingForm + collapsed ref disclosure */
              <div className="flex flex-col gap-4">
                <InstallExistingForm
                  kind="skill"
                  open={true}
                  embedded
                  onClose={onClose}
                  onDispatch={onDispatch}
                />

                <details className="font-mono text-xs text-matrix-green-muted">
                  <summary className="cursor-pointer hover:text-matrix-green select-none">
                    // install by reference ▾
                  </summary>
                  <div className="mt-2 flex flex-col gap-2">
                    <label className="block text-[10px] uppercase tracking-widest text-matrix-green-muted">
                      install by reference (catalog/name)
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={refInput}
                        onChange={(e) => setRefInput(e.target.value)}
                        placeholder="default/tdd"
                        className="flex-1 bg-black border border-matrix-line px-2 py-1 font-mono text-sm text-matrix-body focus:outline-none focus:border-matrix-green"
                      />
                      <button
                        type="button"
                        disabled={!refInput.trim()}
                        onClick={() => {
                          if (!refInput.trim()) return;
                          onDispatch({
                            command: "skill.install",
                            name: refInput.trim(),
                            targets: [],
                          });
                          onClose();
                        }}
                        className="px-3 py-1 border border-matrix-line font-mono text-xs text-matrix-body hover:border-matrix-green hover:text-matrix-green disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        install
                      </button>
                    </div>
                    <span className="font-mono text-[10px] text-matrix-green-muted">
                      e.g. default/tdd — installs the named skill from the matching registered catalog
                    </span>
                  </div>
                </details>
              </div>
            )}
          </>
        )}

        {view === "register" && (
          <CatalogRegisterForm
            initialRegistry="skill"
            lockRegistry
            onDispatch={onDispatch}
            onClose={onClose}
          />
        )}
      </div>
    </div>
  );
}
