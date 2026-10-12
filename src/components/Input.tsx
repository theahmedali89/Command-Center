"use client";

import { useId, type InputHTMLAttributes } from "react";

interface Props extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  id?: string;
}

export function Input({ label, error, id, className = "", ...rest }: Props) {
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label htmlFor={inputId} className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          {label}
        </label>
      )}
      <input
        id={inputId}
        {...rest}
        className={`h-10 rounded-lg border bg-white px-3 text-sm outline-none transition-colors placeholder:text-zinc-400 focus:border-zinc-500 dark:bg-zinc-900 dark:placeholder:text-zinc-500 ${
          error ? "border-red-500" : "border-zinc-300 dark:border-zinc-700"
        } ${className}`}
      />
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
