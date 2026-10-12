import type { ReactNode } from "react";

type Tone = "green" | "red" | "amber" | "blue" | "orange" | "gray";

/** Backwards-compatible alias used by some pages. */
type Variant = "success" | "danger" | "warning" | "info" | "neutral";

const variantToTone: Record<Variant, Tone> = {
  success: "green",
  danger: "red",
  warning: "amber",
  info: "blue",
  neutral: "gray",
};

const tones: Record<Tone, string> = {
  green:
    "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300 border-green-200 dark:border-green-900",
  red: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300 border-red-200 dark:border-red-900",
  amber:
    "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 border-amber-200 dark:border-amber-900",
  blue: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300 border-blue-200 dark:border-blue-900",
  orange:
    "bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300 border-orange-200 dark:border-orange-900",
  gray: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 border-zinc-200 dark:border-zinc-700",
};

interface Props {
  tone?: Tone;
  /** Alias for tone. */
  variant?: Variant;
  children: ReactNode;
  className?: string;
}

export function Badge({ tone, variant, children, className = "" }: Props) {
  const resolved: Tone = tone ?? (variant ? variantToTone[variant] : "gray");
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${tones[resolved]} ${className}`}
    >
      {children}
    </span>
  );
}
