import React, { useState, useEffect, useCallback, useRef } from "react";
import { useAuth } from "@/hooks/useAuth";
import { Skeleton } from "@pnptv/ui-kit";
import {
  getAmpacheFiles,
  uploadAmpacheFiles,
  deleteAmpacheFile,
  renameAmpacheFile,
  getAmpacheFileTags,
  updateAmpacheFileTags,
  getMediaLibraryVideos,
  syncVideoToMediaLibrary,
  toggleVideoPrime,
  type AmpacheFile,
  type AmpacheFileTags,
  type MediaLibraryVideo,
} from "@/lib/api";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / Math.pow(1024, i);
  return `${value % 1 === 0 ? value : value.toFixed(1)} ${units[i]}`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

type Category = "music" | "podcasts" | "videos";

const CATEGORIES: { key: Category; label: string; accept: string; hint: string }[] = [
  {
    key: "music",
    label: "Music",
    accept: "audio/*,.flac,.mp3,.ogg,.wav,.aac,.m4a",
    hint: "MP3, FLAC, OGG, WAV, AAC, M4A",
  },
  {
    key: "podcasts",
    label: "Podcasts",
    accept: "audio/*,.mp3,.ogg,.m4a,.wav",
    hint: "MP3, OGG, M4A, WAV",
  },
  {
    key: "videos",
    label: "Videos",
    accept: "video/*,.mp4,.mkv,.mov,.webm",
    hint: "MP4, MKV, MOV, WebM",
  },
];

// ─── Toast ────────────────────────────────────────────────────────────────────

interface Toast {
  id: number;
  type: "success" | "error";
  message: string;
}

// ─── Delete Confirm Dialog ────────────────────────────────────────────────────

interface ConfirmDeleteProps {
  filename: string;
  onConfirm: () => void;
  onCancel: () => void;
  deleting: boolean;
}

function ConfirmDeleteDialog({ filename, onConfirm, onCancel, deleting }: ConfirmDeleteProps) {
  const backdropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onCancel]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4"
      onClick={(e) => {
        if (e.target === backdropRef.current) onCancel();
      }}
    >
      <div className="w-full max-w-sm rounded-2xl bg-pnp-surface border border-pnp-border p-6 space-y-4 shadow-2xl">
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0 w-10 h-10 rounded-full bg-pnp-error/10 flex items-center justify-center">
            <svg
              className="w-5 h-5 text-pnp-error"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
              />
            </svg>
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-pnp-textPrimary">Delete file?</p>
            <p className="text-xs text-pnp-textSecondary mt-1 break-all">
              "{filename}" will be permanently removed from the media server.
            </p>
          </div>
        </div>
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            disabled={deleting}
            className="flex-1 min-h-[44px] rounded-xl border border-pnp-border text-sm font-medium text-pnp-textSecondary hover:text-pnp-textPrimary hover:border-pnp-accent/40 active:scale-[0.98] transition-all disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent focus-visible:ring-offset-2 focus-visible:ring-offset-pnp-surface"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={deleting}
            className="flex-1 min-h-[44px] rounded-xl bg-pnp-error text-white text-sm font-semibold active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-error focus-visible:ring-offset-2 focus-visible:ring-offset-pnp-surface"
          >
            {deleting ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Deleting...
              </span>
            ) : (
              "Delete"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Edit File Dialog ────────────────────────────────────────────────────────

interface EditFileProps {
  file: AmpacheFile;
  onSave: () => void;
  onCancel: () => void;
  onToast: (type: "success" | "error", message: string) => void;
}

function EditFileDialog({ file, onSave, onCancel, onToast }: EditFileProps) {
  const backdropRef = useRef<HTMLDivElement>(null);
  const ext = file.name.substring(file.name.lastIndexOf("."));
  const baseName = file.name.substring(0, file.name.lastIndexOf("."));
  const isMp3 = ext.toLowerCase() === ".mp3";

  const [newBaseName, setNewBaseName] = useState(baseName);
  const [tags, setTags] = useState<AmpacheFileTags | null>(null);
  const [tagsLoading, setTagsLoading] = useState(true);
  const [tagsError, setTagsError] = useState<string | null>(null);
  const [editedTags, setEditedTags] = useState<{
    title: string;
    artist: string;
    album: string;
    genre: string;
    year: string;
  }>({ title: "", artist: "", album: "", genre: "", year: "" });
  const [saving, setSaving] = useState(false);

  // Load tags on mount
  useEffect(() => {
    setTagsLoading(true);
    getAmpacheFileTags(file.category, file.name)
      .then((res) => {
        setTags(res.tags);
        setEditedTags({
          title: res.tags.title || baseName,
          artist: res.tags.artist,
          album: res.tags.album,
          genre: res.tags.genre,
          year: res.tags.year ? String(res.tags.year) : "",
        });
      })
      .catch((err) => setTagsError(err instanceof Error ? err.message : "Failed to read tags"))
      .finally(() => setTagsLoading(false));
  }, [file.category, file.name, baseName]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onCancel]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      // 1. Rename file if name changed
      const newFullName = newBaseName + ext;
      let currentFileName = file.name;
      if (newFullName !== file.name) {
        await renameAmpacheFile(file.category, file.name, newFullName);
        currentFileName = newFullName;
        onToast("success", `Renamed to "${newFullName}"`);
      }

      // 2. Update tags if MP3 and tags changed
      if (isMp3 && tags) {
        const hasChanges =
          editedTags.title !== (tags.title || baseName) ||
          editedTags.artist !== tags.artist ||
          editedTags.album !== tags.album ||
          editedTags.genre !== tags.genre ||
          editedTags.year !== (tags.year ? String(tags.year) : "");

        if (hasChanges) {
          await updateAmpacheFileTags(file.category, currentFileName, {
            title: editedTags.title,
            artist: editedTags.artist,
            album: editedTags.album,
            genre: editedTags.genre,
            year: editedTags.year,
          });
          onToast("success", "Tags updated successfully");
        }
      }

      onSave();
    } catch (err) {
      onToast("error", err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const inputClass =
    "w-full rounded-lg border border-pnp-border bg-pnp-background px-3 py-2 text-sm text-pnp-textPrimary placeholder:text-pnp-textSecondary/50 focus:outline-none focus:ring-2 focus:ring-pnp-accent focus:border-transparent transition-all";
  const labelClass = "block text-xs font-medium text-pnp-textSecondary mb-1";

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4"
      onClick={(e) => {
        if (e.target === backdropRef.current) onCancel();
      }}
    >
      <div className="w-full max-w-md rounded-2xl bg-pnp-surface border border-pnp-border p-6 space-y-5 shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center gap-3">
          <div className="flex-shrink-0 w-10 h-10 rounded-full bg-pnp-accent/10 flex items-center justify-center">
            <svg className="w-5 h-5 text-pnp-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-semibold text-pnp-textPrimary">Edit File</p>
            <p className="text-xs text-pnp-textSecondary truncate max-w-[280px]" title={file.name}>
              {file.name}
            </p>
          </div>
        </div>

        {/* Filename */}
        <div>
          <label className={labelClass}>Filename</label>
          <div className="flex items-center gap-1">
            <input
              type="text"
              value={newBaseName}
              onChange={(e) => setNewBaseName(e.target.value)}
              className={inputClass + " flex-1"}
              placeholder="File name"
            />
            <span className="text-xs text-pnp-textSecondary font-mono">{ext}</span>
          </div>
        </div>

        {/* Tags section */}
        {tagsLoading ? (
          <div className="space-y-2">
            <div className="h-4 w-20 rounded bg-pnp-surfaceHover animate-pulse" />
            <div className="h-9 rounded-lg bg-pnp-surfaceHover animate-pulse" />
            <div className="h-9 rounded-lg bg-pnp-surfaceHover animate-pulse" />
          </div>
        ) : tagsError ? (
          <p className="text-xs text-pnp-textSecondary">Could not read metadata: {tagsError}</p>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-pnp-textSecondary uppercase tracking-wider">Metadata</span>
              {!isMp3 && (
                <span className="text-[10px] text-pnp-textSecondary bg-pnp-surfaceHover px-2 py-0.5 rounded-full">
                  Read-only (non-MP3)
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 gap-3">
              <div>
                <label className={labelClass}>Title</label>
                <input
                  type="text"
                  value={editedTags.title}
                  onChange={(e) => setEditedTags((t) => ({ ...t, title: e.target.value }))}
                  className={inputClass}
                  placeholder="Track title"
                  disabled={!isMp3}
                />
              </div>
              <div>
                <label className={labelClass}>Artist</label>
                <input
                  type="text"
                  value={editedTags.artist}
                  onChange={(e) => setEditedTags((t) => ({ ...t, artist: e.target.value }))}
                  className={inputClass}
                  placeholder="Artist name"
                  disabled={!isMp3}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>Album</label>
                  <input
                    type="text"
                    value={editedTags.album}
                    onChange={(e) => setEditedTags((t) => ({ ...t, album: e.target.value }))}
                    className={inputClass}
                    placeholder="Album"
                    disabled={!isMp3}
                  />
                </div>
                <div>
                  <label className={labelClass}>Genre</label>
                  <input
                    type="text"
                    value={editedTags.genre}
                    onChange={(e) => setEditedTags((t) => ({ ...t, genre: e.target.value }))}
                    className={inputClass}
                    placeholder="Genre"
                    disabled={!isMp3}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>Year</label>
                  <input
                    type="text"
                    value={editedTags.year}
                    onChange={(e) => setEditedTags((t) => ({ ...t, year: e.target.value.replace(/\D/g, "").slice(0, 4) }))}
                    className={inputClass}
                    placeholder="2026"
                    disabled={!isMp3}
                    maxLength={4}
                  />
                </div>
                {tags && (
                  <div>
                    <label className={labelClass}>Duration</label>
                    <p className="px-3 py-2 text-sm text-pnp-textSecondary">
                      {Math.floor(tags.duration / 60)}:{String(tags.duration % 60).padStart(2, "0")}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </>
        )}

        {/* Actions */}
        <div className="flex gap-3 pt-1">
          <button
            onClick={onCancel}
            disabled={saving}
            className="flex-1 min-h-[44px] rounded-xl border border-pnp-border text-sm font-medium text-pnp-textSecondary hover:text-pnp-textPrimary hover:border-pnp-accent/40 active:scale-[0.98] transition-all disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent focus-visible:ring-offset-2 focus-visible:ring-offset-pnp-surface"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !newBaseName.trim()}
            className="flex-1 min-h-[44px] rounded-xl btn-gradient text-white text-sm font-semibold active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent focus-visible:ring-offset-2 focus-visible:ring-offset-pnp-surface"
          >
            {saving ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Saving...
              </span>
            ) : (
              "Save"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Upload Zone ──────────────────────────────────────────────────────────────

interface UploadZoneProps {
  category: Category;
  accept: string;
  hint: string;
  onUploadComplete: (category: Category) => void;
  onToast: (type: "success" | "error", message: string) => void;
}

function UploadZone({ category, accept, hint, onUploadComplete, onToast }: UploadZoneProps) {
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
          "success",
          `Uploaded ${res.uploaded.length} file${res.uploaded.length !== 1 ? "s" : ""} to ${category}.`
        );
        onUploadComplete(category);
      } catch (err) {
        onToast("error", err instanceof Error ? err.message : "Upload failed.");
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

// ─── File Table Row (desktop) ─────────────────────────────────────────────────

interface FileRowProps {
  file: AmpacheFile;
  onDelete: (file: AmpacheFile) => void;
  onEdit: (file: AmpacheFile) => void;
  primeRecord?: MediaLibraryVideo | null;
  onPrimeToggle?: (file: AmpacheFile, currentRecord: MediaLibraryVideo | null) => void;
  primeToggling?: boolean;
}

function FileRow({ file, onDelete, onEdit, primeRecord, onPrimeToggle, primeToggling }: FileRowProps) {
  const showPrimeToggle = file.category === "videos" && onPrimeToggle !== undefined;
  const isPrime = primeRecord?.is_prime ?? false;

  return (
    <tr className="group border-b border-pnp-border last:border-0 hover:bg-pnp-surfaceHover/50 transition-colors">
      <td className="py-3 pl-4 pr-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="flex-shrink-0 w-7 h-7 rounded-lg bg-pnp-surfaceHover flex items-center justify-center">
            <svg
              className="w-3.5 h-3.5 text-pnp-textSecondary"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9 9l10.5-3m0 6.553v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 11-.99-3.467l2.31-.66a2.25 2.25 0 001.632-2.163zm0 0V2.25L9 5.25v10.303m0 0v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 01-.99-3.467l2.31-.66A2.25 2.25 0 009 15.553z"
              />
            </svg>
          </div>
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-sm text-pnp-textPrimary truncate max-w-xs" title={file.name}>
              {file.name}
            </span>
            {showPrimeToggle && isPrime && (
              <span className="flex-shrink-0 px-1.5 py-0.5 rounded-full bg-yellow-500/20 text-yellow-400 text-[10px] font-semibold">
                Prime
              </span>
            )}
          </div>
        </div>
      </td>
      <td className="py-3 px-3 text-sm text-pnp-textSecondary whitespace-nowrap">
        {formatBytes(file.size)}
      </td>
      <td className="py-3 px-3 text-sm text-pnp-textSecondary whitespace-nowrap hidden sm:table-cell">
        {formatDate(file.modified)}
      </td>
      <td className="py-3 pl-3 pr-4 text-right">
        <div className="flex items-center justify-end gap-1">
          {showPrimeToggle && (
            <button
              onClick={() => onPrimeToggle(file, primeRecord ?? null)}
              disabled={primeToggling}
              aria-label={isPrime ? `Remove Prime from ${file.name}` : `Mark ${file.name} as Prime`}
              title={isPrime ? "Remove Prime" : "Mark as Prime"}
              className={`p-2 rounded-lg transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-400 active:scale-[0.96] disabled:opacity-50 disabled:cursor-not-allowed ${
                isPrime
                  ? "text-yellow-400 hover:text-yellow-300 hover:bg-yellow-400/10"
                  : "text-pnp-textSecondary hover:text-yellow-400 hover:bg-yellow-400/10 opacity-0 group-hover:opacity-100"
              }`}
            >
              {primeToggling ? (
                <span className="w-4 h-4 border-2 border-yellow-400 border-t-transparent rounded-full animate-spin inline-block" />
              ) : (
                <svg className="w-4 h-4" fill={isPrime ? "currentColor" : "none"} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />
                </svg>
              )}
            </button>
          )}
          <button
            onClick={() => onEdit(file)}
            aria-label={`Edit ${file.name}`}
            className="p-2 rounded-lg text-pnp-textSecondary hover:text-pnp-accent hover:bg-pnp-accent/10 active:scale-[0.96] transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent opacity-0 group-hover:opacity-100"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </button>
          <button
            onClick={() => onDelete(file)}
            aria-label={`Delete ${file.name}`}
            className="p-2 rounded-lg text-pnp-textSecondary hover:text-pnp-error hover:bg-pnp-error/10 active:scale-[0.96] transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-error opacity-0 group-hover:opacity-100"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
              />
            </svg>
          </button>
        </div>
      </td>
    </tr>
  );
}

// ─── File Card (mobile) ───────────────────────────────────────────────────────

interface FileCardProps {
  file: AmpacheFile;
  onDelete: (file: AmpacheFile) => void;
  onEdit: (file: AmpacheFile) => void;
  primeRecord?: MediaLibraryVideo | null;
  onPrimeToggle?: (file: AmpacheFile, currentRecord: MediaLibraryVideo | null) => void;
  primeToggling?: boolean;
}

function FileCard({ file, onDelete, onEdit, primeRecord, onPrimeToggle, primeToggling }: FileCardProps) {
  const showPrimeToggle = file.category === "videos" && onPrimeToggle !== undefined;
  const isPrime = primeRecord?.is_prime ?? false;

  return (
    <div className="flex items-center gap-3 p-3 rounded-xl bg-pnp-surface border border-pnp-border">
      <div className="flex-shrink-0 w-9 h-9 rounded-lg bg-pnp-surfaceHover flex items-center justify-center">
        <svg
          className="w-4 h-4 text-pnp-textSecondary"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M9 9l10.5-3m0 6.553v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 11-.99-3.467l2.31-.66a2.25 2.25 0 001.632-2.163zm0 0V2.25L9 5.25v10.303m0 0v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 01-.99-3.467l2.31-.66A2.25 2.25 0 009 15.553z"
          />
        </svg>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium text-pnp-textPrimary truncate" title={file.name}>
            {file.name}
          </p>
          {showPrimeToggle && isPrime && (
            <span className="flex-shrink-0 px-1.5 py-0.5 rounded-full bg-yellow-500/20 text-yellow-400 text-[10px] font-semibold">
              Prime
            </span>
          )}
        </div>
        <p className="text-xs text-pnp-textSecondary mt-0.5">
          {formatBytes(file.size)} · {formatDate(file.modified)}
        </p>
      </div>
      <div className="flex items-center gap-1 flex-shrink-0">
        {showPrimeToggle && (
          <button
            onClick={() => onPrimeToggle(file, primeRecord ?? null)}
            disabled={primeToggling}
            aria-label={isPrime ? `Remove Prime from ${file.name}` : `Mark ${file.name} as Prime`}
            title={isPrime ? "Remove Prime" : "Mark as Prime"}
            className={`p-2 rounded-lg transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-400 active:scale-[0.96] disabled:opacity-50 disabled:cursor-not-allowed ${
              isPrime
                ? "text-yellow-400 hover:text-yellow-300 hover:bg-yellow-400/10"
                : "text-pnp-textSecondary hover:text-yellow-400 hover:bg-yellow-400/10"
            }`}
          >
            {primeToggling ? (
              <span className="w-4 h-4 border-2 border-yellow-400 border-t-transparent rounded-full animate-spin inline-block" />
            ) : (
              <svg className="w-4 h-4" fill={isPrime ? "currentColor" : "none"} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />
              </svg>
            )}
          </button>
        )}
        <button
          onClick={() => onEdit(file)}
          aria-label={`Edit ${file.name}`}
          className="p-2 rounded-lg text-pnp-textSecondary hover:text-pnp-accent hover:bg-pnp-accent/10 active:scale-[0.96] transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
          </svg>
        </button>
        <button
          onClick={() => onDelete(file)}
          aria-label={`Delete ${file.name}`}
          className="p-2 rounded-lg text-pnp-textSecondary hover:text-pnp-error hover:bg-pnp-error/10 active:scale-[0.96] transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-error"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}

// ─── File List ────────────────────────────────────────────────────────────────

interface FileListProps {
  files: AmpacheFile[];
  loading: boolean;
  category: Category;
  onDelete: (file: AmpacheFile) => void;
  onEdit: (file: AmpacheFile) => void;
  mediaLibraryVideos?: MediaLibraryVideo[];
  onPrimeToggle?: (file: AmpacheFile, currentRecord: MediaLibraryVideo | null) => void;
  primeTogglingFile?: string | null;
}

function FileList({ files, loading, category, onDelete, onEdit, mediaLibraryVideos, onPrimeToggle, primeTogglingFile }: FileListProps) {
  if (loading) {
    return (
      <div className="space-y-2 mt-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="h-12 rounded-xl bg-pnp-surfaceHover animate-pulse"
          />
        ))}
      </div>
    );
  }

  if (files.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <div className="w-12 h-12 rounded-full bg-pnp-surfaceHover flex items-center justify-center mb-3">
          <svg
            className="w-6 h-6 text-pnp-textSecondary"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
            />
          </svg>
        </div>
        <p className="text-sm font-medium text-pnp-textPrimary">No {category} files yet</p>
        <p className="text-xs text-pnp-textSecondary mt-1">
          Upload files using the drop zone above.
        </p>
      </div>
    );
  }

  /** Find the media_library record for a given video file by filename match */
  const getVideoRecord = (file: AmpacheFile): MediaLibraryVideo | null => {
    if (!mediaLibraryVideos || category !== "videos") return null;
    return (
      mediaLibraryVideos.find(
        (v) =>
          v.url.includes(file.name) ||
          v.title === file.name.replace(/\.[^.]+$/, "")
      ) ?? null
    );
  };

  return (
    <>
      {/* Desktop table */}
      <div className="hidden sm:block mt-4 rounded-xl border border-pnp-border overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-pnp-border bg-pnp-surfaceHover">
              <th className="py-2.5 pl-4 pr-3 text-left text-xs font-semibold text-pnp-textSecondary uppercase tracking-wider">
                Name
              </th>
              <th className="py-2.5 px-3 text-left text-xs font-semibold text-pnp-textSecondary uppercase tracking-wider">
                Size
              </th>
              <th className="py-2.5 px-3 text-left text-xs font-semibold text-pnp-textSecondary uppercase tracking-wider">
                Date
              </th>
              <th className="py-2.5 pl-3 pr-4 text-right text-xs font-semibold text-pnp-textSecondary uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {files.map((file) => (
              <FileRow
                key={file.name}
                file={file}
                onDelete={onDelete}
                onEdit={onEdit}
                primeRecord={getVideoRecord(file)}
                onPrimeToggle={category === "videos" ? onPrimeToggle : undefined}
                primeToggling={primeTogglingFile === file.name}
              />
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile card list */}
      <div className="sm:hidden mt-4 space-y-2">
        {files.map((file) => (
          <FileCard
            key={file.name}
            file={file}
            onDelete={onDelete}
            onEdit={onEdit}
            primeRecord={getVideoRecord(file)}
            onPrimeToggle={category === "videos" ? onPrimeToggle : undefined}
            primeToggling={primeTogglingFile === file.name}
          />
        ))}
      </div>

      <p className="mt-3 text-xs text-pnp-textSecondary text-right">
        {files.length} file{files.length !== 1 ? "s" : ""} &middot;{" "}
        {formatBytes(files.reduce((acc, f) => acc + f.size, 0))} total
      </p>
    </>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AmpacheMedia() {
  const { isAdmin, isLoading: authLoading } = useAuth();

  const [activeTab, setActiveTab] = useState<Category>("music");
  const [filesData, setFilesData] = useState<{
    music: AmpacheFile[];
    podcasts: AmpacheFile[];
    videos: AmpacheFile[];
  }>({ music: [], podcasts: [], videos: [] });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [toastCounter, setToastCounter] = useState(0);
  const [pendingDelete, setPendingDelete] = useState<AmpacheFile | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [editingFile, setEditingFile] = useState<AmpacheFile | null>(null);

  // Media library video records (for Prime toggle on Videos tab)
  const [mediaLibraryVideos, setMediaLibraryVideos] = useState<MediaLibraryVideo[]>([]);
  const [primeTogglingFile, setPrimeTogglingFile] = useState<string | null>(null);

  const addToast = useCallback((type: "success" | "error", message: string) => {
    setToastCounter((c) => {
      const id = c + 1;
      setToasts((prev) => [...prev, { id, type, message }]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 4000);
      return id;
    });
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    return Promise.all([
      getAmpacheFiles(),
      getMediaLibraryVideos().catch(() => ({ success: false, videos: [] as MediaLibraryVideo[] })),
    ])
      .then(([filesRes, libraryRes]) => {
        setFilesData(filesRes.files);
        setMediaLibraryVideos(libraryRes.videos || []);
      })
      .catch((err) =>
        setLoadError(err instanceof Error ? err.message : "Failed to load Ampache files.")
      )
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!authLoading && isAdmin) {
      load();
    }
  }, [authLoading, isAdmin, load]);

  const handlePrimeToggle = useCallback(
    async (file: AmpacheFile, currentRecord: MediaLibraryVideo | null) => {
      setPrimeTogglingFile(file.name);
      try {
        let record = currentRecord;
        // If not yet in media_library, sync it first
        if (!record) {
          const syncRes = await syncVideoToMediaLibrary({
            filename: file.name,
            title: file.name.replace(/\.[^.]+$/, ""),
            category: "videos",
          });
          record = syncRes.video;
        }
        const newPrime = !record.is_prime;
        const toggleRes = await toggleVideoPrime(record.id, newPrime);
        setMediaLibraryVideos((prev) => {
          const existing = prev.find((v) => v.id === toggleRes.video.id);
          if (existing) {
            return prev.map((v) => (v.id === toggleRes.video.id ? toggleRes.video : v));
          }
          return [...prev, toggleRes.video];
        });
        addToast(
          "success",
          newPrime
            ? `"${file.name}" marked as Prime.`
            : `"${file.name}" removed from Prime.`
        );
      } catch (err) {
        addToast("error", err instanceof Error ? err.message : "Failed to update Prime status.");
      } finally {
        setPrimeTogglingFile(null);
      }
    },
    [addToast]
  );

  function handleUploadComplete(category: Category) {
    // Refresh just the data; keep current tab
    load();
  }

  function handleDeleteRequest(file: AmpacheFile) {
    setPendingDelete(file);
  }

  async function handleDeleteConfirm() {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await deleteAmpacheFile(pendingDelete.category, pendingDelete.name);
      addToast("success", `"${pendingDelete.name}" deleted.`);
      setPendingDelete(null);
      load();
    } catch (err) {
      addToast("error", err instanceof Error ? err.message : "Delete failed.");
      setPendingDelete(null);
    } finally {
      setDeleting(false);
    }
  }

  const activeCategoryConfig = CATEGORIES.find((c) => c.key === activeTab)!;
  const activeFiles = filesData[activeTab];

  // Auth loading skeleton
  if (authLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-64 rounded-xl" />
        <Skeleton className="h-8 w-80 rounded-lg" />
        <Skeleton className="h-40 rounded-2xl" />
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-12 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Toast container */}
      <div
        aria-live="polite"
        className="fixed top-4 left-1/2 -translate-x-1/2 z-50 flex flex-col gap-2 w-full max-w-sm px-4 pointer-events-none"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`px-4 py-3 rounded-xl border text-sm font-medium shadow-lg pointer-events-auto transition-all ${
              toast.type === "success"
                ? "bg-green-500/10 border-green-500/30 text-green-400"
                : "bg-pnp-error/10 border-pnp-error/30 text-pnp-error"
            }`}
          >
            {toast.message}
          </div>
        ))}
      </div>

      {/* Page header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-pnp-textPrimary">Ampache Media</h1>
          <p className="text-sm text-pnp-textSecondary mt-1">
            Upload and manage music, podcasts, and video files on the media server.
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          aria-label="Refresh file list"
          className="min-h-[44px] min-w-[44px] px-4 flex items-center gap-2 rounded-xl border border-pnp-border text-sm text-pnp-textSecondary hover:text-pnp-textPrimary hover:border-pnp-accent/40 active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent focus-visible:ring-offset-2 focus-visible:ring-offset-pnp-background"
        >
          <svg
            className={`w-4 h-4 ${loading ? "animate-spin" : ""}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
          Refresh
        </button>
      </div>

      {/* Load error */}
      {loadError && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-12 h-12 rounded-full bg-pnp-error/10 flex items-center justify-center mb-4">
            <svg
              className="w-6 h-6 text-pnp-error"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
          </div>
          <p className="text-pnp-textPrimary font-medium mb-1">Failed to load files</p>
          <p className="text-sm text-pnp-textSecondary mb-4">{loadError}</p>
          <button
            onClick={load}
            className="px-5 py-2.5 min-h-[44px] rounded-xl btn-gradient text-white text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent focus-visible:ring-offset-2 focus-visible:ring-offset-pnp-background"
          >
            Try Again
          </button>
        </div>
      )}

      {!loadError && (
        <>
          {/* Category tabs */}
          <div className="flex gap-1 p-1 rounded-xl bg-pnp-surfaceHover border border-pnp-border w-fit">
            {CATEGORIES.map((cat) => (
              <button
                key={cat.key}
                onClick={() => setActiveTab(cat.key)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent focus-visible:ring-offset-1 focus-visible:ring-offset-pnp-surfaceHover ${
                  activeTab === cat.key
                    ? "bg-pnp-accent text-white shadow-sm"
                    : "text-pnp-textSecondary hover:text-pnp-textPrimary"
                }`}
              >
                {cat.label}
                {!loading && (
                  <span
                    className={`ml-2 text-xs px-1.5 py-0.5 rounded-full ${
                      activeTab === cat.key
                        ? "bg-white/20 text-white"
                        : "bg-pnp-border text-pnp-textSecondary"
                    }`}
                  >
                    {filesData[cat.key].length}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Upload zone */}
          <UploadZone
            category={activeTab}
            accept={activeCategoryConfig.accept}
            hint={activeCategoryConfig.hint}
            onUploadComplete={handleUploadComplete}
            onToast={addToast}
          />

          {/* File list */}
          <FileList
            files={activeFiles}
            loading={loading}
            category={activeTab}
            onDelete={handleDeleteRequest}
            onEdit={(file) => setEditingFile(file)}
            mediaLibraryVideos={activeTab === "videos" ? mediaLibraryVideos : undefined}
            onPrimeToggle={activeTab === "videos" ? handlePrimeToggle : undefined}
            primeTogglingFile={activeTab === "videos" ? primeTogglingFile : null}
          />
        </>
      )}

      {/* Delete confirm dialog */}
      {pendingDelete && (
        <ConfirmDeleteDialog
          filename={pendingDelete.name}
          onConfirm={handleDeleteConfirm}
          onCancel={() => setPendingDelete(null)}
          deleting={deleting}
        />
      )}

      {/* Edit file dialog */}
      {editingFile && (
        <EditFileDialog
          file={editingFile}
          onSave={() => {
            setEditingFile(null);
            load();
          }}
          onCancel={() => setEditingFile(null)}
          onToast={addToast}
        />
      )}
    </div>
  );
}
