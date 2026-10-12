import type { ReactNode } from "react";

interface Props {
  icon?: ReactNode;
  title: string;
  hint?: string;
  /** Alias for hint. */
  description?: string;
  action?: ReactNode;
}

export function EmptyState({ icon, title, hint, description, action }: Props) {
  const text = hint ?? description;
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-zinc-300 px-6 py-12 text-center dark:border-zinc-700">
      {icon && <div className="mb-1 text-3xl text-zinc-400 dark:text-zinc-500">{icon}</div>}
      <p className="font-medium">{title}</p>
      {text && <p className="max-w-sm text-sm text-zinc-500 dark:text-zinc-400">{text}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
