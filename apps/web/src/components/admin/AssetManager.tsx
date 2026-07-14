import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  getOverlayLibrary,
  uploadOverlayAsset,
  getOverlayAssets,
  deleteOverlayAsset,
  type OverlayAsset,
  type LocalOverlayAsset,
} from "@/lib/api";

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

// ─── Local Asset Gallery (uploaded directly via admin panel) ──────────────────

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
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete asset");
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

export interface AssetUploadFieldProps {
  type: "logo" | "banner";
  value: string | null;
  onChange: (url: string | null) => void;
  showError?: boolean;
  onError?: () => void;
}

export function AssetUploadField({ type, value, onChange, showError, onError }: AssetUploadFieldProps) {
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

export default AssetUploadField;
