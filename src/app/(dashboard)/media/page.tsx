"use client";

/**
 * Media library: upload (image/video, 25 MB client cap) and delete.
 * If R2 storage is not configured, the API answers 503 NOT_CONFIGURED and
 * this page shows an honest warning banner instead of a fake uploader.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Card, Button, Badge, EmptyState, Skeleton } from "@/components";

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

interface MediaAssetView {
  id: string;
  type: string;
  originalFilename: string;
  publicUrl: string | null;
  mimeType: string;
  size: number;
  createdAt: string;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function MediaPage(): React.ReactElement {
  const [assets, setAssets] = useState<MediaAssetView[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notConfigured, setNotConfigured] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const fetchAssets = useCallback(async (): Promise<MediaAssetView[]> => {
    const res = await fetch("/api/media");
    const body = (await res.json().catch(() => null)) as {
      ok: boolean;
      data?: MediaAssetView[];
      code?: string;
      message?: string;
    } | null;
    if (body && body.ok && Array.isArray(body.data)) return body.data;
    throw new Error(body?.message ?? `Could not load media (HTTP ${res.status}).`);
  }, []);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      setAssets(await fetchAssets());
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }, [fetchAssets]);

  useEffect(() => {
    let cancelled = false;
    fetchAssets()
      .then((assets) => {
        if (cancelled) return;
        setAssets(assets);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setError("Could not reach the server. Check your connection and try again.");
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fetchAssets]);

  async function handleUpload(file: File): Promise<void> {
    setError(null);
    setNotConfigured(false);
    if (!(file.type.startsWith("image/") || file.type.startsWith("video/"))) {
      setError("Only image and video files are supported.");
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setError(
        `“${file.name}” is ${formatSize(file.size)} — the limit is 25 MB.`,
      );
      return;
    }

    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/media", { method: "POST", body: form });
      const body = (await res.json().catch(() => null)) as {
        ok: boolean;
        data?: MediaAssetView;
        code?: string;
        message?: string;
      } | null;
      if (body && body.ok && body.data) {
        setAssets((prev) => [body.data as MediaAssetView, ...prev]);
      } else if (body && !body.ok && body.code === "NOT_CONFIGURED") {
        setNotConfigured(true);
        setError(body.message ?? "Media storage is not configured.");
      } else {
        setError(body?.message ?? `Upload failed (HTTP ${res.status}).`);
      }
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function handleDelete(asset: MediaAssetView): Promise<void> {
    if (!window.confirm(`Delete “${asset.originalFilename}”? This cannot be undone.`)) {
      return;
    }
    setDeletingId(asset.id);
    setError(null);
    try {
      const res = await fetch(`/api/media/${asset.id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          message?: string;
        } | null;
        setError(body?.message ?? `Delete failed (HTTP ${res.status}).`);
        return;
      }
      setAssets((prev) => prev.filter((a) => a.id !== asset.id));
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="text-2xl font-bold">Media</h1>
      <p className="mt-1 text-sm text-zinc-500">
        Upload images and videos for your posts. Stored on Cloudflare R2
        (10 GB free).
      </p>

      {notConfigured && (
        <div
          role="alert"
          className="mt-6 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200"
        >
          <p className="font-semibold">Media storage is not configured</p>
          <p className="mt-1">
            Uploads are unavailable until the server has Cloudflare R2
            credentials (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
            R2_BUCKET). No files have been stored — nothing is faked here.
          </p>
        </div>
      )}

      <Card className="mt-6">
        <div className="flex flex-wrap items-center gap-4 p-5">
          <input
            ref={fileRef}
            type="file"
            accept="image/*,video/*"
            disabled={uploading}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleUpload(file);
            }}
            className="text-sm file:mr-3 file:rounded-md file:border-0 file:bg-blue-600 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-blue-700 disabled:opacity-50"
          />
          <span className="text-xs text-zinc-500">
            Images and videos up to 25 MB.
            {uploading && " Uploading…"}
          </span>
        </div>
      </Card>

      {error && (
        <p role="alert" className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}

      <div className="mt-6">
        {loading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-48" />
            ))}
          </div>
        ) : assets.length === 0 ? (
          <EmptyState
            title="No media yet"
            description="Upload your first image or video above."
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {assets.map((asset) => (
              <Card key={asset.id} className="overflow-hidden">
                <div className="aspect-video bg-zinc-100 dark:bg-zinc-900">
                  {asset.publicUrl && asset.type === "image" ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={asset.publicUrl}
                      alt={asset.originalFilename}
                      className="h-full w-full object-cover"
                    />
                  ) : asset.publicUrl && asset.type === "video" ? (
                    <video
                      src={asset.publicUrl}
                      className="h-full w-full object-cover"
                      preload="metadata"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center text-xs text-zinc-500">
                      No preview URL
                    </div>
                  )}
                </div>
                <div className="flex items-start justify-between gap-2 p-4">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {asset.originalFilename}
                    </p>
                    <p className="mt-0.5 text-xs text-zinc-500">
                      {formatSize(asset.size)} ·{" "}
                      {new Date(asset.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                  <Badge>{asset.type}</Badge>
                </div>
                <div className="flex justify-end px-4 pb-4">
                  <Button
                    variant="danger"
                    disabled={deletingId === asset.id}
                    onClick={() => void handleDelete(asset)}
                  >
                    {deletingId === asset.id ? "Deleting…" : "Delete"}
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
