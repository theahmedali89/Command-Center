"use client";

import { useId, type SelectHTMLAttributes } from "react";

export interface SelectOption {
  label: string;
  value: string;
}

interface Props extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  id?: string;
  /** Render <option> children from data instead of passing children. */
  options?: SelectOption[];
}

export function Select({
  label,
  error,
  id,
  className = "",
  children,
  options,
  ...rest
}: Props) {
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label htmlFor={inputId} className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          {label}
        </label>
      )}
      <select
        id={inputId}
        {...rest}
        className={`h-10 rounded-lg border border-zinc-300 bg-white px-3 text-sm outline-none transition-colors focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 ${
          error ? "border-red-500" : ""
        } ${className}`}
      >
        {options
          ? options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))
          : children}
      </select>
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
