/**
 * SelfCamFloater
 *
 * A small draggable, mirrored self-cam tile that stays visible while the
 * user is on cam in Main Stage and navigates to another route.
 *
 * Visibility conditions (ALL must be true):
 *   1. isCammerActive is set in MainStageContext
 *   2. Current route is NOT /main-stage
 *   3. The floater has not been dismissed this session
 *   4. The Room's local camera track is publishing
 *
 * Controls:
 *   ↩ — navigate back to /main-stage
 *   ✕ — disconnect from the room + clear isCammerActive (full leave)
 *
 * Position: fixed bottom-left, safe-area-inset-bottom aware.
 * Draggable via pointer events; position offset persisted in sessionStorage.
 */

import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Track } from "livekit-client";
import { useMainStageRoom } from "./MainStageProvider";

const POS_KEY = "pnptv:ms:floater_pos";

interface SavedPos {
  x: number;
  y: number;
}

function readSavedPos(): SavedPos {
  try {
    const raw = sessionStorage.getItem(POS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as SavedPos;
      if (typeof parsed.x === "number" && typeof parsed.y === "number") {
        return parsed;
      }
    }
  } catch {}
  return { x: 0, y: 0 };
}

const STRINGS = {
  en: {
    returnToStage: "Return to Main Stage",
    leaveStage: "Leave Main Stage",
    ariaLabel: "Your camera — Main Stage",
  },
  es: {
    returnToStage: "Volver al Escenario",
    leaveStage: "Salir del Escenario",
    ariaLabel: "Tu cámara — Main Stage",
  },
} as const;

function useStrings() {
  const lang =
    typeof navigator !== "undefined" && navigator.language?.startsWith("es")
      ? "es"
      : "en";
  return STRINGS[lang];
}

export function SelfCamFloater() {
  const { room, isCammerActive, setIsCammerActive, floaterDismissed, dismissFloater } =
    useMainStageRoom();
  const location = useLocation();
  const navigate = useNavigate();
  const s = useStrings();

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const floaterRef = useRef<HTMLDivElement | null>(null);
  const [hasTrack, setHasTrack] = useState(false);

  // Dragging state — offset from the base bottom-left anchor
  const [offset, setOffset] = useState<SavedPos>(readSavedPos);
  const dragging = useRef(false);
  const dragStart = useRef<{ px: number; py: number; ox: number; oy: number } | null>(null);

  const onMainStage = location.pathname === "/main-stage";
  const shouldRender = isCammerActive && !onMainStage && !floaterDismissed && hasTrack;

  // Attach / detach the local camera track to the video element
  useEffect(() => {
    if (!isCammerActive) {
      setHasTrack(false);
      return;
    }

    const attachTrack = () => {
      const trackPub = room.localParticipant?.getTrackPublication(Track.Source.Camera);
      const track = trackPub?.videoTrack;
      if (track && videoRef.current) {
        track.attach(videoRef.current);
        setHasTrack(true);
      } else {
        setHasTrack(false);
      }
    };

    const detachTrack = () => {
      const trackPub = room.localParticipant?.getTrackPublication(Track.Source.Camera);
      const track = trackPub?.videoTrack;
      if (track && videoRef.current) {
        track.detach(videoRef.current);
      }
      setHasTrack(false);
    };

    attachTrack();

    room.on("localTrackPublished", attachTrack);
    room.on("localTrackUnpublished", detachTrack);

    return () => {
      room.off("localTrackPublished", attachTrack);
      room.off("localTrackUnpublished", detachTrack);
      detachTrack();
    };
  }, [room, isCammerActive]);

  const handleReturn = useCallback(() => {
    navigate("/main-stage");
  }, [navigate]);

  const handleLeave = useCallback(() => {
    // Disconnect the LiveKit room — MainStage will handle cleanup via its own
    // lifecycle effects when it reconnects next time the user enters.
    room.disconnect().catch(() => {});
    setIsCammerActive(false);
    dismissFloater();
  }, [room, setIsCammerActive, dismissFloater]);

  // ── Drag: pointer events ──────────────────────────────────────────────────

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    // Ignore clicks on the icon buttons
    if ((e.target as HTMLElement).closest("button")) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragging.current = true;
    dragStart.current = {
      px: e.clientX,
      py: e.clientY,
      ox: offset.x,
      oy: offset.y,
    };
  }, [offset]);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current || !dragStart.current) return;
    const dx = e.clientX - dragStart.current.px;
    const dy = e.clientY - dragStart.current.py;
    // Positive x moves right, negative y moves up (floater is bottom-anchored)
    setOffset({ x: dragStart.current.ox + dx, y: dragStart.current.oy - dy });
  }, []);

  const onPointerUp = useCallback(() => {
    if (!dragging.current) return;
    dragging.current = false;
    dragStart.current = null;
    // Persist last known position
    try {
      sessionStorage.setItem(POS_KEY, JSON.stringify(offset));
    } catch {}
  }, [offset]);

  // Persist on offset change (debounce via useEffect)
  useEffect(() => {
    if (!dragging.current) {
      try {
        sessionStorage.setItem(POS_KEY, JSON.stringify(offset));
      } catch {}
    }
  }, [offset]);

  if (!shouldRender) return null;

  return (
    <div
      ref={floaterRef}
      role="region"
      aria-label={s.ariaLabel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      className="fixed z-[200] cursor-grab active:cursor-grabbing select-none"
      style={{
        // Base anchor: bottom-left, above bottom nav (80px) + safe area
        bottom: `calc(80px + env(safe-area-inset-bottom, 0px) + ${offset.y}px)`,
        left: `calc(1rem + ${offset.x}px)`,
        width: "clamp(140px, 20vw, 180px)",
        height: "clamp(100px, 14vw, 130px)",
        borderRadius: "14px",
        overflow: "hidden",
        boxShadow:
          "0 8px 32px rgba(0,0,0,0.6), 0 0 0 2px rgba(212,0,122,0.55), 0 0 20px rgba(212,0,122,0.20)",
        background: "#0a0a0f",
        touchAction: "none",
      }}
    >
      {/* Mirrored video */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        aria-hidden
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          transform: "scaleX(-1)",
          display: "block",
        }}
      />

      {/* Gradient overlay so buttons are legible */}
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "linear-gradient(to bottom, rgba(0,0,0,0.45) 0%, transparent 40%, transparent 60%, rgba(0,0,0,0.30) 100%)",
        }}
      />

      {/* Action buttons — top-right corner */}
      <div className="absolute top-1.5 right-1.5 flex flex-col gap-1 z-10">
        {/* Return to Main Stage */}
        <button
          type="button"
          onClick={handleReturn}
          aria-label={s.returnToStage}
          className="w-6 h-6 flex items-center justify-center rounded-full transition-all active:scale-[0.88] hover:opacity-90"
          style={{
            background: "rgba(212,0,122,0.85)",
            border: "1px solid rgba(255,255,255,0.25)",
            boxShadow: "0 2px 8px rgba(0,0,0,0.5)",
          }}
        >
          <svg
            className="w-3 h-3 text-white"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3"
            />
          </svg>
        </button>

        {/* Leave / disconnect */}
        <button
          type="button"
          onClick={handleLeave}
          aria-label={s.leaveStage}
          className="w-6 h-6 flex items-center justify-center rounded-full transition-all active:scale-[0.88] hover:opacity-90"
          style={{
            background: "rgba(30,30,40,0.90)",
            border: "1px solid rgba(255,255,255,0.20)",
            boxShadow: "0 2px 8px rgba(0,0,0,0.5)",
          }}
        >
          <svg
            className="w-3 h-3 text-white/80"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      </div>

      {/* LIVE indicator — bottom-left corner */}
      <div className="absolute bottom-1.5 left-1.5 flex items-center gap-1 pointer-events-none">
        <span
          className="w-1.5 h-1.5 rounded-full"
          style={{
            background: "#FF2D55",
            boxShadow: "0 0 6px rgba(255,45,85,0.9)",
          }}
        />
        <span
          className="text-[9px] font-bold uppercase tracking-wider text-white/90"
          style={{ textShadow: "0 1px 3px rgba(0,0,0,0.8)" }}
        >
          Live
        </span>
      </div>
    </div>
  );
}
