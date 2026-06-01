import type { HTMLAttributes, ReactNode } from "react";
import { getFieldHelp } from "@/help";
import { Tooltip } from "./Tooltip";

/**
 * Pairs a field label with an info icon (`ⓘ`) that opens a tooltip explaining
 * what the field does. Help text is looked up in the central registry by
 * `fieldId` (e.g. `knowledge.delivery`).
 *
 * If the registry has no entry for the id we render the label alone — adding a
 * new field never crashes the UI.
 *
 * Keep the rendered label compatible with the existing `<FormField>` /
 * `<Select>` matrix-themed styles: a `font-mono`, `uppercase`, `text-[10px]`
 * label preceded by `// `.
 */

export interface FieldHelpProps extends Omit<HTMLAttributes<HTMLSpanElement>, "children"> {
  /** Canonical field id, e.g. `knowledge.delivery`. */
  fieldId: string;
  /** Visible label content. Plain string in the common case. */
  children: ReactNode;
  /** `htmlFor` propagated to the inner <label>. */
  htmlFor?: string;
  /**
   * When `true`, renders just the info icon (no `// label` prefix). Useful
   * when the field already has its own visible label nearby (e.g. a checkbox
   * that owns its label/input pair).
   */
  iconOnly?: boolean;
}

export function FieldHelp({
  fieldId,
  children,
  className = "",
  htmlFor,
  iconOnly,
  ...rest
}: FieldHelpProps) {
  const entry = getFieldHelp(fieldId);
  // Wrapper class mirrors the label classes used by FormField/Select so the
  // matrix-themed look is preserved. Callers can override via className.
  const baseClass =
    "font-mono text-[10px] uppercase tracking-widest text-matrix-green-muted inline-flex items-center gap-1";
  // The icon trigger is rendered as a SIBLING of the <label>, not a child:
  // a button nested inside a labelling element gets associated with the
  // labelled control by the accessibility tree, which would make
  // `getByLabelText` (and screen readers) treat the icon as part of the
  // input's name. Rendering side-by-side keeps the help button independent.
  const labelText = !iconOnly ? <>// {children}</> : <span className="sr-only">{children}</span>;
  const ariaName = `help: ${typeof children === "string" ? children : fieldId}`;
  return (
    <span className={`${baseClass} ${className}`.trim()} {...rest}>
      <label htmlFor={htmlFor} className="cursor-pointer">
        {labelText}
      </label>
      {entry && (
        <Tooltip content={entry.help}>
          <button
            type="button"
            // The label-aria-name is "help: <field>" so screen readers announce
            // the trigger distinctly from the field's own label.
            aria-label={ariaName}
            // Don't toggle on click — hover/focus already opens via Tooltip.
            // Click is a no-op so a tap on touch devices still focuses (which
            // opens the tooltip), and so a parent form is never submitted.
            onClick={(e) => e.preventDefault()}
            className="text-matrix-green-muted hover:text-matrix-green focus:outline-none focus:text-matrix-green w-3.5 h-3.5 inline-flex items-center justify-center leading-none"
          >
            {/* Outlined `i` glyph; sized to match the label x-height. */}
            <svg
              width="12"
              height="12"
              viewBox="0 0 12 12"
              fill="none"
              stroke="currentColor"
              strokeWidth="1"
              aria-hidden="true"
            >
              <circle cx="6" cy="6" r="5" />
              <line x1="6" y1="5" x2="6" y2="9" />
              <circle cx="6" cy="3.25" r="0.5" fill="currentColor" stroke="none" />
            </svg>
          </button>
        </Tooltip>
      )}
    </span>
  );
}
