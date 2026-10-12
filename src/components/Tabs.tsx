"use client";

import { useState, type ReactNode } from "react";

export interface Tab {
  /** Tab key. `value` is accepted as an alias. */
  id?: string;
  value?: string;
  label: string;
  /** Optional panel content. Tabs may be used as pure navigation. */
  content?: ReactNode;
}

interface Props {
  tabs: Tab[];
  /** Uncontrolled initial selection (tab key). */
  initial?: string;
  /** Controlled mode: selected tab key. */
  value?: string;
  /** Controlled mode: called with the tab key on selection. */
  onChange?: (key: string) => void;
}

function tabKey(t: Tab): string {
  return t.id ?? t.value ?? t.label;
}

export function Tabs({ tabs, initial, value, onChange }: Props) {
  const [internal, setInternal] = useState(initial ?? tabKey(tabs[0] ?? { label: "" }));
  const controlled = value !== undefined;
  const active = controlled ? value : internal;

  const select = (key: string) => {
    if (controlled) {
      onChange?.(key);
    } else {
      setInternal(key);
      onChange?.(key);
    }
  };

  return (
    <div>
      <div role="tablist" className="flex gap-1 border-b border-zinc-200 dark:border-zinc-800">
        {tabs.map((t) => {
          const key = tabKey(t);
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={active === key}
              onClick={() => select(key)}
              className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors cursor-pointer ${
                active === key
                  ? "border-zinc-900 text-zinc-900 dark:border-zinc-100 dark:text-zinc-100"
                  : "border-transparent text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </div>
      <div role="tabpanel" className="pt-4">
        {tabs.find((t) => tabKey(t) === active)?.content}
      </div>
    </div>
  );
}
