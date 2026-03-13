import React from "react";
import { type AmpacheFile, type MediaLibraryVideo } from "@/lib/api";
import { type Category } from "./AmpacheUploadZone";

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / Math.pow(1024, i);
  return `${value % 1 === 0 ? value : value.toFixed(1)} ${units[i]}`;
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ─── Props ────────────────────────────────────────────────────────────────────

export interface AmpacheFileListProps {
  files: AmpacheFile[];
  loading: boolean;
  category: Category;
  onDelete: (file: AmpacheFile) => void;
  onEdit: (file: AmpacheFile) => void;
  onSync?: (file: AmpacheFile) => void;
  onTogglePrime?: (file: AmpacheFile) => void;
  /** Internal — passed down from the page to track which video file maps to a
   *  MediaLibraryVideo record (needed for the Prime toggle) */
  mediaLibraryVideos?: MediaLibraryVideo[];
  /** Internal — the filename currently being prime-toggled */
  primeTogglingFile?: string | null;
}

// ─── FileRow (desktop table row) ──────────────────────────────────────────────

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
            <span
              className="text-sm text-pnp-textPrimary truncate max-w-xs"
              title={file.name}
            >
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
              aria-label={
                isPrime ? `Remove Prime from ${file.name}` : `Mark ${file.name} as Prime`
              }
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
                <svg
                  className="w-4 h-4"
                  fill={isPrime ? "currentColor" : "none"}
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z"
                  />
                </svg>
              )}
            </button>
          )}
          <button
            onClick={() => onEdit(file)}
            aria-label={`Edit ${file.name}`}
            className="p-2 rounded-lg text-pnp-textSecondary hover:text-pnp-accent hover:bg-pnp-accent/10 active:scale-[0.96] transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent opacity-0 group-hover:opacity-100"
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
                d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
              />
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

// ─── FileCard (mobile) ────────────────────────────────────────────────────────

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
            aria-label={
              isPrime ? `Remove Prime from ${file.name}` : `Mark ${file.name} as Prime`
            }
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
              <svg
                className="w-4 h-4"
                fill={isPrime ? "currentColor" : "none"}
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z"
                />
              </svg>
            )}
          </button>
        )}
        <button
          onClick={() => onEdit(file)}
          aria-label={`Edit ${file.name}`}
          className="p-2 rounded-lg text-pnp-textSecondary hover:text-pnp-accent hover:bg-pnp-accent/10 active:scale-[0.96] transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent"
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
              d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
            />
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

// ─── AmpacheFileList (main export) ────────────────────────────────────────────

export function AmpacheFileList({
  files,
  loading,
  category,
  onDelete,
  onEdit,
  mediaLibraryVideos,
  primeTogglingFile,
  onTogglePrime,
}: AmpacheFileListProps & {
  /** Raw prime-toggle handler — forwarded from the page which holds MediaLibraryVideo state */
  onTogglePrime?: (file: AmpacheFile, currentRecord: MediaLibraryVideo | null) => void;
}) {
  if (loading) {
    return (
      <div className="space-y-2 mt-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-12 rounded-xl bg-pnp-surfaceHover animate-pulse" />
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
        <p className="text-xs text-pnp-textSecondary mt-1">Upload files using the drop zone above.</p>
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
                onPrimeToggle={category === "videos" ? onTogglePrime : undefined}
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
            onPrimeToggle={category === "videos" ? onTogglePrime : undefined}
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
