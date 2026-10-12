"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/Button";
import { useToast } from "@/components/Toast";

interface Board {
  id: string;
  name: string;
  privacy: string;
}

/**
 * Pinterest default-board picker. Shown on the Pinterest account card once
 * connected. Pins publish to the selected board.
 */
export function PinterestBoardPicker() {
  const toast = useToast();
  const [boards, setBoards] = useState<Board[]>([]);
  const [selected, setSelected] = useState("");
  const [currentName, setCurrentName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/accounts/pinterest/boards");
        const body = (await res.json()) as {
          ok: boolean;
          data?: {
            boards: Board[];
            selectedBoardId: string | null;
            selectedBoardName: string | null;
          };
          message?: string;
        };
        if (cancelled) return;
        if (body.ok && body.data) {
          setBoards(body.data.boards);
          setSelected(body.data.selectedBoardId ?? "");
          setCurrentName(body.data.selectedBoardName);
        }
      } catch {
        // Leave the picker empty; the error surfaces on save attempt.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function save() {
    const board = boards.find((b) => b.id === selected);
    if (!board) return;
    setSaving(true);
    try {
      const res = await fetch("/api/accounts/pinterest", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ boardId: board.id, boardName: board.name }),
      });
      const body = (await res.json()) as { ok: boolean; message?: string };
      if (!body.ok) throw new Error(body.message ?? "Could not save board.");
      setCurrentName(board.name);
      toast(`Default board set to "${board.name}".`, "success");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not save board.", "error");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <p className="text-xs text-zinc-500">Loading boards…</p>;
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
      <label className="text-xs font-medium text-zinc-600 dark:text-zinc-300">
        Default board for pins
        {currentName && (
          <span className="ml-1 font-normal text-zinc-500">— current: {currentName}</span>
        )}
      </label>
      {boards.length === 0 ? (
        <p className="text-xs text-zinc-500">
          No boards found on this Pinterest account. Create a board on Pinterest first.
        </p>
      ) : (
        <div className="flex gap-2">
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            className="h-9 min-w-0 flex-1 rounded-lg border border-zinc-300 bg-white px-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          >
            <option value="">Choose a board…</option>
            {boards.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name} ({b.privacy.toLowerCase()})
              </option>
            ))}
          </select>
          <Button size="sm" disabled={!selected || saving} onClick={save}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      )}
    </div>
  );
}
