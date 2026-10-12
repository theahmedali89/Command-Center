"use client";

import { useEffect, useState } from "react";

const STORAGE_KEY = "cc-theme";

function initialDark(): boolean | null {
  if (typeof window === "undefined") return null;
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored !== null
    ? stored === "dark"
    : window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function ThemeToggle() {
  // Lazy initializer reads localStorage during render — no setState-in-effect.
  const [dark, setDark] = useState<boolean | null>(initialDark);

  useEffect(() => {
    if (dark !== null) {
      document.documentElement.classList.toggle("dark", dark);
    }
  }, [dark]);

  function toggle() {
    const next = !(dark ?? false);
    setDark(next);
    localStorage.setItem(STORAGE_KEY, next ? "dark" : "light");
    document.documentElement.classList.toggle("dark", next);
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      className="rounded-lg p-2 text-lg leading-none hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
    >
      <span aria-hidden>{dark === null ? "◐" : dark ? "☀" : "☾"}</span>
    </button>
  );
}
