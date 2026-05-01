import React, { useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { getMainStageState, type MainStageState } from "@/lib/api";
import { connectSocket } from "@/lib/socket";
import { useI18n } from "@/lib/i18n";

// Inline bilingual strings — same pattern as UploadVideoModal/ChannelVideoWizard.
const STR = {
  en: {
    label: "LIVE",
    prefix: "Main Stage is live",
    watch: "Watch →",
    ariaLabel: "Main Stage is live — tap to watch",
  },
  es: {
    label: "EN VIVO",
    prefix: "Main Stage está en vivo",
    watch: "Ver →",
    ariaLabel: "Main Stage está en vivo — toca para ver",
  },
} as const;

/**
 * Non-blocking "LIVE NOW" banner.
 *
 * Renders a slim, tappable row when Main Stage is actively broadcasting
 * (has cammers or is playing video/music media). Auto-hides when the user
 * is already on /main-stage.
 *
 * Mount below sticky headers, above primary page content on:
 *   Home · Live · Chat (Hangouts list only — not inside an active hangout)
 */
export function MainStageLiveBanner({ hideWhenGroup = false }: { hideWhenGroup?: boolean }) {
  const navigate = useNavigate();
  const location = useLocation();
  const i18n = useI18n();
  const s = STR[i18n.lang === "es" ? "es" : "en"];

  const [state, setState] = useState<MainStageState | null>(null);

  // Subscribe to socket updates + do an initial fetch.
  useEffect(() => {
    let cancelled = false;

    getMainStageState()
      .then((res) => { if (!cancelled) setState(res); })
      .catch(() => {});

    const socket = connectSocket();
    const onState = (payload: MainStageState) => {
      if (!cancelled) setState(payload);
    };
    socket.on("mainstage:state", onState);

    return () => {
      cancelled = true;
      socket.off("mainstage:state", onState);
    };
  }, []);

  // Hide when the user is already on /main-stage.
  const onMainStage = location.pathname === "/main-stage";

  // "Broadcasting" = has live cammers OR media (video/music) is playing.
  const cammers = state?.counts?.cammers ?? 0;
  const mediaPlaying =
    !!state?.media &&
    state.media.kind !== "off" &&
    state.media.playing &&
    !!state.media.src;
  const isBroadcasting = cammers > 0 || mediaPlaying;

  if (onMainStage || !isBroadcasting || hideWhenGroup) return null;

  const title = state?.media?.title ?? null;

  return (
    <button
      type="button"
      onClick={() => navigate("/main-stage")}
      aria-label={s.ariaLabel}
      className="w-full flex items-center gap-2.5 px-3 py-2.5 mb-4 rounded-xl glass-card-sm border border-pnp-accent/30 transition-opacity hover:opacity-90 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent focus-visible:ring-offset-2 focus-visible:ring-offset-pnp-background"
    >
      {/* Pulsing live dot */}
      <span className="relative flex-shrink-0 flex h-2 w-2" aria-hidden>
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-pnp-accent opacity-75" />
        <span className="relative inline-flex rounded-full h-2 w-2 bg-pnp-accent" />
      </span>

      {/* LIVE badge */}
      <span className="flex-shrink-0 text-[10px] font-bold uppercase tracking-[0.12em] text-pnp-accent">
        {s.label}
      </span>

      {/* Separator */}
      <span className="flex-shrink-0 text-pnp-textSecondary/40 text-xs" aria-hidden>·</span>

      {/* Status text + optional title */}
      <span className="flex-1 min-w-0 flex items-baseline gap-1.5 text-left">
        <span className="text-sm font-medium text-pnp-textPrimary truncate">
          {s.prefix}
        </span>
        {title && (
          <>
            <span className="flex-shrink-0 text-pnp-textSecondary/40 text-xs" aria-hidden>—</span>
            <span className="text-sm text-pnp-textSecondary truncate">{title}</span>
          </>
        )}
      </span>

      {/* Watch CTA */}
      <span className="flex-shrink-0 text-xs font-semibold text-pnp-accent whitespace-nowrap">
        {s.watch}
      </span>
    </button>
  );
}
