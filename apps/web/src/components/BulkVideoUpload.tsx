import React, { useCallback, useRef, useState } from "react";
import {
  bulkUploadVideos,
  type BulkVideoEntry,
  type BulkUploadProgress,
  type SocialPostItem,
} from "@/lib/api";

const MAX_FILES = 5;
const MAX_SIZE_BYTES = 200 * 1024 * 1024; // 200 MB

type VideoItem = {
  id: string;
  file: File;
  previewUrl: string;
  caption: string;
  isExclusive: boolean;
  isShareable: boolean;
  status: "pending" | "uploading" | "done" | "error";
  errorMsg?: string;
};

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function BulkVideoUpload({
  onSuccess,
  onCancel,
}: {
  onSuccess: (posts: SocialPostItem[]) => void;
  onCancel: () => void;
}) {
  const [items, setItems] = useState<VideoItem[]>([]);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<BulkUploadProgress | null>(null);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);

  const addFiles = useCallback((files: FileList | File[]) => {
    const arr = Array.from(files);
    setGlobalError(null);

    const valid: VideoItem[] = [];
    for (const f of arr) {
      if (items.length + valid.length >= MAX_FILES) {
        setGlobalError(`Maximum ${MAX_FILES} videos at a time.`);
        break;
      }
      if (!f.type.match(/^video\/(mp4|webm|quicktime)$/)) {
        setGlobalError(`"${f.name}" is not an mp4/webm/mov file and was skipped.`);
        continue;
      }
      if (f.size > MAX_SIZE_BYTES) {
        setGlobalError(`"${f.name}" exceeds 200 MB and was skipped.`);
        continue;
      }
      valid.push({
        id: `${f.name}-${Date.now()}-${Math.random()}`,
        file: f,
        previewUrl: URL.createObjectURL(f),
        caption: "",
        isExclusive: false,
        isShareable: true,
        status: "pending",
      });
    }
    setItems((prev) => [...prev, ...valid]);
  }, [items]);

  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files) addFiles(e.target.files);
      e.target.value = "";
    },
    [addFiles]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      if (e.dataTransfer.files) addFiles(e.dataTransfer.files);
    },
    [addFiles]
  );

  const removeItem = useCallback((id: string) => {
    setItems((prev) => {
      const item = prev.find((x) => x.id === id);
      if (item) URL.revokeObjectURL(item.previewUrl);
      return prev.filter((x) => x.id !== id);
    });
  }, []);

  const updateCaption = useCallback((id: string, caption: string) => {
    setItems((prev) => prev.map((x) => (x.id === id ? { ...x, caption } : x)));
  }, []);

  const updateExclusive = useCallback((id: string, val: boolean) => {
    setItems((prev) => prev.map((x) => (x.id === id ? { ...x, isExclusive: val } : x)));
  }, []);

  const updateShareable = useCallback((id: string, val: boolean) => {
    setItems((prev) => prev.map((x) => (x.id === id ? { ...x, isShareable: val } : x)));
  }, []);

  const handleUpload = useCallback(async () => {
    if (items.length === 0 || uploading) return;
    setUploading(true);
    setGlobalError(null);
    setProgress(null);

    setItems((prev) => prev.map((x) => ({ ...x, status: "uploading" as const })));

    const entries: BulkVideoEntry[] = items.map((x) => ({
      file: x.file,
      caption: x.caption.trim() || "🎬",
      isExclusive: x.isExclusive,
      isShareable: x.isShareable,
    }));

    try {
      const res = await bulkUploadVideos(entries, setProgress);

      // Mark each item's status
      setItems((prev) =>
        prev.map((x, i) => {
          const err = res.errors?.find((e) => e.index === i);
          return {
            ...x,
            status: err ? ("error" as const) : ("done" as const),
            errorMsg: err?.error,
          };
        })
      );

      if (res.posts.length > 0) {
        setTimeout(() => {
          // clean up object URLs
          items.forEach((x) => URL.revokeObjectURL(x.previewUrl));
          onSuccess(res.posts);
        }, 1000);
      } else {
        setGlobalError("No videos could be uploaded. Check the errors above.");
      }
    } catch (err) {
      setGlobalError(err instanceof Error ? err.message : "Upload failed");
      setItems((prev) => prev.map((x) => ({ ...x, status: "error" as const, errorMsg: "Upload failed" })));
    } finally {
      setUploading(false);
    }
  }, [items, uploading, onSuccess]);

  return (
    <div className="flex flex-col gap-4">
      {/* Drop zone */}
      {items.length < MAX_FILES && (
        <div
          ref={dropRef}
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
          onClick={() => fileInputRef.current?.click()}
          className="flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-white/20 p-6 cursor-pointer hover:border-white/40 hover:bg-white/5 transition-colors"
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === "Enter" && fileInputRef.current?.click()}
          aria-label="Click or drag videos here"
        >
          <svg className="w-10 h-10 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.2} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="m15.75 10.5 4.72-4.72a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25h-9A2.25 2.25 0 0 0 2.25 7.5v9a2.25 2.25 0 0 0 2.25 2.25Z" />
          </svg>
          <p className="text-sm font-medium text-white/60">
            Drop videos here or click to browse
          </p>
          <p className="text-xs text-white/30">mp4 / webm / mov &bull; max 200 MB each &bull; up to {MAX_FILES} files</p>
        </div>
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept="video/mp4,video/webm,video/quicktime"
        multiple
        className="hidden"
        onChange={handleFileInputChange}
      />

      {/* Video list */}
      {items.length > 0 && (
        <div className="flex flex-col gap-3">
          {items.map((item, i) => (
            <div
              key={item.id}
              className="rounded-xl border border-white/10 overflow-hidden"
              style={{
                borderColor:
                  item.status === "done"
                    ? "rgba(52,211,153,0.4)"
                    : item.status === "error"
                    ? "rgba(239,68,68,0.4)"
                    : undefined,
              }}
            >
              <div className="flex gap-3 p-3">
                {/* Thumbnail */}
                <div className="flex-shrink-0 w-24 h-16 rounded-lg overflow-hidden bg-black/40 relative">
                  <video
                    src={item.previewUrl}
                    className="w-full h-full object-cover"
                    muted
                    preload="metadata"
                  />
                  {item.status === "done" && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                      <svg className="w-6 h-6 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                      </svg>
                    </div>
                  )}
                  {item.status === "error" && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                      <svg className="w-6 h-6 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </div>
                  )}
                </div>

                {/* Info + caption */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2 mb-1.5">
                    <p className="text-xs text-white/50 truncate">{item.file.name}</p>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <span className="text-xs text-white/30">{formatBytes(item.file.size)}</span>
                      {!uploading && item.status === "pending" && (
                        <button
                          onClick={() => removeItem(item.id)}
                          className="w-5 h-5 rounded-full flex items-center justify-center text-white/40 hover:text-white/80 hover:bg-white/10 transition-colors"
                          aria-label="Remove video"
                        >
                          &times;
                        </button>
                      )}
                    </div>
                  </div>

                  <textarea
                    value={item.caption}
                    onChange={(e) => updateCaption(item.id, e.target.value.slice(0, 5000))}
                    placeholder={`Caption for video ${i + 1}...`}
                    rows={2}
                    disabled={uploading}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white placeholder:text-white/30 resize-none outline-none focus:border-white/25 disabled:opacity-50"
                  />

                  {/* Toggles */}
                  <div className="flex items-center gap-3 mt-1.5">
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <button
                        role="switch"
                        aria-checked={item.isExclusive}
                        onClick={() => updateExclusive(item.id, !item.isExclusive)}
                        disabled={uploading}
                        className="relative inline-flex h-4 w-7 items-center rounded-full transition-colors duration-200 disabled:opacity-40"
                        style={{ background: item.isExclusive ? "#D4007A" : "rgba(255,255,255,0.15)" }}
                      >
                        <span
                          className="inline-block h-3 w-3 rounded-full bg-white shadow transition-transform duration-200"
                          style={{ transform: item.isExclusive ? "translateX(14px)" : "translateX(2px)" }}
                        />
                      </button>
                      <span className="text-xs" style={{ color: item.isExclusive ? "#D4007A" : "#8E8E93" }}>
                        Exclusive
                      </span>
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <button
                        role="switch"
                        aria-checked={item.isShareable}
                        onClick={() => updateShareable(item.id, !item.isShareable)}
                        disabled={uploading}
                        className="relative inline-flex h-4 w-7 items-center rounded-full transition-colors duration-200 disabled:opacity-40"
                        style={{ background: item.isShareable ? "#34D399" : "rgba(255,255,255,0.15)" }}
                      >
                        <span
                          className="inline-block h-3 w-3 rounded-full bg-white shadow transition-transform duration-200"
                          style={{ transform: item.isShareable ? "translateX(14px)" : "translateX(2px)" }}
                        />
                      </button>
                      <span className="text-xs" style={{ color: item.isShareable ? "#34D399" : "#8E8E93" }}>
                        Shareable
                      </span>
                    </label>
                  </div>

                  {item.errorMsg && (
                    <p className="text-xs text-red-400 mt-1">{item.errorMsg}</p>
                  )}
                </div>
              </div>

              {/* Per-item uploading indicator */}
              {item.status === "uploading" && (
                <div className="h-0.5 bg-white/10">
                  <div
                    className="h-full transition-all duration-300"
                    style={{
                      width: progress ? `${progress.percent}%` : "30%",
                      background: "linear-gradient(90deg, #D4007A, #E69138)",
                      animation: progress ? undefined : "pulse 1s ease-in-out infinite",
                    }}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Overall upload progress */}
      {uploading && progress && (
        <div className="rounded-lg px-3 py-2" style={{ background: "rgba(212,0,122,0.06)", border: "1px solid rgba(212,0,122,0.15)" }}>
          <div className="flex justify-between text-xs mb-1.5" style={{ color: "#D4007A" }}>
            <span>Uploading {items.length} video{items.length !== 1 ? "s" : ""}...</span>
            <span>{progress.percent}%</span>
          </div>
          <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-300"
              style={{ width: `${progress.percent}%`, background: "linear-gradient(90deg, #D4007A, #E69138)" }}
            />
          </div>
          <p className="text-xs mt-1" style={{ color: "#8E8E93" }}>
            {formatBytes(progress.loaded)} / {formatBytes(progress.total)}
          </p>
        </div>
      )}

      {globalError && (
        <p className="text-xs text-red-400 px-1">{globalError}</p>
      )}

      {/* Actions */}
      <div className="flex items-center justify-between gap-3">
        <button
          onClick={onCancel}
          disabled={uploading}
          className="px-4 py-2 rounded-lg text-sm border border-white/10 text-white/60 hover:text-white hover:bg-white/5 transition-colors disabled:opacity-40"
        >
          Cancel
        </button>
        <button
          onClick={handleUpload}
          disabled={items.length === 0 || uploading}
          className="btn-gradient px-5 py-2 rounded-lg text-white text-sm font-semibold disabled:opacity-40"
        >
          {uploading
            ? "Uploading..."
            : `Post ${items.length} Video${items.length !== 1 ? "s" : ""}`}
        </button>
      </div>
    </div>
  );
}
