import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "ghost" | "danger";

const variants: Record<Variant, string> = {
  primary: "border-matrix-green text-matrix-green hover:shadow-matrix-glow",
  ghost: "border-matrix-line text-matrix-body hover:border-matrix-green-muted",
  danger: "border-matrix-red text-matrix-red hover:shadow-[0_0_12px_rgba(255,56,56,0.5)]",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
}

export function Button({ variant = "primary", className = "", ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      className={`px-3 py-1.5 border bg-transparent font-mono uppercase tracking-wider text-xs transition-shadow focus:outline-none focus:shadow-matrix-focus ${variants[variant]} ${className}`}
      {...rest}
    />
  );
}
