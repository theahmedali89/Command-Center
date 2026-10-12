interface Props {
  lines?: number;
  className?: string;
}

export function Skeleton({ lines = 3, className = "" }: Props) {
  return (
    <div aria-busy="true" aria-label="Loading" className={`flex flex-col gap-2 ${className}`}>
      {Array.from({ length: lines }, (_, i) => (
        <div
          key={i}
          className="h-4 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800"
          style={{ width: `${100 - i * 12}%` }}
        />
      ))}
    </div>
  );
}
