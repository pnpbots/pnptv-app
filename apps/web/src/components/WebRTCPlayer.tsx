import React, { useState, useEffect, useRef, useCallback } from "react";
import { Room, RoomEvent, Track, RemoteTrackPublication, RemoteParticipant } from "livekit-client";
import { Skeleton } from "@pnptv/ui-kit";
import { useI18n } from "@/lib/i18n";
import { getWebRTCViewerToken, streamHeartbeat } from "@/lib/api";

interface WebRTCPlayerProps {
  channelRef: string;
  title?: string;
  className?: string;
}

type PlayerStatus = "loading" | "connecting" | "live" | "offline" | "error" | "outOfTokens";

export function WebRTCPlayer({ channelRef, title, className = "" }: WebRTCPlayerProps) {
  const t = useI18n();
  const videoRef = useRef<HTMLVideoElement>(null);
  const roomRef = useRef<Room | null>(null);
  const heartbeatIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const [status, setStatus] = useState<PlayerStatus>("loading");
  const [viewerCount, setViewerCount] = useState(0);

  const cleanup = useCallback(() => {
    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current);
      heartbeatIntervalRef.current = null;
    }
    if (roomRef.current) {
      roomRef.current.disconnect();
      roomRef.current = null;
    }
  }, []);

  const connect = useCallback(async () => {
    cleanup();
    setStatus("connecting");

    try {
      const data = await getWebRTCViewerToken(channelRef);
      if (data.error && data.error.includes("Insufficient funds")) {
        setStatus("outOfTokens");
        return;
      }
      if (!data.success || !data.token) {
        setStatus("offline");
        return;
      }

      const room = new Room({ adaptiveStream: true, dynacast: true });
      roomRef.current = room;

      room.on(RoomEvent.TrackSubscribed, (track, _pub, _participant) => {
        if (track.kind === Track.Kind.Video && videoRef.current) {
          track.attach(videoRef.current);
          setStatus("live");
        }
        if (track.kind === Track.Kind.Audio && videoRef.current) {
          track.attach(videoRef.current);
        }
      });

      room.on(RoomEvent.TrackUnsubscribed, (track) => {
        track.detach();
      });

      room.on(RoomEvent.ParticipantConnected, () => setViewerCount(room.remoteParticipants.size));
      room.on(RoomEvent.ParticipantDisconnected, () => setViewerCount(room.remoteParticipants.size));
      room.on(RoomEvent.Disconnected, () => setStatus("offline"));

      await room.connect(data.wsUrl, data.token);
      setViewerCount(room.remoteParticipants.size);

      // Start heartbeat
      heartbeatIntervalRef.current = setInterval(async () => {
        try {
          await streamHeartbeat(channelRef);
        } catch (error: any) {
          if (error.response?.status === 402) {
            cleanup();
            setStatus("outOfTokens");
          }
        }
      }, 60000);

      let foundVideo = false;
      for (const [, participant] of room.remoteParticipants) {
        for (const [, pub] of participant.trackPublications) {
          if (pub.track && pub.kind === Track.Kind.Video && videoRef.current) {
            pub.track.attach(videoRef.current);
            foundVideo = true;
          }
          if (pub.track && pub.kind === Track.Kind.Audio && videoRef.current) {
            pub.track.attach(videoRef.current);
          }
        }
      }

      if (foundVideo) {
        setStatus("live");
      } else {
        setStatus("connecting");
        setTimeout(() => {
          if (roomRef.current) {
            let hasVideo = false;
            for (const [, p] of roomRef.current.remoteParticipants) {
              if (p.getTrack(Track.Source.Camera)) hasVideo = true;
            }
            if (!hasVideo) setStatus("offline");
          }
        }, 15000);
      }
    } catch (err: any) {
      console.warn("[WebRTCPlayer] Connection failed:", err);
      if(err.response?.status === 402) {
        setStatus("outOfTokens");
      } else {
        setStatus("error");
      }
    }
  }, [channelRef, cleanup]);

  useEffect(() => {
    connect();
    return cleanup;
  }, [connect, cleanup]);

  const handleRetry = () => {
    connect();
  };

  if (status === "outOfTokens") {
    return (
      <div className={`relative aspect-video overflow-hidden rounded-xl bg-pnp-surface border border-pnp-border flex items-center justify-center ${className}`}>
        <div className="text-center">
          <p className="text-pnp-error font-medium mb-3">You've run out of tokens.</p>
          <p className="text-sm text-pnp-textSecondary/60 mt-1 mb-4">Please top up to continue watching.</p>
          <a href="/wallet" className="px-5 py-2.5 rounded-lg text-xs font-semibold text-white btn-gradient">
            Go to Wallet
          </a>
        </div>
      </div>
    );
  }
  
  if (status === "loading" || status === "connecting") {
    return (
      <div className={`relative aspect-video overflow-hidden rounded-xl ${className}`}>
        <Skeleton className="w-full h-full" />
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
          <div className="w-10 h-10 border-2 border-pnp-accent border-t-transparent rounded-full animate-spin" />
          {status === "connecting" && (
            <p className="text-xs text-pnp-textSecondary/80 animate-pulse">Connecting via WebRTC...</p>
          )}
        </div>
      </div>
    );
  }

  if (status === "offline") {
    return (
      <div className={`relative aspect-video overflow-hidden rounded-xl bg-pnp-surface border border-pnp-border flex items-center justify-center ${className}`}>
        <div className="text-center">
          <svg className="w-16 h-16 text-pnp-textSecondary mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
          <p className="text-pnp-textSecondary font-medium">{t.live.streamOffline}</p>
          <p className="text-sm text-pnp-textSecondary/60 mt-1">{t.live.checkBackLater}</p>
          <div className="flex items-center justify-center gap-2 mt-4">
            <button onClick={handleRetry} className="px-4 py-2 rounded-lg text-xs font-semibold text-white btn-gradient">
              Retry
            </button>
            <a href="/live" className="px-4 py-2 rounded-lg text-xs font-semibold text-pnp-textSecondary bg-pnp-surface border border-pnp-border hover:border-pnp-accent/40 transition-colors">
              Back to Live
            </a>
          </div>
        </div>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className={`relative aspect-video overflow-hidden rounded-xl bg-pnp-surface border border-pnp-border flex items-center justify-center ${className}`}>
        <div className="text-center">
          <p className="text-pnp-error font-medium mb-3">Failed to connect</p>
          <button onClick={handleRetry} className="px-5 py-2.5 rounded-lg text-xs font-semibold text-white btn-gradient">
            Try Again
          </button>
        </div>
      </div>
    );
  }

  // Live state
  return (
    <div className={`relative aspect-video overflow-hidden rounded-xl bg-black ${className}`}>
      <video ref={videoRef} autoPlay playsInline className="w-full h-full object-contain" />
      <div className="absolute top-3 left-3 z-10">
        <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs font-bold text-white" style={{ background: "rgba(239,68,68,0.9)" }}>
          <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
          LIVE
        </span>
      </div>
      {title && (
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-4 pt-8 z-10">
          <p className="text-white font-medium">{title}</p>
        </div>
      )}
    </div>
  );
}
