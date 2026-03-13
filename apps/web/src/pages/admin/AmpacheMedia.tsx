import React, { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { Skeleton } from "@pnptv/ui-kit";
import {
  getAmpacheFiles,
  deleteAmpacheFile,
  getMediaLibraryVideos,
  syncVideoToMediaLibrary,
  toggleVideoPrime,
  type AmpacheFile,
  type MediaLibraryVideo,
} from "@/lib/api";
import { AmpacheEditFileDialog } from "@/components/admin/AmpacheEditFileDialog";
import { AmpacheUploadZone, type Category } from "@/components/admin/AmpacheUploadZone";
import { AmpacheFileList } from "@/components/admin/AmpacheFileList";
import { ConfirmModal } from "@/components/admin/ConfirmModal";

// ─── Constants ────────────────────────────────────────────────────────────────

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

  function handleUploadComplete() {
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
          <AmpacheUploadZone
            category={activeTab}
            accept={activeCategoryConfig.accept}
            hint={activeCategoryConfig.hint}
            onUploadComplete={handleUploadComplete}
            onToast={(msg) => addToast("success", msg)}
          />

          {/* File list */}
          <AmpacheFileList
            files={activeFiles}
            loading={loading}
            category={activeTab}
            onDelete={handleDeleteRequest}
            onEdit={(file) => setEditingFile(file)}
            mediaLibraryVideos={activeTab === "videos" ? mediaLibraryVideos : undefined}
            onTogglePrime={activeTab === "videos" ? handlePrimeToggle : undefined}
            primeTogglingFile={activeTab === "videos" ? primeTogglingFile : null}
          />
        </>
      )}

      {/* Delete confirm dialog */}
      <ConfirmModal
        open={pendingDelete !== null}
        title="Delete file?"
        message={
          pendingDelete
            ? `"${pendingDelete.name}" will be permanently removed from the media server.`
            : ""
        }
        confirmLabel="Delete"
        cancelLabel="Cancel"
        variant="danger"
        loading={deleting}
        onConfirm={handleDeleteConfirm}
        onCancel={() => setPendingDelete(null)}
      />

      {/* Edit file dialog */}
      {editingFile && (
        <AmpacheEditFileDialog
          file={editingFile}
          onClose={() => setEditingFile(null)}
          onSaved={(updated) => {
            setEditingFile(null);
            addToast("success", `"${updated.name}" saved.`);
            load();
          }}
        />
      )}
    </div>
  );
}
