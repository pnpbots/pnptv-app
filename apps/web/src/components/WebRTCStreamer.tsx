import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Room, RoomEvent, Track, LocalParticipant, createLocalTracks } from "livekit-client";
import { useI18n } from "@/lib/i18n";
import { getWebRTCStreamerConfig } from "@/lib/api";

// ─── Quality Presets ─────────────────────────────────────────────────────────

const QUALITY_PRESETS = [
  { id: "720p", label: "720p HD", width: 1280, height: 720, videoBitrate: 2_500_000, audioBitrate: 128000, fps: 30 },
  { id: "480p", label: "480p SD", width: 854, height: 480, videoBitrate: 1_000_000, audioBitrate: 128000, fps: 30 },
  { id: "360p", label: "360p Low", width: 640, height: 360, videoBitrate: 600_000, audioBitrate: 96000, fps: 24 },
  { id: "1080p", label: "1080p Full HD", width: 1920, height: 1080, videoBitrate: 4_500_000, audioBitrate: 192000, fps: 30 },
] as const;

type PresetId = (typeof QUALITY_PRESETS)[number]["id"];
type QualityPreset = (typeof QUALITY_PRESETS)[number];
type StreamStatus = "idle" | "connecting" | "live" | "stopping" | "error";

// ─── Inline SVG Icons ────────────────────────────────────────────────────────

const RadioIcon = (p: React.SVGProps<SVGSVGElement>) => (
  <svg {...p} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="2" /><path d="M16.24 7.76a6 6 0 0 1 0 8.49m-8.48-.01a6 6 0 0 1 0-8.49m11.31-2.82a10 10 0 0 1 0 14.14m-14.14 0a10 10 0 0 1 0-14.14" />
  </svg>
);
const StopIcon = (p: React.SVGProps<SVGSVGElement>) => (
  <svg {...p} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" /><rect x="9" y="9" width="6" height="6" />
  </svg>
);
const UsersIcon = (p: React.SVGProps<SVGSVGElement>) => (
  <svg {...p} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
);
const ClockIcon = (p: React.SVGProps<SVGSVGElement>) => (
  <svg {...p} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
  </svg>
);

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function WebRTCStreamer() {
  const { live: t } = useI18n();

  const [status, setStatus] = useState<StreamStatus>("idle");
  const [streamError, setStreamError] = useState<string | null>(null);
  const [viewerCount, setViewerCount] = useState(0);
  const [durationSec, setDurationSec] = useState(0);
  const [selectedPresetId, setSelectedPresetId] = useState<PresetId>("720p");
  const selectedPreset = useMemo(
    (): QualityPreset => QUALITY_PRESETS.find((p) => p.id === selectedPresetId) ?? QUALITY_PRESETS[0],
    [selectedPresetId]
  );

  // LiveKit room ref
  const roomRef = useRef<Room | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const durationTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef(0);

  // ── Preview ────────────────────────────────────────────────────────────────
  const [previewStream, setPreviewStream] = useState<MediaStream | null>(null);

  useEffect(() => {
    if (status !== "idle") return;
    let cancelled = false;
    navigator.mediaDevices
      .getUserMedia({
        video: { width: { ideal: selectedPreset.width }, height: { ideal: selectedPreset.height }, frameRate: { ideal: selectedPreset.fps } },
        audio: true,
      })
      .then((stream) => {
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        setPreviewStream(stream);
        if (videoRef.current) videoRef.current.srcObject = stream;
      })
      .catch(() => setStreamError(t.cameraPermissionDenied));
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPreset, status]);

  // Cleanup preview on unmount
  useEffect(() => {
    return () => {
      if (previewStream) previewStream.getTracks().forEach((t) => t.stop());
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Go Live ────────────────────────────────────────────────────────────────
  const handleGoLive = useCallback(async () => {
    setStreamError(null);
    setStatus("connecting");

    try {
      // 1. Get LiveKit config from backend
      const config = await getWebRTCStreamerConfig();
      if (!config.success || !config.token) {
        setStreamError(config.error || t.noChannelAssigned);
        setStatus("error");
        return;
      }

      // 2. Stop preview stream (LiveKit will manage its own tracks)
      if (previewStream) {
        previewStream.getTracks().forEach((t) => t.stop());
        setPreviewStream(null);
      }

      // 3. Create LiveKit room and connect
      const room = new Room({
        adaptiveStream: true,
        dynacast: true,
        videoCaptureDefaults: {
          resolution: { width: selectedPreset.width, height: selectedPreset.height, frameRate: selectedPreset.fps },
        },
      });

      roomRef.current = room;

      // 4. Set up event listeners
      room.on(RoomEvent.ParticipantConnected, () => {
        setViewerCount(room.remoteParticipants.size);
      });
      room.on(RoomEvent.ParticipantDisconnected, () => {
        setViewerCount(room.remoteParticipants.size);
      });
      room.on(RoomEvent.Disconnected, () => {
        setStatus("idle");
        clearDurationTimer();
      });

      // 5. Connect to LiveKit
      await room.connect(config.wsUrl, config.token);

      // 6. Publish camera and mic
      await room.localParticipant.enableCameraAndMicrophone();

      // 7. Attach local video to preview
      const camTrack = room.localParticipant.getTrackPublication(Track.Source.Camera);
      if (camTrack?.track && videoRef.current) {
        camTrack.track.attach(videoRef.current);
      }

      // 8. We're live!
      setStatus("live");
      startTimeRef.current = Date.now();
      durationTimerRef.current = setInterval(() => {
        setDurationSec(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }, 1000);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Connection failed";
      setStreamError(msg);
      setStatus("error");
      if (roomRef.current) {
        roomRef.current.disconnect();
        roomRef.current = null;
      }
    }
  }, [t, previewStream, selectedPreset]);

  // ── Stop Streaming ─────────────────────────────────────────────────────────
  const handleStop = useCallback(() => {
    setStatus("stopping");
    if (roomRef.current) {
      roomRef.current.disconnect();
      roomRef.current = null;
    }
    clearDurationTimer();
    setDurationSec(0);
    setViewerCount(0);
    setStatus("idle");
  }, []);

  function clearDurationTimer() {
    if (durationTimerRef.current) {
      clearInterval(durationTimerRef.current);
      durationTimerRef.current = null;
    }
  }

  // ── Unmount cleanup ────────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (roomRef.current) {
        roomRef.current.disconnect();
        roomRef.current = null;
      }
      clearDurationTimer();
    };
  }, []);

  const isStreaming = status === "live" || status === "stopping";
  const isConnecting = status === "connecting";
  const canGoLive = status === "idle" && !isConnecting;

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-bold text-white">{t.browserStreamerTitle}</h2>
          <p className="text-xs text-pnp-textSecondary mt-0.5">WebRTC — Sub-second latency</p>
        </div>
        {status === "live" && (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold text-white" style={{ background: "rgba(239, 68, 68, 0.9)" }}>
            <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
            {t.statusLive}
          </span>
        )}
        {status === "connecting" && (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold text-white/70" style={{ background: "rgba(255,255,255,0.08)" }}>
            <span className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse" />
            {t.statusConnecting}
          </span>
        )}
      </div>

      {/* Video preview */}
      <div className="relative w-full overflow-hidden rounded-2xl bg-pnp-surface border border-pnp-border" style={{ aspectRatio: "16/9" }}>
        <video ref={videoRef} autoPlay playsInline muted className="absolute inset-0 w-full h-full object-cover" />

        {status === "live" && (
          <>
            <div className="absolute top-3 left-3">
              <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs font-bold text-white" style={{ background: "rgba(239,68,68,0.9)", backdropFilter: "blur(4px)" }}>
                <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                {t.statusLive}
              </span>
            </div>
            <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold text-white" style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)" }}>
                <UsersIcon className="w-3.5 h-3.5" />
                {viewerCount} watching
              </span>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold text-white tabular-nums" style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)" }}>
                <ClockIcon className="w-3.5 h-3.5" />
                {formatDuration(durationSec)}
              </span>
            </div>
          </>
        )}
      </div>

      {/* Quality selector — only when not streaming */}
      {!isStreaming && (
        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium text-pnp-textSecondary">Quality</span>
          <div className="flex flex-wrap gap-2" role="group">
            {QUALITY_PRESETS.map((preset) => {
              const active = preset.id === selectedPresetId;
              return (
                <button
                  key={preset.id}
                  onClick={() => setSelectedPresetId(preset.id)}
                  disabled={isConnecting}
                  className={`inline-flex items-center justify-center px-4 rounded-full text-xs font-semibold transition-all min-h-[44px] sm:min-h-[36px] active:scale-95 ${
                    active
                      ? "btn-gradient text-white shadow-sm"
                      : "bg-pnp-surface border border-pnp-border text-pnp-textSecondary hover:border-pnp-accent hover:text-pnp-textPrimary"
                  }`}
                >
                  {preset.label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Error banner */}
      {streamError && (
        <div className="flex items-start gap-2.5 px-4 py-3 rounded-xl text-sm" style={{ background: "rgba(255,69,58,0.1)", border: "1px solid rgba(255,69,58,0.25)" }} role="alert">
          <span className="text-white/80 min-w-0 break-words">{streamError}</span>
        </div>
      )}

      {/* Go Live / Stop button */}
      <div className="pt-1">
        {isStreaming ? (
          <button
            onClick={handleStop}
            disabled={status === "stopping"}
            className="w-full flex items-center justify-center gap-2.5 min-h-[52px] px-6 rounded-2xl text-sm font-bold text-white transition-all hover:opacity-90 active:scale-[0.98] disabled:opacity-50"
            style={{ background: "linear-gradient(135deg, #b91c1c, #dc2626)" }}
          >
            <StopIcon className="w-5 h-5" />
            {t.stopStreaming}
          </button>
        ) : (
          <button
            onClick={handleGoLive}
            disabled={!canGoLive}
            className="w-full flex items-center justify-center gap-2.5 min-h-[52px] px-6 rounded-2xl text-sm font-bold text-white btn-gradient transition-all hover:opacity-90 active:scale-[0.98] disabled:opacity-50"
          >
            {isConnecting ? (
              <>
                <span className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                {t.connecting}
              </>
            ) : (
              <>
                <RadioIcon className="w-5 h-5" />
                {t.startStreaming}
              </>
            )}
          </button>
        )}
      </div>

      {/* Stats when live */}
      {status === "live" && (
        <dl className="grid grid-cols-2 gap-2">
          <div className="glass-card-sm p-3 text-center">
            <dt className="text-xs text-pnp-textSecondary mb-0.5">{t.duration}</dt>
            <dd className="text-sm font-bold text-white tabular-nums">{formatDuration(durationSec)}</dd>
          </div>
          <div className="glass-card-sm p-3 text-center">
            <dt className="text-xs text-pnp-textSecondary mb-0.5">Viewers</dt>
            <dd className="text-sm font-bold text-white">{viewerCount}</dd>
          </div>
        </dl>
      )}
    </div>
  );
}
