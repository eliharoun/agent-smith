import {
  Children,
  cloneElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

/**
 * Generic ARIA-compliant tooltip popover.
 *
 * Behavior:
 *   - Wraps a single trigger element (`children`). Adds hover/focus listeners
 *     to it and an `aria-describedby` pointing at the tooltip body.
 *   - Opens on `mouseenter` or `focusin`, closes on `mouseleave`/`focusout`,
 *     `Escape`, or `mousedown` outside both the trigger and the popover.
 *   - Tooltip body is rendered into a `document.body` portal (mirroring
 *     `JobOutputDrawer`) so a modal's `overflow:hidden` can't clip it.
 *   - Auto-position: prefers `top`; falls back to `bottom` if there's no room.
 *     `position` prop forces a side. The naive logic measures the trigger's
 *     bounding rect on open — no positioning library required.
 *
 * Style: matrix palette (`bg-black border border-matrix-green
 * text-matrix-green text-xs`). A small triangle pointer is drawn with two
 * absolutely-positioned divs.
 */

export interface TooltipProps {
  /** Tooltip body — string or ReactNode. */
  content: ReactNode;
  /** Single trigger element to attach the tooltip to. */
  children: ReactElement;
  /** Side preference. Defaults to "auto" (top, fall back to bottom). */
  position?: "auto" | "top" | "bottom";
  /** Optional explicit id; otherwise auto-generated for a11y wiring. */
  id?: string;
}

type Placement = "top" | "bottom";

interface Coords {
  top: number;
  left: number;
  placement: Placement;
}

const TOOLTIP_OFFSET = 6; // px between trigger and tooltip
const SAFE_MARGIN = 4; // viewport edge padding

export function Tooltip({ content, children, position = "auto", id }: TooltipProps) {
  const generatedId = useId();
  const tooltipId = id ?? `tooltip-${generatedId}`;
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<Coords | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);

  // Recompute position when opened. Re-measure on scroll/resize so the popover
  // tracks the trigger if the layout shifts.
  useLayoutEffect(() => {
    if (!open) return;
    const measure = () => {
      const triggerEl = triggerRef.current;
      const tooltipEl = tooltipRef.current;
      if (!triggerEl || !tooltipEl) return;
      const tr = triggerEl.getBoundingClientRect();
      const th = tooltipEl.offsetHeight;
      const tw = tooltipEl.offsetWidth;
      const vh = window.innerHeight;
      const vw = window.innerWidth;

      let placement: Placement;
      if (position === "top") placement = "top";
      else if (position === "bottom") placement = "bottom";
      else {
        // auto: prefer top if there's room, else bottom.
        const roomAbove = tr.top;
        const roomBelow = vh - tr.bottom;
        placement = roomAbove >= th + TOOLTIP_OFFSET || roomAbove >= roomBelow ? "top" : "bottom";
      }

      const top = placement === "top" ? tr.top - th - TOOLTIP_OFFSET : tr.bottom + TOOLTIP_OFFSET;
      let left = tr.left + tr.width / 2 - tw / 2;
      // Clamp horizontally inside the viewport.
      left = Math.max(SAFE_MARGIN, Math.min(left, vw - tw - SAFE_MARGIN));
      setCoords({ top, left, placement });
    };
    measure();
    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
    };
  }, [open, position]);

  // Esc + outside-click while open. Listen on the document so portal-rendered
  // tooltips don't accidentally count as "outside".
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onMouseDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t)) return;
      if (tooltipRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onMouseDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onMouseDown);
    };
  }, [open]);

  // Clone the trigger to inject ref, ARIA, and event handlers — non-invasive,
  // matches the pattern used by Headless UI.
  const child = Children.only(children);
  if (!isValidElement(child)) {
    throw new Error("Tooltip: children must be a single React element");
  }
  type TriggerProps = {
    ref?: (el: HTMLElement | null) => void;
    onMouseEnter?: (e: React.MouseEvent) => void;
    onMouseLeave?: (e: React.MouseEvent) => void;
    onFocus?: (e: React.FocusEvent) => void;
    onBlur?: (e: React.FocusEvent) => void;
    "aria-describedby"?: string | undefined;
  };
  const childProps = (child.props ?? {}) as TriggerProps;
  const trigger = cloneElement(child as ReactElement<TriggerProps>, {
    ref: (el: HTMLElement | null) => {
      triggerRef.current = el;
    },
    onMouseEnter: (e: React.MouseEvent) => {
      childProps.onMouseEnter?.(e);
      setOpen(true);
    },
    onMouseLeave: (e: React.MouseEvent) => {
      childProps.onMouseLeave?.(e);
      setOpen(false);
    },
    onFocus: (e: React.FocusEvent) => {
      childProps.onFocus?.(e);
      setOpen(true);
    },
    onBlur: (e: React.FocusEvent) => {
      childProps.onBlur?.(e);
      setOpen(false);
    },
    "aria-describedby": open ? tooltipId : childProps["aria-describedby"],
  });

  return (
    <>
      {trigger}
      {open &&
        createPortal(
          <div
            id={tooltipId}
            ref={tooltipRef}
            role="tooltip"
            aria-live="polite"
            // Coords are measured in a useLayoutEffect — until they're set on
            // the first paint the tooltip is rendered off-screen to allow
            // measurement without flicker.
            style={{
              position: "fixed",
              top: coords?.top ?? -9999,
              left: coords?.left ?? -9999,
              zIndex: 60,
              pointerEvents: "auto",
            }}
            className="bg-black border border-matrix-green text-matrix-green font-mono text-xs px-2 py-1 max-w-xs whitespace-pre-line shadow-matrix-glow"
          >
            {content}
            {/* Pointer triangle. Two stacked divs: outer = border color,
                inner offset by 1px = bg color, creating a bordered arrow. */}
            <span
              aria-hidden="true"
              className="absolute left-1/2 -translate-x-1/2 w-0 h-0 border-x-4 border-x-transparent"
              style={
                coords?.placement === "bottom"
                  ? { top: -4, borderBottom: "4px solid var(--matrix-green, #1aff8c)" }
                  : { bottom: -4, borderTop: "4px solid var(--matrix-green, #1aff8c)" }
              }
            />
          </div>,
          document.body,
        )}
    </>
  );
}
