/**
 * ForwardTargetPicker — bottom-sheet picker for forwarding a message to one or
 * more DM partners and/or hangouts. Shared between DM forward and hangout
 * message forward flows (DM↔hangout parity).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getHangoutGroups,
  getDmThreads,
  type HangoutGroup,
  type MessageThread,
  type ForwardTarget,
} from "@/lib/api";

const MAX_TARGETS = 10;
const MAX_NOTE = 500;

export interface ForwardSourcePreview {
  authorName?: string | null;
  authorPhoto?: string | null;
  text?: string | null;
  mediaUrl?: string | null;
  mediaType?: string | null;
  mediaThumbUrl?: string | null;
}

export interface ForwardTargetPickerProps {
  isOpen: boolean;
  onClose: () => void;
  onForward: (targets: ForwardTarget[], note?: string) => Promise<void>;
  title?: string;
  subtitle?: string;
  sourcePreview?: ForwardSourcePreview;
}

type Tab = "recents" | "dms" | "hangouts";

function isValidPhotoUrl(url: string | null | undefined): url is string {
  return !!url && (url.startsWith("/uploads/") || url.startsWith("http"));
}

function targetKey(t: ForwardTarget): string {
  return t.type === "dm" ? `dm:${t.userId}` : `hangout:${t.groupId}`;
}

export function ForwardTargetPicker({
  isOpen,
  onClose,
  onForward,
  title = "Forward to",
  subtitle,
  sourcePreview,
}: ForwardTargetPickerProps) {
  const [tab, setTab] = useState<Tab>("recents");
  const [loading, setLoading] = useState(false);
  const [dms, setDms] = useState<MessageThread[]>([]);
  const [hangouts, setHangouts] = useState<HangoutGroup[]>([]);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<ForwardTarget[]>([]);
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const firstTabRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setSelected([]);
    setNote("");
    setSearch("");
    setTab("recents");

    Promise.all([getDmThreads(), getHangoutGroups()])
      .then(([dmRes, hRes]) => {
        if (cancelled) return;
        setDms(dmRes.threads || []);
        setHangouts(hRes.groups || []);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load targets");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => firstTabRef.current?.focus(), 50);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [isOpen, onClose]);

  const isSelected = useCallback(
    (t: ForwardTarget) => selected.some((s) => targetKey(s) === targetKey(t)),
    [selected]
  );

  const toggle = useCallback((t: ForwardTarget) => {
    setSelected((prev) => {
      const k = targetKey(t);
      const has = prev.some((s) => targetKey(s) === k);
      if (has) return prev.filter((s) => targetKey(s) !== k);
      if (prev.length >= MAX_TARGETS) return prev;
      return [...prev, t];
    });
  }, []);

  const q = search.trim().toLowerCase();

  const filteredDms = useMemo(
    () =>
      q
        ? dms.filter((d) => (d.partnerFirstName || d.partnerUsername || "").toLowerCase().includes(q))
        : dms,
    [dms, q]
  );

  const filteredHangouts = useMemo(
    () => (q ? hangouts.filter((g) => g.name.toLowerCase().includes(q)) : hangouts),
    [hangouts, q]
  );

  const recents = useMemo(() => {
    const dmRecents: Array<{ target: ForwardTarget; label: string; avatar: string | null }> =
      filteredDms.slice(0, 6).map((d) => ({
        target: { type: "dm", userId: d.partnerId },
        label: d.partnerFirstName || d.partnerUsername || "User",
        avatar: d.partnerPhoto,
      }));
    const hRecents: Array<{ target: ForwardTarget; label: string; avatar: string | null }> =
      filteredHangouts.slice(0, 6).map((g) => ({
        target: { type: "hangout", groupId: g.id },
        label: g.name,
        avatar: g.avatarUrl,
      }));
    const mix: typeof dmRecents = [];
    const len = Math.max(dmRecents.length, hRecents.length);
    for (let i = 0; i < len && mix.length < 10; i++) {
      if (dmRecents[i]) mix.push(dmRecents[i]);
      if (hRecents[i] && mix.length < 10) mix.push(hRecents[i]);
    }
    return mix;
  }, [filteredDms, filteredHangouts]);

  const handleSubmit = useCallback(async () => {
    if (selected.length === 0 || sending) return;
    setSending(true);
    setError(null);
    try {
      await onForward(selected, note || undefined);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Forward failed");
    }
    setSending(false);
  }, [selected, note, sending, onForward, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center"
      style={{ background: "rgba(0,0,0,0.65)", backdropFilter: "blur(6px)" }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className="w-full max-w-lg rounded-t-2xl p-5 pb-8 space-y-3"
        style={{ background: "var(--pnp-surface, #1C1C1E)", border: "1px solid rgba(255,255,255,0.08)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-center mb-1" aria-hidden="true">
          <div className="w-10 h-1 rounded-full" style={{ background: "rgba(255,255,255,0.15)" }} />
        </div>

        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-white">{title}</h2>
            {subtitle && <p className="text-xs" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-7 h-7 rounded-full flex items-center justify-center transition-colors hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
            style={{ background: "rgba(255,255,255,0.08)" }}
            aria-label="Close"
          >
            <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {sourcePreview && (() => {
          const thumb =
            sourcePreview.mediaThumbUrl ||
            (sourcePreview.mediaType === "image" || sourcePreview.mediaType === "video"
              ? sourcePreview.mediaUrl
              : null);
          const isVideo = sourcePreview.mediaType === "video";
          const hasThumb = !!thumb;
          const snippet = (sourcePreview.text || "").slice(0, 120);
          const author = sourcePreview.authorName || "User";
          return (
            <div
              className="flex items-center gap-2 rounded-lg p-2"
              style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
            >
              {hasThumb && (
                <div
                  className="relative w-12 h-12 rounded-md overflow-hidden flex-shrink-0"
                  style={{ background: "rgba(0,0,0,0.4)" }}
                >
                  {isVideo ? (
                    <video src={thumb!} className="w-full h-full object-cover" muted playsInline preload="metadata" />
                  ) : (
                    <img src={thumb!} alt="" className="w-full h-full object-cover" />
                  )}
                  {isVideo && (
                    <span className="absolute inset-0 flex items-center justify-center pointer-events-none">
                      <span className="w-5 h-5 rounded-full flex items-center justify-center" style={{ background: "rgba(0,0,0,0.55)" }}>
                        <svg className="w-2.5 h-2.5 text-white" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>
                      </span>
                    </span>
                  )}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-semibold" style={{ color: "#5ED1C4" }}>📎 {author}</p>
                {snippet ? (
                  <p className="text-xs text-white/80 line-clamp-2 mt-0.5">{snippet}</p>
                ) : (
                  <p className="text-xs text-white/60 mt-0.5">
                    {sourcePreview.mediaType === "image"
                      ? "Photo"
                      : sourcePreview.mediaType === "video"
                      ? "Video"
                      : sourcePreview.mediaType === "audio"
                      ? "Voice message"
                      : "Message"}
                  </p>
                )}
              </div>
            </div>
          );
        })()}

        <div className="flex gap-1 p-1 rounded-lg" style={{ background: "rgba(255,255,255,0.04)" }}>
          <button
            ref={firstTabRef}
            type="button"
            onClick={() => setTab("recents")}
            className="flex-1 py-1.5 text-xs font-semibold rounded-md transition-colors"
            style={tab === "recents" ? { background: "#D4007A", color: "#fff" } : { background: "transparent", color: "var(--pnp-text-secondary, #8E8E93)" }}
          >
            Recent
          </button>
          <button
            type="button"
            onClick={() => setTab("dms")}
            className="flex-1 py-1.5 text-xs font-semibold rounded-md transition-colors"
            style={tab === "dms" ? { background: "#D4007A", color: "#fff" } : { background: "transparent", color: "var(--pnp-text-secondary, #8E8E93)" }}
          >
            DMs
          </button>
          <button
            type="button"
            onClick={() => setTab("hangouts")}
            className="flex-1 py-1.5 text-xs font-semibold rounded-md transition-colors"
            style={tab === "hangouts" ? { background: "#D4007A", color: "#fff" } : { background: "transparent", color: "var(--pnp-text-secondary, #8E8E93)" }}
          >
            Hangouts
          </button>
        </div>

        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search people & hangouts…"
          aria-label="Search forward targets"
          className="w-full text-sm text-white rounded-lg px-3 py-2 outline-none"
          style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
        />

        <div className="max-h-[40vh] overflow-y-auto space-y-1" role="listbox" aria-multiselectable="true">
          {loading ? (
            <div className="flex items-center gap-2 py-4 px-1">
              <svg className="w-4 h-4 animate-spin" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }} fill="none" viewBox="0 0 24 24" aria-hidden="true">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              <span className="text-xs" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>Loading…</span>
            </div>
          ) : error ? (
            <p className="text-xs py-3" style={{ color: "#FF453A" }}>{error}</p>
          ) : tab === "recents" ? (
            recents.length === 0 ? (
              <p className="text-xs py-4 text-center" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>No recent conversations.</p>
            ) : (
              recents.map(({ target, label, avatar }) => (
                <TargetRow
                  key={targetKey(target)}
                  label={label}
                  subtitle={target.type === "dm" ? "Direct message" : "Hangout"}
                  avatar={avatar}
                  icon={target.type}
                  checked={isSelected(target)}
                  disabled={!isSelected(target) && selected.length >= MAX_TARGETS}
                  onToggle={() => toggle(target)}
                />
              ))
            )
          ) : tab === "dms" ? (
            filteredDms.length === 0 ? (
              <p className="text-xs py-4 text-center" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>No DM contacts.</p>
            ) : (
              filteredDms.map((d) => {
                const target: ForwardTarget = { type: "dm", userId: d.partnerId };
                return (
                  <TargetRow
                    key={targetKey(target)}
                    label={d.partnerFirstName || d.partnerUsername || "User"}
                    subtitle={d.partnerUsername ? `@${d.partnerUsername}` : undefined}
                    avatar={d.partnerPhoto}
                    icon="dm"
                    checked={isSelected(target)}
                    disabled={!isSelected(target) && selected.length >= MAX_TARGETS}
                    onToggle={() => toggle(target)}
                  />
                );
              })
            )
          ) : filteredHangouts.length === 0 ? (
            <p className="text-xs py-4 text-center" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>No hangouts.</p>
          ) : (
            filteredHangouts.map((g) => {
              const target: ForwardTarget = { type: "hangout", groupId: g.id };
              return (
                <TargetRow
                  key={targetKey(target)}
                  label={g.name}
                  subtitle={g.description || undefined}
                  avatar={g.avatarUrl}
                  icon="hangout"
                  checked={isSelected(target)}
                  disabled={!isSelected(target) && selected.length >= MAX_TARGETS}
                  onToggle={() => toggle(target)}
                />
              );
            })
          )}
        </div>

        <div>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value.slice(0, MAX_NOTE))}
            rows={2}
            placeholder="Add a message (optional)"
            aria-label="Optional note to send with the forward"
            className="w-full text-sm text-white rounded-lg px-3 py-2 outline-none resize-none"
            style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
          />
          <div className="flex justify-between text-[10px] mt-0.5 px-1" style={{ color: "#555" }}>
            <span>{selected.length}/{MAX_TARGETS} selected</span>
            <span>{note.length}/{MAX_NOTE}</span>
          </div>
        </div>

        <button
          type="button"
          onClick={handleSubmit}
          disabled={selected.length === 0 || sending}
          className="w-full py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-40 disabled:cursor-not-allowed transition-all active:scale-[0.98]"
          style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
        >
          {sending ? "Sending…" : selected.length === 0 ? "Select a destination" : `Forward to ${selected.length}`}
        </button>
      </div>
    </div>
  );
}

interface TargetRowProps {
  label: string;
  subtitle?: string;
  avatar: string | null;
  icon: "dm" | "hangout";
  checked: boolean;
  disabled: boolean;
  onToggle: () => void;
}

function TargetRow({ label, subtitle, avatar, icon, checked, disabled, onToggle }: TargetRowProps) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={checked}
      aria-disabled={disabled}
      onClick={onToggle}
      disabled={disabled}
      className="w-full flex items-center gap-2.5 p-2 rounded-lg transition-all active:scale-[0.99] disabled:opacity-40 disabled:cursor-not-allowed"
      style={
        checked
          ? { background: "rgba(212,0,122,0.12)", border: "1px solid rgba(212,0,122,0.35)" }
          : { background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }
      }
    >
      {isValidPhotoUrl(avatar) ? (
        <img src={avatar} alt="" className="w-9 h-9 rounded-lg object-cover flex-shrink-0" />
      ) : (
        <div
          className="w-9 h-9 rounded-lg flex items-center justify-center text-xs font-bold flex-shrink-0"
          style={{ background: "linear-gradient(135deg, #D4007A, #E69138)", color: "#fff" }}
        >
          {label.charAt(0).toUpperCase()}
        </div>
      )}
      <div className="flex-1 min-w-0 text-left">
        <div className="flex items-center gap-1.5">
          <p className="text-sm font-medium text-white truncate">{label}</p>
          {icon === "hangout" && (
            <span
              className="text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded"
              style={{ background: "rgba(123,97,255,0.15)", color: "#7B61FF" }}
            >
              Hangout
            </span>
          )}
        </div>
        {subtitle && (
          <p className="text-xs truncate" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>
            {subtitle}
          </p>
        )}
      </div>
      <div
        className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0"
        style={
          checked
            ? { background: "#D4007A" }
            : { background: "transparent", border: "1.5px solid rgba(255,255,255,0.25)" }
        }
        aria-hidden="true"
      >
        {checked && (
          <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        )}
      </div>
    </button>
  );
}
