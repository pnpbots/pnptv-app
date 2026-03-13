import React, { useState, useEffect, useRef } from "react";
import {
  updateStreamOverlay,
  type StreamOverlay,
} from "@/lib/api";
import { StreamOverlayLayer } from "@/components/StreamOverlayLayer";
import { AssetUploadField } from "@/components/admin/AssetManager";

// ─── Local helper (mirrors the one in StreamManagement for display in header) ─

function extractChannelName(channelRef: string): string {
  return channelRef
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// ─── Slider Field ──────────────────────────────────────────────────────────────

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

// ─── Color Field ──────────────────────────────────────────────────────────────

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

// ─── Overlay Editor Modal ─────────────────────────────────────────────────────

export interface OverlayEditorModalProps {
  overlay: StreamOverlay;
  onClose: () => void;
  onSaved: (updated: StreamOverlay) => void;
}

export function OverlayEditorModal({ overlay, onClose, onSaved }: OverlayEditorModalProps) {
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
      const res = await updateStreamOverlay(draft.channel_ref, {
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

export default OverlayEditorModal;
