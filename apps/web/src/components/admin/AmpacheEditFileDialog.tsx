import React, { useState, useEffect, useRef } from "react";
import {
  renameAmpacheFile,
  getAmpacheFileTags,
  updateAmpacheFileTags,
  type AmpacheFile,
  type AmpacheFileTags,
} from "@/lib/api";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export { formatDate };

// ─── Props ────────────────────────────────────────────────────────────────────

export interface AmpacheEditFileDialogProps {
  file: AmpacheFile;
  onClose: () => void;
  onSaved: (updated: AmpacheFile) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function AmpacheEditFileDialog({ file, onClose, onSaved }: AmpacheEditFileDialogProps) {
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
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

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
        }
      }

      const updatedFile: AmpacheFile = {
        ...file,
        name: currentFileName,
      };
      onSaved(updatedFile);
    } catch (err) {
      // Re-throw so the parent can handle toasting if desired;
      // the dialog stays open on error so the user can retry.
      throw err;
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
        if (e.target === backdropRef.current) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-2xl bg-pnp-surface border border-pnp-border p-6 space-y-5 shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center gap-3">
          <div className="flex-shrink-0 w-10 h-10 rounded-full bg-pnp-accent/10 flex items-center justify-center">
            <svg
              className="w-5 h-5 text-pnp-accent"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
              />
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
              <span className="text-xs font-semibold text-pnp-textSecondary uppercase tracking-wider">
                Metadata
              </span>
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
                    onChange={(e) =>
                      setEditedTags((t) => ({
                        ...t,
                        year: e.target.value.replace(/\D/g, "").slice(0, 4),
                      }))
                    }
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
                      {Math.floor(tags.duration / 60)}:
                      {String(tags.duration % 60).padStart(2, "0")}
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
            onClick={onClose}
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
