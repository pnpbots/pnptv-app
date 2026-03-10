import React, { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Card, Button, Skeleton, Badge } from "@pnptv/ui-kit";
import {
  getStreamOverlays,
  updateStreamOverlay,
  getOverlayLibrary,
  uploadOverlayAsset,
  getOverlayAssets,
  deleteOverlayAsset,
  type StreamOverlay,
  type OverlayAsset,
  type LocalOverlayAsset,
} from "@/lib/api";
import { StreamOverlayLayer } from "@/components/StreamOverlayLayer";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function extractChannelName(channelRef: string): string {
  // e.g. "pnptv-santino" → "Pnptv Santino"
  return channelRef
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ─── Channel Card ─────────────────────────────────────────────────────────────

interface ChannelCardProps {
  overlay: StreamOverlay;
  onEdit: (overlay: StreamOverlay) => void;
}

function ChannelCard({ overlay, onEdit }: ChannelCardProps) {
  return (
    <Card className="flex flex-col gap-3 p-4">
      {/* Header row */}
      <div className="flex items-start justify-between gap-2 min-w-0">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-pnp-textPrimary truncate">
            {extractChannelName(overlay.channel_ref)}
          </p>
          <p className="text-xs text-pnp-textSecondary truncate mt-0.5">
            {overlay.channel_ref}
          </p>
        </div>
        <span
          className={`flex-shrink-0 px-2 py-0.5 rounded-full text-[10px] font-semibold ${
            overlay.is_active
              ? "bg-green-500/20 text-green-400"
              : "bg-pnp-surfaceHover text-pnp-textSecondary"
          }`}
        >
          {overlay.is_active ? "Active" : "Inactive"}
        </span>
      </div>

      {/* Logo preview */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-pnp-surfaceHover flex items-center justify-center flex-shrink-0 overflow-hidden">
          {overlay.logo_url ? (
            <img
              src={overlay.logo_url}
              alt="Logo"
              className="w-full h-full object-contain"
            />
          ) : (
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
                d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z"
              />
            </svg>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs text-pnp-textSecondary">
            {overlay.logo_url ? "Logo set" : "No logo"}
          </p>
          {overlay.banner_text ? (
            <p className="text-xs text-pnp-textPrimary truncate mt-0.5">
              "{overlay.banner_text}"
            </p>
          ) : (
            <p className="text-xs text-pnp-textSecondary/60 mt-0.5">
              No banner text
            </p>
          )}
        </div>
      </div>

      {/* Updated at */}
      <p className="text-[10px] text-pnp-textSecondary/60">
        Updated {formatDate(overlay.updated_at)}
      </p>

      {/* Edit button */}
      <button
        onClick={() => onEdit(overlay)}
        className="w-full min-h-[44px] rounded-lg bg-pnp-surfaceHover border border-pnp-border text-sm font-medium text-pnp-textPrimary hover:border-pnp-accent/40 hover:text-pnp-accent active:scale-[0.98] transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent focus-visible:ring-offset-2 focus-visible:ring-offset-pnp-background"
      >
        Edit Overlay
      </button>
    </Card>
  );
}

// ─── Slider field ─────────────────────────────────────────────────────────────

interface SliderFieldProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  displayValue?: string;
}

function SliderField({
  label,
  value,
  min,
  max,
  step,
  onChange,
  displayValue,
}: SliderFieldProps) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label className="text-xs font-medium text-pnp-textSecondary">
          {label}
        </label>
        <span className="text-xs text-pnp-textPrimary font-mono">
          {displayValue ?? value}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full h-2 rounded-full appearance-none bg-pnp-surfaceHover accent-pnp-accent cursor-pointer"
      />
    </div>
  );
}

// ─── Color field ─────────────────────────────────────────────────────────────

interface ColorFieldProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
}

function ColorField({ label, value, onChange }: ColorFieldProps) {
  return (
    <div>
      <label className="block text-xs font-medium text-pnp-textSecondary mb-1">
        {label}
      </label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-9 h-9 rounded-lg border border-pnp-border bg-pnp-surfaceHover cursor-pointer p-0.5"
        />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          maxLength={7}
          className="flex-1 rounded-lg bg-pnp-surface border border-pnp-border px-3 py-2 text-xs font-mono text-pnp-textPrimary placeholder-pnp-textSecondary focus:outline-none focus:ring-2 focus:ring-pnp-accent"
          placeholder="#000000"
        />
      </div>
    </div>
  );
}

// ─── Asset Library Picker ─────────────────────────────────────────────────────

interface AssetLibraryPickerProps {
  type: "logo" | "banner";
  onSelect: (asset: OverlayAsset) => void;
  onClose: () => void;
}

function AssetLibraryPicker({ type, onSelect, onClose }: AssetLibraryPickerProps) {
  const [assets, setAssets] = useState<OverlayAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterCategory, setFilterCategory] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    getOverlayLibrary(type)
      .then((res) => setAssets(res.assets || []))
      .catch((err) =>
        setError(err instanceof Error ? err.message : "Failed to load library")
      )
      .finally(() => setLoading(false));
  }, [type]);

  const categories = [
    ...new Set(assets.map((a) => a.category).filter(Boolean)),
  ] as string[];
  const filtered = filterCategory
    ? assets.filter((a) => a.category === filterCategory)
    : assets;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold text-pnp-textSecondary uppercase tracking-wider">
          {type === "logo" ? "Logo" : "Banner"} Library
        </h4>
        <button
          onClick={onClose}
          className="text-xs text-pnp-textSecondary hover:text-pnp-textPrimary transition-colors"
        >
          Close
        </button>
      </div>

      {categories.length > 0 && (
        <div className="flex gap-1.5 flex-wrap">
          <button
            onClick={() => setFilterCategory(null)}
            className={`px-2.5 py-1 rounded-full text-[10px] font-medium transition-colors ${
              !filterCategory
                ? "bg-pnp-accent/20 text-pnp-accent"
                : "bg-pnp-surfaceHover text-pnp-textSecondary hover:text-pnp-textPrimary"
            }`}
          >
            All
          </button>
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setFilterCategory(cat)}
              className={`px-2.5 py-1 rounded-full text-[10px] font-medium transition-colors capitalize ${
                filterCategory === cat
                  ? "bg-pnp-accent/20 text-pnp-accent"
                  : "bg-pnp-surfaceHover text-pnp-textSecondary hover:text-pnp-textPrimary"
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="aspect-square rounded-lg bg-pnp-surfaceHover animate-pulse"
            />
          ))}
        </div>
      ) : error ? (
        <p className="text-xs text-pnp-error py-4 text-center">{error}</p>
      ) : filtered.length === 0 ? (
        <p className="text-xs text-pnp-textSecondary py-4 text-center">
          No {type} assets found. Upload them in the CMS at cms.pnptv.app.
        </p>
      ) : (
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
          {filtered.map((asset) => (
            <button
              key={asset.id}
              onClick={() => onSelect(asset)}
              className="group relative aspect-square rounded-xl border border-pnp-border bg-pnp-surfaceHover overflow-hidden hover:border-pnp-accent/60 hover:ring-1 hover:ring-pnp-accent/30 active:scale-[0.96] transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent"
              title={asset.name}
            >
              {asset.image_url ? (
                <img
                  src={asset.image_url}
                  alt={asset.name}
                  className="w-full h-full object-contain p-2"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <span className="text-[10px] text-pnp-textSecondary">
                    No image
                  </span>
                </div>
              )}
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-2 py-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                <p className="text-[10px] text-white truncate">{asset.name}</p>
                {asset.category && (
                  <p className="text-[9px] text-white/60 truncate">
                    {asset.category}
                  </p>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Local Asset Gallery (uploaded directly via admin panel) ─────────────────

interface LocalAssetGalleryProps {
  type: "logo" | "banner";
  onSelect: (url: string) => void;
  onClose: () => void;
}

function LocalAssetGallery({ type, onSelect, onClose }: LocalAssetGalleryProps) {
  const [assets, setAssets] = useState<LocalOverlayAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    getOverlayAssets(type)
      .then((res) => setAssets(res.assets || []))
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, [type]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleDelete(asset: LocalOverlayAsset, e: React.MouseEvent) {
    e.stopPropagation();
    const dir = type === "logo" ? "logos" : "banners";
    setDeleting(asset.name);
    try {
      await deleteOverlayAsset(dir, asset.name);
      setAssets((prev) => prev.filter((a) => a.name !== asset.name));
    } catch {
      // silently ignore
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold text-pnp-textSecondary uppercase tracking-wider">
          Uploaded {type === "logo" ? "Logos" : "Banners"}
        </h4>
        <button
          onClick={onClose}
          className="text-xs text-pnp-textSecondary hover:text-pnp-textPrimary transition-colors"
        >
          Close
        </button>
      </div>
      {loading ? (
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="aspect-square rounded-lg bg-pnp-surfaceHover animate-pulse" />
          ))}
        </div>
      ) : error ? (
        <p className="text-xs text-pnp-error py-2 text-center">{error}</p>
      ) : assets.length === 0 ? (
        <p className="text-xs text-pnp-textSecondary py-4 text-center">
          No uploaded {type}s yet. Use the upload button above.
        </p>
      ) : (
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
          {assets.map((asset) => (
            <button
              key={asset.name}
              onClick={() => onSelect(asset.url)}
              className="group relative aspect-square rounded-xl border border-pnp-border bg-pnp-surfaceHover overflow-hidden hover:border-pnp-accent/60 hover:ring-1 hover:ring-pnp-accent/30 active:scale-[0.96] transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent"
              title={asset.name}
            >
              <img
                src={asset.url}
                alt={asset.name}
                className="w-full h-full object-contain p-2"
              />
              {/* Delete button on hover */}
              <button
                onClick={(e) => handleDelete(asset, e)}
                disabled={deleting === asset.name}
                aria-label={`Delete ${asset.name}`}
                className="absolute top-1 right-1 p-1 rounded-md bg-pnp-error/80 text-white opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-error"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-1.5 py-1 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                <p className="text-[9px] text-white truncate">{asset.name}</p>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Asset Upload Field ────────────────────────────────────────────────────────
// Wraps a URL input with an upload button + local gallery for a logo or banner field.

interface AssetUploadFieldProps {
  type: "logo" | "banner";
  value: string | null;
  onChange: (url: string | null) => void;
  showError?: boolean;
  onError?: () => void;
}

function AssetUploadField({ type, value, onChange, showError, onError }: AssetUploadFieldProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [showLocalGallery, setShowLocalGallery] = useState(false);
  const [showCmsLibrary, setShowCmsLibrary] = useState(false);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadError(null);
    try {
      const result = await uploadOverlayAsset(type, file);
      onChange(result.url);
      setShowLocalGallery(true);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  const accept = type === "logo"
    ? "image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
    : "image/png,image/jpeg,image/webp,image/gif";

  return (
    <div className="space-y-2">
      {/* URL display + upload trigger row */}
      <div className="flex items-center gap-2">
        <input
          type="url"
          readOnly
          value={value ?? ""}
          placeholder={`No ${type} selected`}
          className="flex-1 rounded-lg bg-pnp-surface border border-pnp-border px-3 py-2.5 text-sm text-pnp-textPrimary placeholder-pnp-textSecondary focus:outline-none focus:ring-2 focus:ring-pnp-accent transition-colors cursor-default"
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="flex-shrink-0 flex items-center gap-1.5 px-3 py-2.5 rounded-lg bg-pnp-surfaceHover border border-pnp-border text-xs font-medium text-pnp-textPrimary hover:border-pnp-accent/40 hover:text-pnp-accent active:scale-[0.97] transition-all disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent"
          aria-label="Upload new file"
        >
          {uploading ? (
            <span className="w-3.5 h-3.5 border-2 border-pnp-accent border-t-transparent rounded-full animate-spin" />
          ) : (
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
            </svg>
          )}
          Upload
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept={accept}
          onChange={handleFileChange}
          className="sr-only"
          aria-label={`Upload ${type} file`}
        />
      </div>

      {/* Upload error */}
      {uploadError && (
        <p className="text-xs text-pnp-error">{uploadError}</p>
      )}

      {/* Thumbnail preview */}
      {value && (
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-lg bg-pnp-surfaceHover flex items-center justify-center overflow-hidden border border-pnp-border flex-shrink-0">
            {!showError ? (
              <img
                src={value}
                alt={`${type} preview`}
                className="w-full h-full object-contain"
                onError={onError}
              />
            ) : (
              <span className="text-[10px] text-pnp-error text-center px-1">Load failed</span>
            )}
          </div>
          <button
            onClick={() => onChange(null)}
            className="text-xs text-pnp-error hover:underline"
          >
            Clear
          </button>
        </div>
      )}

      {/* Gallery/Library toggle buttons */}
      <div className="flex gap-2">
        <button
          onClick={() => { setShowLocalGallery(!showLocalGallery); setShowCmsLibrary(false); }}
          className="flex-1 py-2 rounded-lg border border-dashed border-pnp-border text-xs font-medium text-pnp-textSecondary hover:border-pnp-accent/40 hover:text-pnp-accent transition-colors"
        >
          {showLocalGallery ? "Hide Uploaded" : "Browse Uploaded"}
        </button>
        <button
          onClick={() => { setShowCmsLibrary(!showCmsLibrary); setShowLocalGallery(false); }}
          className="flex-1 py-2 rounded-lg border border-dashed border-pnp-border text-xs font-medium text-pnp-textSecondary hover:border-pnp-accent/40 hover:text-pnp-accent transition-colors"
        >
          {showCmsLibrary ? "Hide CMS Library" : "Browse CMS Library"}
        </button>
      </div>

      {/* Local uploaded gallery */}
      {showLocalGallery && (
        <div className="p-3 rounded-xl bg-pnp-background border border-pnp-border">
          <LocalAssetGallery
            type={type}
            onSelect={(url) => { onChange(url); setShowLocalGallery(false); }}
            onClose={() => setShowLocalGallery(false)}
          />
        </div>
      )}

      {/* CMS asset library picker */}
      {showCmsLibrary && (
        <div className="p-3 rounded-xl bg-pnp-background border border-pnp-border">
          <AssetLibraryPicker
            type={type}
            onSelect={(asset) => { onChange(asset.image_url); setShowCmsLibrary(false); }}
            onClose={() => setShowCmsLibrary(false)}
          />
        </div>
      )}
    </div>
  );
}

// ─── Overlay Editor Modal ─────────────────────────────────────────────────────

interface EditorModalProps {
  overlay: StreamOverlay;
  onClose: () => void;
  onSaved: (updated: StreamOverlay) => void;
}

function EditorModal({ overlay, onClose, onSaved }: EditorModalProps) {
  const [draft, setDraft] = useState<StreamOverlay>({ ...overlay });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [logoError, setLogoError] = useState(false);
  const backdropRef = useRef<HTMLDivElement>(null);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  // Prevent body scroll while modal is open
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  function set<K extends keyof StreamOverlay>(key: K, value: StreamOverlay[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    try {
      const { updateStreamOverlay: apiUpdate } = await import("@/lib/api");
      const res = await apiUpdate(draft.channel_ref, {
        logo_url: draft.logo_url,
        logo_position: draft.logo_position,
        logo_size: draft.logo_size,
        logo_opacity: draft.logo_opacity,
        banner_text: draft.banner_text,
        banner_position: draft.banner_position,
        banner_bg_color: draft.banner_bg_color,
        banner_text_color: draft.banner_text_color,
        banner_style: draft.banner_style,
        banner_image_url: draft.banner_image_url,
        is_active: draft.is_active,
      });
      onSaved(res.overlay);
    } catch (err) {
      setSaveError(
        err instanceof Error ? err.message : "Failed to save overlay"
      );
    } finally {
      setSaving(false);
    }
  }

  const overlayPreviewConfig = draft.is_active
    ? {
        logo_url: draft.logo_url,
        logo_position: draft.logo_position,
        logo_size: draft.logo_size,
        logo_opacity: draft.logo_opacity,
        banner_text: draft.banner_text,
        banner_image_url: draft.banner_image_url,
        banner_position: draft.banner_position,
        banner_bg_color: draft.banner_bg_color,
        banner_text_color: draft.banner_text_color,
        banner_style: draft.banner_style,
      }
    : null;

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 px-0 sm:px-4"
      onClick={(e) => {
        if (e.target === backdropRef.current) onClose();
      }}
    >
      <div className="relative w-full sm:max-w-2xl max-h-[96dvh] flex flex-col rounded-t-2xl sm:rounded-2xl bg-pnp-surface border border-pnp-border overflow-hidden">
        {/* Modal header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-pnp-border flex-shrink-0">
          <div>
            <h2 className="text-base font-bold text-pnp-textPrimary">
              {extractChannelName(overlay.channel_ref)}
            </h2>
            <p className="text-xs text-pnp-textSecondary mt-0.5">
              {overlay.channel_ref}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close editor"
            className="p-2 rounded-lg text-pnp-textSecondary hover:text-pnp-textPrimary hover:bg-pnp-surfaceHover transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-6">
          {/* Live Preview — 16:9 mock player */}
          <section>
            <h3 className="text-xs font-semibold text-pnp-textSecondary uppercase tracking-wider mb-2">
              Live Preview
            </h3>
            <div
              className="relative w-full rounded-xl overflow-hidden bg-black"
              style={{ aspectRatio: "16/9" }}
            >
              {/* Mock video background */}
              <div className="absolute inset-0 flex items-center justify-center">
                <svg
                  className="w-16 h-16 text-white/10"
                  fill="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path d="M8 5v14l11-7z" />
                </svg>
              </div>
              {/* Actual overlay preview */}
              <StreamOverlayLayer overlay={overlayPreviewConfig} />
              {/* Overlay inactive hint */}
              {!draft.is_active && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="px-3 py-1.5 rounded-full bg-black/60 text-white/60 text-xs">
                    Overlay disabled
                  </span>
                </div>
              )}
            </div>
          </section>

          {/* Active toggle */}
          <section className="flex items-center justify-between py-3 px-4 rounded-xl bg-pnp-background border border-pnp-border">
            <div>
              <p className="text-sm font-medium text-pnp-textPrimary">
                Enable Overlay
              </p>
              <p className="text-xs text-pnp-textSecondary mt-0.5">
                Show logo and banner on this stream
              </p>
            </div>
            <button
              role="switch"
              aria-checked={draft.is_active}
              onClick={() => set("is_active", !draft.is_active)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent focus-visible:ring-offset-2 focus-visible:ring-offset-pnp-surface ${
                draft.is_active ? "bg-pnp-accent" : "bg-pnp-surfaceHover"
              }`}
            >
              <span
                className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
                  draft.is_active ? "translate-x-6" : "translate-x-1"
                }`}
              />
            </button>
          </section>

          {/* Logo section */}
          <section>
            <h3 className="text-xs font-semibold text-pnp-textSecondary uppercase tracking-wider mb-3">
              Logo
            </h3>
            <div className="space-y-4">
              {/* Logo URL + upload + gallery */}
              <div>
                <label className="block text-xs font-medium text-pnp-textSecondary mb-1">
                  Logo Image
                </label>
                <AssetUploadField
                  type="logo"
                  value={draft.logo_url ?? null}
                  onChange={(url) => {
                    set("logo_url", url);
                    setLogoError(false);
                  }}
                  showError={logoError}
                  onError={() => setLogoError(true)}
                />
              </div>

              {/* Logo position */}
              <div>
                <label className="block text-xs font-medium text-pnp-textSecondary mb-1">
                  Position
                </label>
                <select
                  value={draft.logo_position}
                  onChange={(e) => set("logo_position", e.target.value)}
                  className="w-full rounded-lg bg-pnp-surface border border-pnp-border px-3 py-2.5 text-sm text-pnp-textPrimary focus:outline-none focus:ring-2 focus:ring-pnp-accent transition-colors appearance-none"
                >
                  <option value="top-left">Top Left</option>
                  <option value="top-right">Top Right</option>
                  <option value="bottom-left">Bottom Left</option>
                  <option value="bottom-right">Bottom Right</option>
                </select>
              </div>

              {/* Logo size */}
              <SliderField
                label="Size (px)"
                value={draft.logo_size}
                min={20}
                max={200}
                step={4}
                onChange={(v) => set("logo_size", v)}
                displayValue={`${draft.logo_size}px`}
              />

              {/* Logo opacity */}
              <SliderField
                label="Opacity"
                value={draft.logo_opacity}
                min={0}
                max={1}
                step={0.05}
                onChange={(v) => set("logo_opacity", v)}
                displayValue={Math.round(draft.logo_opacity * 100) + "%"}
              />
            </div>
          </section>

          {/* Banner section */}
          <section>
            <h3 className="text-xs font-semibold text-pnp-textSecondary uppercase tracking-wider mb-3">
              Banner
            </h3>
            <div className="space-y-4">
              {/* Banner text */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-medium text-pnp-textSecondary">
                    Banner Text
                  </label>
                  <span className="text-[10px] text-pnp-textSecondary/60">
                    {(draft.banner_text ?? "").length}/200
                  </span>
                </div>
                <textarea
                  value={draft.banner_text ?? ""}
                  onChange={(e) =>
                    set("banner_text", e.target.value.slice(0, 200) || null)
                  }
                  placeholder="Welcome to the stream! Follow us on social media."
                  rows={2}
                  maxLength={200}
                  className="w-full rounded-lg bg-pnp-surface border border-pnp-border px-3 py-2.5 text-sm text-pnp-textPrimary placeholder-pnp-textSecondary focus:outline-none focus:ring-2 focus:ring-pnp-accent transition-colors resize-none"
                />
              </div>

              {/* Banner image URL + upload + gallery */}
              <div>
                <label className="block text-xs font-medium text-pnp-textSecondary mb-1">
                  Banner Image (PNG/GIF)
                </label>
                <AssetUploadField
                  type="banner"
                  value={draft.banner_image_url ?? null}
                  onChange={(url) => set("banner_image_url", url)}
                />
                <p className="text-[10px] text-pnp-textSecondary/60 mt-1">
                  Image banner takes priority over text banner when both are set.
                </p>
              </div>

              {/* Banner position */}
              <div>
                <label className="block text-xs font-medium text-pnp-textSecondary mb-1.5">
                  Position
                </label>
                <div className="flex gap-3">
                  {(["top", "bottom"] as const).map((pos) => (
                    <label
                      key={pos}
                      className={`flex items-center gap-2 flex-1 px-3 py-2.5 rounded-lg border cursor-pointer transition-colors ${
                        draft.banner_position === pos
                          ? "border-pnp-accent bg-pnp-accent/10 text-pnp-accent"
                          : "border-pnp-border text-pnp-textSecondary hover:border-pnp-accent/40"
                      }`}
                    >
                      <input
                        type="radio"
                        name="banner_position"
                        value={pos}
                        checked={draft.banner_position === pos}
                        onChange={() => set("banner_position", pos)}
                        className="sr-only"
                      />
                      <span className="text-sm capitalize">{pos}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Banner style */}
              <div>
                <label className="block text-xs font-medium text-pnp-textSecondary mb-1.5">
                  Style
                </label>
                <div className="flex gap-3">
                  {(
                    [
                      { value: "static", label: "Static" },
                      { value: "scroll", label: "Scrolling" },
                    ] as const
                  ).map(({ value, label }) => (
                    <label
                      key={value}
                      className={`flex items-center gap-2 flex-1 px-3 py-2.5 rounded-lg border cursor-pointer transition-colors ${
                        draft.banner_style === value
                          ? "border-pnp-accent bg-pnp-accent/10 text-pnp-accent"
                          : "border-pnp-border text-pnp-textSecondary hover:border-pnp-accent/40"
                      }`}
                    >
                      <input
                        type="radio"
                        name="banner_style"
                        value={value}
                        checked={draft.banner_style === value}
                        onChange={() => set("banner_style", value)}
                        className="sr-only"
                      />
                      <span className="text-sm">{label}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Colors */}
              <div className="grid grid-cols-2 gap-3">
                <ColorField
                  label="Background Color"
                  value={draft.banner_bg_color}
                  onChange={(v) => set("banner_bg_color", v)}
                />
                <ColorField
                  label="Text Color"
                  value={draft.banner_text_color}
                  onChange={(v) => set("banner_text_color", v)}
                />
              </div>

              {/* Banner style preview strip */}
              {draft.banner_text && (
                <div className="rounded-lg overflow-hidden">
                  <p className="text-[10px] text-pnp-textSecondary mb-1.5">
                    Banner preview
                  </p>
                  <div
                    className="overflow-hidden py-2 px-3"
                    style={{ backgroundColor: draft.banner_bg_color }}
                  >
                    <span
                      style={{
                        color: draft.banner_text_color,
                        fontSize: 13,
                        display:
                          draft.banner_style === "scroll" ? "inline-block" : "block",
                        textAlign:
                          draft.banner_style === "static" ? "center" : undefined,
                      }}
                    >
                      {draft.banner_text}
                    </span>
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* Error message */}
          {saveError && (
            <p className="text-sm text-pnp-error bg-pnp-error/10 rounded-lg px-4 py-3">
              {saveError}
            </p>
          )}
        </div>

        {/* Footer actions */}
        <div className="flex items-center gap-3 px-5 py-4 border-t border-pnp-border flex-shrink-0">
          <button
            onClick={onClose}
            className="flex-1 min-h-[44px] rounded-xl border border-pnp-border text-sm font-medium text-pnp-textSecondary hover:text-pnp-textPrimary hover:border-pnp-accent/40 active:scale-[0.98] transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent focus-visible:ring-offset-2 focus-visible:ring-offset-pnp-surface"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 min-h-[44px] rounded-xl btn-gradient text-white text-sm font-semibold active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent focus-visible:ring-offset-2 focus-visible:ring-offset-pnp-surface"
          >
            {saving ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Saving...
              </span>
            ) : (
              "Save Changes"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function StreamManagement() {
  const { isAdmin, isLoading: authLoading } = useAuth();
  const navigate = useNavigate();

  const [overlays, setOverlays] = useState<StreamOverlay[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<StreamOverlay | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    return getStreamOverlays()
      .then((res) => setOverlays(res.overlays || []))
      .catch((err) =>
        setError(
          err instanceof Error ? err.message : "Failed to load stream overlays"
        )
      )
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!authLoading && isAdmin) {
      load();
    }
  }, [authLoading, isAdmin, load]);

  function handleSaved(updated: StreamOverlay) {
    setOverlays((prev) =>
      prev.map((o) => (o.channel_ref === updated.channel_ref ? updated : o))
    );
    setEditing(null);
    setSuccessMsg(`Overlay for "${updated.channel_ref}" saved.`);
    setTimeout(() => setSuccessMsg(null), 3000);
  }

  // Auth guard (AdminLayout already handles this, but double-check)
  if (authLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-64 rounded-xl" />
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-52 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-pnp-textPrimary">
            Stream Management
          </h1>
          <p className="text-sm text-pnp-textSecondary mt-1">
            Manage overlays and branding for live streams
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          aria-label="Refresh overlays"
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

      {/* Success toast */}
      {successMsg && (
        <div
          role="status"
          aria-live="polite"
          className="px-4 py-3 rounded-xl bg-green-500/10 border border-green-500/30 text-sm text-green-400"
        >
          {successMsg}
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="rounded-xl bg-pnp-surface border border-pnp-border p-4 space-y-3 animate-pulse"
            >
              <div className="flex items-center justify-between">
                <div className="h-4 w-32 rounded bg-pnp-surfaceHover" />
                <div className="h-4 w-14 rounded-full bg-pnp-surfaceHover" />
              </div>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-pnp-surfaceHover flex-shrink-0" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3 w-20 rounded bg-pnp-surfaceHover" />
                  <div className="h-3 w-32 rounded bg-pnp-surfaceHover" />
                </div>
              </div>
              <div className="h-3 w-24 rounded bg-pnp-surfaceHover" />
              <div className="h-10 rounded-lg bg-pnp-surfaceHover" />
            </div>
          ))}
        </div>
      )}

      {/* Error state */}
      {!loading && error && (
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
          <p className="text-pnp-textPrimary font-medium mb-1">
            Failed to load stream overlays
          </p>
          <p className="text-sm text-pnp-textSecondary mb-4">{error}</p>
          <button
            onClick={load}
            className="px-5 py-2.5 min-h-[44px] rounded-xl btn-gradient text-white text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent focus-visible:ring-offset-2 focus-visible:ring-offset-pnp-background"
          >
            Try Again
          </button>
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && overlays.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-12 h-12 rounded-full bg-pnp-surfaceHover flex items-center justify-center mb-4">
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
                d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
              />
            </svg>
          </div>
          <p className="text-pnp-textPrimary font-medium mb-1">
            No stream channels found
          </p>
          <p className="text-sm text-pnp-textSecondary">
            Channels will appear here once they are registered in the system.
          </p>
        </div>
      )}

      {/* Channel grid */}
      {!loading && !error && overlays.length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
          {overlays.map((overlay) => (
            <ChannelCard
              key={overlay.channel_ref}
              overlay={overlay}
              onEdit={setEditing}
            />
          ))}
        </div>
      )}

      {/* Editor Modal */}
      {editing && (
        <EditorModal
          overlay={editing}
          onClose={() => setEditing(null)}
          onSaved={handleSaved}
        />
      )}
    </div>
  );
}
