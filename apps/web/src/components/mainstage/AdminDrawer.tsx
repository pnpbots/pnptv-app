import { useCallback, useEffect, useRef, useState } from "react";
import { useFocusTrap } from "@/lib/useFocusTrap";
import { useI18n } from "@/lib/i18n";
import { useMainStage } from "@/hooks/useMainStage";
import { getFeaturedPrimeVideos, getAssetUrl, type PrimeVideo } from "@/lib/directus";
import InvitePanel from "@/components/mainstage/InvitePanel";
import type { MainStageState } from "@/hooks/useMainStage";
import type { CammerInfo } from "@/components/mainstage/ParticipantCollector";

export type ModeId = "spotlight" | "theater" | "cinema" | "karaoke" | "equal";

type AdminType = ReturnType<typeof useMainStage>["admin"];

const MODE_ICONS_ADMIN: Record<ModeId, JSX.Element> = {
  spotlight: (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <circle cx="12" cy="10" r="4" />
      <path strokeLinecap="round" d="M12 14v5M8 19h8" />
    </svg>
  ),
  theater: (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 5v14M20 5v14M4 7c2 0 4 2 4 4s-2 4-4 4M20 7c-2 0-4 2-4 4s2 4 4 4M9 12h6" />
    </svg>
  ),
  cinema: (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path strokeLinecap="round" d="M8 10l4 2.5L8 15z" fill="currentColor" />
    </svg>
  ),
  karaoke: (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <rect x="3" y="5" width="18" height="12" rx="1.5" />
      <circle cx="17" cy="15" r="3" fill="currentColor" />
    </svg>
  ),
  equal: (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  ),
};

// Two-slider audio mix for the admin panel. Values are committed on
// pointer-up / blur to avoid spamming the API on every drag tick. Local
// optimistic state keeps the slider responsive even before the server
// broadcast catches up.
function AudioMixControls({
  mediaVolume,
  camsVolume,
  onSetMediaVolume,
  onSetCamsVolume,
}: {
  mediaVolume: number;
  camsVolume: number;
  onSetMediaVolume: (v: number) => void;
  onSetCamsVolume: (v: number) => void;
}) {
  const t = useI18n();
  const [localMedia, setLocalMedia] = useState(mediaVolume);
  const [localCams, setLocalCams] = useState(camsVolume);

  // Sync from server when not actively dragging.
  const draggingRef = useRef<"media" | "cams" | null>(null);
  useEffect(() => {
    if (draggingRef.current !== "media") setLocalMedia(mediaVolume);
  }, [mediaVolume]);
  useEffect(() => {
    if (draggingRef.current !== "cams") setLocalCams(camsVolume);
  }, [camsVolume]);

  return (
    <div className="space-y-3">
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label htmlFor="ms-vol-media" className="text-[11px] font-semibold text-white/80">
            {t.live.mainStageAdminAudioMedia}
          </label>
          <span className="text-[11px] text-white/50 tabular-nums">{localMedia}</span>
        </div>
        <input
          id="ms-vol-media"
          type="range"
          min={0}
          max={100}
          value={localMedia}
          onChange={(e) => { draggingRef.current = "media"; setLocalMedia(parseInt(e.target.value, 10)); }}
          onPointerUp={() => { draggingRef.current = null; onSetMediaVolume(localMedia); }}
          onBlur={() => { draggingRef.current = null; onSetMediaVolume(localMedia); }}
          className="w-full accent-pnp-accent"
          aria-label={t.live.mainStageAdminAudioMedia}
        />
      </div>
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label htmlFor="ms-vol-cams" className="text-[11px] font-semibold text-white/80">
            {t.live.mainStageAdminAudioCams}
          </label>
          <span className="text-[11px] text-white/50 tabular-nums">{localCams}</span>
        </div>
        <input
          id="ms-vol-cams"
          type="range"
          min={0}
          max={100}
          value={localCams}
          onChange={(e) => { draggingRef.current = "cams"; setLocalCams(parseInt(e.target.value, 10)); }}
          onPointerUp={() => { draggingRef.current = null; onSetCamsVolume(localCams); }}
          onBlur={() => { draggingRef.current = null; onSetCamsVolume(localCams); }}
          className="w-full accent-pnp-accent"
          aria-label={t.live.mainStageAdminAudioCams}
        />
      </div>
      <p className="text-[10px] text-white/30">{t.live.mainStageAdminAudioHint}</p>
    </div>
  );
}

interface AdminPanelContentProps {
  state: MainStageState;
  admin: AdminType;
  cammerInfos: CammerInfo[];
  onClose?: () => void;
  // When non-admin opens the same drawer, layout buttons set their personal
  // view (local-only) and the video / audio / participants sections are
  // greyed out. Server permissions still enforce admin-only on the API.
  isAdmin?: boolean;
  localViewMode?: ModeId | null;
  onSetLocalView?: (mode: ModeId) => void;
  onResetLocalView?: () => void;
}

export function AdminPanelContent({
  state,
  admin,
  cammerInfos,
  onClose,
  // Default to non-admin so any future caller that forgets to pass this
  // prop gets the safer rendered surface (greyed video/audio/participants,
  // local-only Layout) instead of full broadcast controls.
  isAdmin = false,
  localViewMode = null,
  onSetLocalView,
  onResetLocalView,
}: AdminPanelContentProps) {
  const t = useI18n();
  const [mediaUrl, setMediaUrl] = useState(state.media.src ?? "");
  const [primeVideos, setPrimeVideos] = useState<PrimeVideo[]>([]);
  const [primeLoading, setPrimeLoading] = useState(true);
  // For non-admins, the active highlight on layout buttons reflects their
  // *personal* view (local override or, if none, the room default).
  const effectiveLayoutMode: ModeId =
    !isAdmin ? ((localViewMode ?? (state?.mode as ModeId | undefined) ?? "spotlight"))
    : ((state?.mode as ModeId | undefined) ?? "spotlight");

  useEffect(() => {
    let cancelled = false;
    setPrimeLoading(true);
    getFeaturedPrimeVideos(40)
      .then((items) => {
        if (cancelled) return;
        setPrimeVideos(items.filter((v) => v.video_file));
      })
      .catch(() => {
        if (!cancelled) setPrimeVideos([]);
      })
      .finally(() => {
        if (!cancelled) setPrimeLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const handlePlayMedia = useCallback(() => {
    if (!mediaUrl.trim()) return;
    admin.setMedia({ kind: "video", src: mediaUrl.trim(), playing: true });
  }, [admin, mediaUrl]);

  const handleStopMedia = useCallback(() => {
    admin.setMedia({ kind: "off", src: null, playing: false });
  }, [admin]);

  const handleTogglePlay = useCallback(() => {
    if (!state?.media) return;
    admin.setMedia({ ...state.media, playing: !state.media.playing });
  }, [admin, state?.media]);

  const handlePickPrimeVideo = useCallback(
    async (video: PrimeVideo) => {
      const src = getAssetUrl(video.video_file);
      if (!src) return;
      setMediaUrl(src);
      if (state.mode !== "cinema") {
        await admin.setMode("cinema").catch(() => {});
      }
      await admin.setMedia({ kind: "video", src, playing: true }).catch(() => {});
    },
    [admin, state.mode]
  );

  return (
    <div
      className="flex flex-col h-full min-h-0"
      style={{
        paddingTop: "env(safe-area-inset-top, 0px)",
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
      }}
    >
      <div className="flex-shrink-0 flex items-center justify-between px-4 py-4 border-b border-white/[0.07]">
        <div className="pr-12">
          <h2 className="text-pnp-text-primary font-bold text-sm">{isAdmin ? t.live.mainStageAdminTitle : t.live.mainStageSettingsTitle}</h2>
          <p className="text-white/40 text-xs mt-0.5">
            {state?.counts?.cammers || 0} participants in rotation
          </p>
        </div>
        {/* Close button moved to a fixed-positioned overlay in AdminDrawer
            so it's always reachable regardless of scroll position. */}
      </div>

      <div className="flex-1 overflow-y-auto overscroll-contain space-y-5 p-4">
        <section>
          <h3 className="text-white/50 text-[10px] font-bold uppercase tracking-widest mb-2.5">{t.live.mainStageAdminSectionLayout}</h3>
          {!isAdmin && (
            <p className="text-white/45 text-[11px] leading-snug mb-2.5">{t.live.mainStageLayoutPersonalHint}</p>
          )}
          <div className="grid grid-cols-3 gap-2">
            {(["spotlight", "theater", "cinema", "karaoke", "equal"] as ModeId[]).map((modeId) => {
              const active = effectiveLayoutMode === modeId;
              const modeLabel: Record<ModeId, string> = {
                spotlight: t.live.mainStageModeSpotlight,
                theater: t.live.mainStageModeTheater,
                cinema: t.live.mainStageModeCinema,
                karaoke: t.live.mainStageModeKaraoke,
                equal: t.live.mainStageModeEqual,
              };
              const modeSub: Record<ModeId, string> = {
                spotlight: t.live.mainStageModeSpotlightSub,
                theater: t.live.mainStageModeTheaterSub,
                cinema: t.live.mainStageModeCinemaSub,
                karaoke: t.live.mainStageModeKaraokeSub,
                equal: t.live.mainStageModeEqualSub,
              };
              return (
                <button
                  key={modeId}
                  type="button"
                  onClick={() => {
                    if (isAdmin) {
                      admin.setMode(modeId);
                    } else if (onSetLocalView) {
                      onSetLocalView(modeId);
                    }
                  }}
                  className="flex flex-col items-center gap-1.5 p-3 rounded-2xl text-center transition-all active:scale-[0.97]"
                  style={{
                    background: active
                      ? "linear-gradient(135deg,rgba(212,0,122,0.25),rgba(123,97,255,0.20))"
                      : "rgba(255,255,255,0.04)",
                    border: active ? "1.5px solid rgba(212,0,122,0.50)" : "1.5px solid rgba(255,255,255,0.08)",
                    color: active ? "#fff" : "rgba(255,255,255,0.50)",
                  }}
                >
                  <span className={active ? "text-pnp-accent" : "text-white/40"}>{MODE_ICONS_ADMIN[modeId]}</span>
                  <span className="text-[10px] font-bold leading-tight">{modeLabel[modeId]}</span>
                  <span className="text-[9px] text-white/30 leading-tight hidden sm:block">{modeSub[modeId]}</span>
                </button>
              );
            })}
          </div>
          {!isAdmin && localViewMode !== null && onResetLocalView && (
            <button
              type="button"
              onClick={onResetLocalView}
              className="mt-3 w-full min-h-[40px] flex items-center justify-center gap-2 rounded-xl text-[11px] font-semibold text-white/80 transition-all active:scale-[0.97] bg-white/[0.06] border border-white/10 hover:bg-white/[0.10]"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3" />
              </svg>
              {t.live.mainStageResetToRoomDefault}
            </button>
          )}
        </section>

        {!isAdmin && (
          <div
            role="note"
            className="rounded-xl px-3 py-2.5 text-[11px] text-white/65 leading-snug flex items-start gap-2"
            style={{
              background: "rgba(123,97,255,0.08)",
              border: "1px solid rgba(123,97,255,0.20)",
            }}
          >
            <svg className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-pnp-purple" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>{t.live.mainStageHostControlsBanner}</span>
          </div>
        )}

        {/* Video / audio / participants — admins get full controls,
            non-admins see them greyed-out (visible but uninteractive) so
            they understand what the host can do without being able to
            broadcast changes themselves. The server still enforces
            admin-only on the underlying API regardless of UI state. */}
        <div
          aria-hidden={!isAdmin}
          style={
            !isAdmin
              ? { opacity: 0.4, pointerEvents: "none", filter: "grayscale(70%)" }
              : undefined
          }
          className="space-y-5"
        >

        <section>
          <h3 className="text-white/50 text-[10px] font-bold uppercase tracking-widest mb-2.5">
            {t.live.mainStageAdminSectionPrimeVideos}{primeVideos.length > 0 ? ` (${primeVideos.length})` : ""}
          </h3>
          {primeLoading ? (
            <div className="flex gap-2 overflow-hidden">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="flex-shrink-0 w-32 h-[88px] rounded-xl animate-pulse bg-white/[0.04]"
                />
              ))}
            </div>
          ) : primeVideos.length === 0 ? (
            <p className="text-white/30 text-xs">{t.live.mainStageAdminNoPrimeVideos}</p>
          ) : (
            <div
              className="flex gap-2 overflow-x-auto pb-1"
              style={{ scrollbarWidth: "none", WebkitOverflowScrolling: "touch" }}
            >
              {primeVideos.map((v) => {
                const thumb = getAssetUrl(v.thumbnail) || getAssetUrl(v.cover_url);
                const src = getAssetUrl(v.video_file);
                const active = state.mode === "cinema" && state.media.src === src;
                return (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => handlePickPrimeVideo(v)}
                    className="flex-shrink-0 relative w-32 h-[88px] rounded-xl overflow-hidden transition-all active:scale-[0.97] text-left bg-white/[0.04]"
                    style={{
                      border: active ? "1.5px solid #D4007A" : "1.5px solid rgba(255,255,255,0.08)",
                      boxShadow: active ? "0 0 0 2px rgba(212,0,122,0.30)" : "none",
                    }}
                    aria-label={t.live.mainStageAdminAriaPlayVideo(v.title)}
                    title={v.title}
                  >
                    {thumb ? (
                      <img
                        src={thumb}
                        alt=""
                        className="absolute inset-0 w-full h-full object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <div
                        className="absolute inset-0"
                        style={{ background: "linear-gradient(135deg, rgba(212,0,122,0.25), rgba(123,97,255,0.20))" }}
                      />
                    )}
                    <div
                      className="absolute inset-0"
                      style={{ background: "linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.15) 60%, rgba(0,0,0,0) 100%)" }}
                    />
                    <div className="absolute inset-x-0 bottom-0 px-2 pb-1.5">
                      <p className="text-white text-[10px] font-semibold leading-tight line-clamp-2">
                        {v.title}
                      </p>
                    </div>
                    {active && (
                      <div className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full flex items-center justify-center bg-pnp-accent">
                        <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M8 5v14l11-7z" />
                        </svg>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </section>

        <section>
          <h3 className="text-white/50 text-[10px] font-bold uppercase tracking-widest mb-2.5">{t.live.mainStageAdminSectionCustomUrl}</h3>
          <div className="space-y-3">
            <div className="flex gap-2">
              <input
                type="url"
                value={mediaUrl}
                onChange={(e) => setMediaUrl(e.target.value)}
                placeholder={t.live.mainStageAdminUrlPlaceholder}
                className="flex-1 min-w-0 px-3 py-2 rounded-xl text-xs text-white placeholder-white/30 focus:outline-none transition-colors bg-white/[0.06] border border-white/10"
                aria-label={t.live.mainStageAdminAriaMediaUrl}
              />
              <button
                type="button"
                onClick={handlePlayMedia}
                disabled={!mediaUrl.trim()}
                className="flex-shrink-0 min-h-[38px] px-3 rounded-xl text-xs font-bold text-white transition-all active:scale-[0.96] disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ background: "linear-gradient(135deg,#D4007A,#7B61FF)" }}
              >
                {t.live.mainStageAdminPlay}
              </button>
            </div>

            {state?.media?.kind && state.media.kind !== "off" && (
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleTogglePlay}
                  className="flex-1 min-h-[40px] flex items-center justify-center gap-2 rounded-xl text-xs font-semibold text-white transition-all active:scale-[0.97] bg-white/[0.07] border border-white/10"
                >
                  {state.media.playing ? (
                    <>
                      <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M6 4h4v16H6zM14 4h4v16h-4z" /></svg>
                      {t.live.mainStageAdminPause}
                    </>
                  ) : (
                    <>
                      <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
                      {t.live.mainStageAdminResume}
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={handleStopMedia}
                  className="flex-shrink-0 min-h-[40px] px-4 rounded-xl text-xs font-semibold transition-all active:scale-[0.97] bg-pnp-error/[0.12] border border-pnp-error/25 text-pnp-error"
                >
                  {t.live.mainStageAdminStop}
                </button>
              </div>
            )}
            {isAdmin && state?.media?.adminLocked && state.media.kind === "off" && (
              <button
                type="button"
                onClick={() => admin.setMedia({ kind: "off", src: null, playing: false, adminLocked: false })}
                className="w-full min-h-[40px] flex items-center justify-center gap-2 px-4 rounded-xl text-xs font-semibold text-white/60 border border-white/10 bg-white/[0.04] transition-all active:scale-[0.97]"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z" />
                </svg>
                Resume auto-rotation
              </button>
            )}
          </div>
        </section>

        <section>
          <h3 className="text-white/50 text-[10px] font-bold uppercase tracking-widest mb-2.5">
            {t.live.mainStageAdminSectionAudio}
          </h3>
          <AudioMixControls
            mediaVolume={state?.media?.volume ?? 70}
            camsVolume={state?.cams?.volume ?? 80}
            onSetMediaVolume={(v) => admin.setVolume({ media: v })}
            onSetCamsVolume={(v) => admin.setVolume({ cams: v })}
          />
        </section>

        <section>
          <h3 className="text-white/50 text-[10px] font-bold uppercase tracking-widest mb-2.5">
            {t.live.mainStageAdminSectionParticipants}{cammerInfos.length > 0 ? ` (${cammerInfos.length})` : ""}
          </h3>
          {cammerInfos.length === 0 ? (
            <p className="text-white/30 text-xs">{t.live.mainStageAdminNoCammers}</p>
          ) : (
            <div className="space-y-1.5">
              {cammerInfos.map((c) => (
                <div
                  key={c.identity}
                  className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white/[0.04] border border-white/[0.06]"
                >
                  <span className="flex-1 min-w-0 text-xs text-white/70 truncate">{c.name}</span>
                  <button
                    type="button"
                    onClick={() => admin.moderate("mute", c.identity)}
                    aria-label={t.live.mainStageAdminAriaMute(c.identity)}
                    className="flex-shrink-0 px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all active:scale-[0.96] bg-pnp-amber/[0.12] border border-pnp-amber/25 text-pnp-amber"
                  >
                    {t.live.mainStageAdminMute}
                  </button>
                  <button
                    type="button"
                    onClick={() => admin.moderate("kick", c.identity)}
                    aria-label={t.live.mainStageAdminAriaKick(c.identity)}
                    className="flex-shrink-0 px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all active:scale-[0.96] bg-pnp-error/[0.12] border border-pnp-error/25 text-pnp-error"
                  >
                    {t.live.mainStageAdminKick}
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
        </div>

        {/* Invite Panel — admin-only, always visible (outside the aria-hidden block) */}
        {isAdmin && (
          <section>
            <div className="h-px bg-white/[0.06] mb-4" />
            <InvitePanel />
          </section>
        )}
      </div>
    </div>
  );
}

interface AdminDrawerProps {
  state: MainStageState;
  admin: AdminType;
  cammerInfos: CammerInfo[];
  onClose: () => void;
  isAdmin: boolean;
  localViewMode: ModeId | null;
  onSetLocalView: (mode: ModeId) => void;
  onResetLocalView: () => void;
}

export function AdminDrawer({ state, admin, cammerInfos, onClose, isAdmin, localViewMode, onSetLocalView, onResetLocalView }: AdminDrawerProps) {
  const t = useI18n();
  const drawerRef = useRef<HTMLElement>(null);
  useFocusTrap(drawerRef, true);

  // Lock body scroll while drawer is open so iOS doesn't capture pan gestures
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <>
      <div
        className="fixed inset-0 lg:left-72 z-40"
        style={{ background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)" }}
        onClick={onClose}
        aria-hidden
      />
      <aside
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-label={isAdmin ? t.live.mainStageAdminTitle : t.live.mainStageSettingsTitle}
        onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}
        // No overflow on the wrapper — AdminPanelContent's body is the
        // single scroll container so iOS doesn't get confused.
        className="fixed top-0 right-0 bottom-0 z-50 flex flex-col bg-pnp-background border-l border-white/[0.08]"
        style={{
          width: "min(384px, 100vw)",
          maxHeight: "100dvh",
        }}
      >
        {/* Always-visible close button, fixed within the drawer regardless of
            scroll. Big red circle, top-right corner, above the panel header. */}
        <button
          type="button"
          aria-label={t.live.mainStageAriaCloseAdmin}
          onClick={onClose}
          className="absolute z-10 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-full transition-all active:scale-[0.92] hover:opacity-90 text-white"
          style={{
            top: "calc(0.5rem + env(safe-area-inset-top, 0px))",
            right: "0.5rem",
            background: "rgba(255,69,58,0.95)",
            border: "1px solid rgba(255,255,255,0.30)",
            boxShadow: "0 4px 16px rgba(0,0,0,0.45)",
          }}
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
        <AdminPanelContent
          state={state}
          admin={admin}
          cammerInfos={cammerInfos}
          onClose={onClose}
          isAdmin={isAdmin}
          localViewMode={localViewMode}
          onSetLocalView={onSetLocalView}
          onResetLocalView={onResetLocalView}
        />
      </aside>
    </>
  );
}
