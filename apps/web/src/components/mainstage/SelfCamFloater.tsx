/**
 * SelfCamFloater — bottom-left persistent self-cam preview for cammers
 * navigating away from /main-stage.
 *
 * Shown only when:
 *   1. User is a cammer or admin on the shared Room
 *   2. Current route is NOT /main-stage (the full-stage view has its own tile)
 *
 * The ✕ button calls provider.leave() — disconnects the Room and clears role.
 * The ↩ button navigates back to /main-stage.
 *
 * Video is mirrored (scaleX(-1)) so the user sees their own reflection,
 * matching the UX convention of front-facing cameras.
 */
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Track } from "livekit-client";
import { useMainStageRoom } from "@/components/mainstage/MainStageProvider";

export function SelfCamFloater() {
  const location = useLocation();
  const navigate = useNavigate();
  const { room, role, leave } = useMainStageRoom();

  const videoRef = useRef<HTMLVideoElement>(null);
  const [hasTrack, setHasTrack] = useState(false);

  const isOnMainStage = location.pathname === "/main-stage";
  const isCammer = role === "cammer" || role === "admin";

  // Attach the local camera track to the <video> element whenever it
  // changes. We listen to the Room's track-published events so we pick
  // up the track as soon as it's enabled (joinAsCammer sets cam enabled
  // after the Room connects, so the track arrives shortly after role flip).
  useEffect(() => {
    if (!isCammer || !videoRef.current) {
      setHasTrack(false);
      return;
    }

    const el = videoRef.current;

    function attachTrack() {
      const pub = room.localParticipant.getTrackPublication(Track.Source.Camera);
      const track = pub?.track;
      if (track && videoRef.current) {
        track.attach(videoRef.current);
        setHasTrack(true);
      } else {
        setHasTrack(false);
      }
    }

    function detachAll() {
      if (videoRef.current) {
        const pub = room.localParticipant.getTrackPublication(Track.Source.Camera);
        pub?.track?.detach(videoRef.current);
      }
      setHasTrack(false);
    }

    attachTrack();

    room.localParticipant.on("trackPublished", attachTrack);
    room.localParticipant.on("trackUnpublished", attachTrack);
    room.localParticipant.on("trackEnabled", attachTrack);
    room.localParticipant.on("trackDisabled", attachTrack);

    return () => {
      detachAll();
      room.localParticipant.off("trackPublished", attachTrack);
      room.localParticipant.off("trackUnpublished", attachTrack);
      room.localParticipant.off("trackEnabled", attachTrack);
      room.localParticipant.off("trackDisabled", attachTrack);
    };
  }, [isCammer, room]);

  // Don't render when on the Main Stage page (full tile visible there)
  // or when not a cammer, or when the cam track isn't live yet.
  if (isOnMainStage || !isCammer) return null;

  return (
    <div
      className="fixed z-50 select-none"
      style={{
        left: "calc(0.75rem + env(safe-area-inset-left, 0px))",
        bottom: "calc(80px + env(safe-area-inset-bottom, 0px))",
        width: 120,
        height: 160,
      }}
    >
      {/* Video container */}
      <div
        className="relative w-full h-full rounded-2xl overflow-hidden shadow-2xl border"
        style={{
          background: "#0A0A0F",
          borderColor: "rgba(212,0,122,0.55)",
          boxShadow: "0 8px 32px rgba(0,0,0,0.6), 0 0 0 1px rgba(212,0,122,0.30)",
        }}
      >
        {/* Mirrored self-cam video */}
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="absolute inset-0 w-full h-full object-cover"
          style={{ transform: "scaleX(-1)" }}
        />

        {/* Placeholder when track not yet live */}
        {!hasTrack && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div
              className="w-6 h-6 rounded-full border-2 animate-spin"
              style={{ borderColor: "rgba(212,0,122,0.3)", borderTopColor: "#D4007A" }}
            />
          </div>
        )}

        {/* Live indicator — subtle pill at top */}
        {hasTrack && (
          <div
            className="absolute top-1.5 left-1/2 -translate-x-1/2 flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[8px] font-bold text-white/90 uppercase tracking-wider"
            style={{ background: "rgba(212,0,122,0.70)", backdropFilter: "blur(4px)" }}
          >
            <span className="relative flex h-1.5 w-1.5">
              <span className="motion-safe:animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75" />
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-white" />
            </span>
            Live
          </div>
        )}

        {/* Gradient scrim — bottom action buttons */}
        <div
          className="absolute bottom-0 left-0 right-0 flex items-center justify-between px-1.5 pb-1.5 pt-6"
          style={{
            background: "linear-gradient(to top, rgba(0,0,0,0.75) 0%, transparent 100%)",
          }}
        >
          {/* Return to Main Stage */}
          <button
            type="button"
            onClick={() => navigate("/main-stage")}
            aria-label="Return to Main Stage"
            title="Return to Main Stage"
            className="min-h-[26px] min-w-[26px] flex items-center justify-center rounded-full transition-all hover:bg-white/20 active:scale-90 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-pnp-accent"
            style={{ background: "rgba(255,255,255,0.15)" }}
          >
            <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3" />
            </svg>
          </button>

          {/* Leave — stops cam and disconnects */}
          <button
            type="button"
            onClick={leave}
            aria-label="Stop broadcasting"
            title="Stop broadcasting"
            className="min-h-[26px] min-w-[26px] flex items-center justify-center rounded-full transition-all hover:bg-red-500/40 active:scale-90 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-pnp-error"
            style={{ background: "rgba(255,69,58,0.25)" }}
          >
            <svg className="w-3 h-3 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
