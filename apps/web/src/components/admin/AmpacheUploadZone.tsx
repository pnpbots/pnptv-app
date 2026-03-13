import React, { useState, useCallback, useRef } from "react";
import { uploadAmpacheFiles, type AmpacheFile } from "@/lib/api";

// ─── Types ────────────────────────────────────────────────────────────────────

export type Category = "music" | "podcasts" | "videos";

// ─── Props ────────────────────────────────────────────────────────────────────

export interface AmpacheUploadZoneProps {
  category: Category;
  accept: string;
  hint: string;
  onUploadComplete: (files: AmpacheFile[]) => void;
  onToast: (msg: string) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function AmpacheUploadZone({
  category,
  accept,
  hint,
  onUploadComplete,
  onToast,
}: AmpacheUploadZoneProps) {
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      setUploading(true);
      setProgress({ done: 0, total: files.length });
      try {
        const res = await uploadAmpacheFiles(category, files);
        setProgress({ done: files.length, total: files.length });
        onToast(
          `Uploaded ${res.uploaded.length} file${res.uploaded.length !== 1 ? "s" : ""} to ${category}.`
        );
        onUploadComplete(res.uploaded as AmpacheFile[]);
      } catch (err) {
        onToast(err instanceof Error ? err.message : "Upload failed.");
      } finally {
        setUploading(false);
        setProgress(null);
        if (inputRef.current) inputRef.current.value = "";
      }
    },
    [category, onUploadComplete, onToast]
  );

  function onDragOver(e: React.DragEvent) {
    e.preventDefault();
    setDragging(true);
  }

  function onDragLeave(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const dropped = Array.from(e.dataTransfer.files);
    handleFiles(dropped);
  }

  function onInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(e.target.files ?? []);
    handleFiles(selected);
  }

  return (
    <div
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={`relative rounded-2xl border-2 border-dashed transition-colors p-6 flex flex-col items-center justify-center gap-3 text-center min-h-[140px] ${
        dragging
          ? "border-pnp-accent bg-pnp-accent/5"
          : "border-pnp-border bg-pnp-surface hover:border-pnp-accent/40"
      }`}
    >
      {uploading ? (
        <>
          <span className="w-8 h-8 border-3 border-pnp-accent border-t-transparent rounded-full animate-spin" />
          <p className="text-sm font-medium text-pnp-textPrimary">
            Uploading{progress ? ` ${progress.done}/${progress.total}` : ""}…
          </p>
          <p className="text-xs text-pnp-textSecondary">Please wait, do not close this page.</p>
        </>
      ) : (
        <>
          <div className="w-10 h-10 rounded-full bg-pnp-surfaceHover flex items-center justify-center flex-shrink-0">
            <svg
              className="w-5 h-5 text-pnp-textSecondary"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"
              />
            </svg>
          </div>
          <div>
            <p className="text-sm font-medium text-pnp-textPrimary">
              {dragging ? "Drop files here" : "Drag & drop files here"}
            </p>
            <p className="text-xs text-pnp-textSecondary mt-0.5">{hint}</p>
          </div>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="mt-1 px-4 py-2 min-h-[36px] rounded-lg bg-pnp-surfaceHover border border-pnp-border text-xs font-medium text-pnp-textPrimary hover:border-pnp-accent/40 hover:text-pnp-accent active:scale-[0.98] transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent focus-visible:ring-offset-2 focus-visible:ring-offset-pnp-surface"
          >
            Browse files
          </button>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={accept}
            onChange={onInputChange}
            className="sr-only"
            aria-label={`Upload ${category} files`}
          />
        </>
      )}
    </div>
  );
}
