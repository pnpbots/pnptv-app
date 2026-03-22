import React, { useState, useEffect, useCallback } from "react";
import { Helmet } from "react-helmet-async";
import { Card, Button } from "@pnptv/ui-kit";
import { useAuth } from "@/hooks/useAuth";
import { useTier } from "@/hooks/useTier";
import { PermissionGate } from "@/components/PermissionGate";
import { JitsiMeetComponent } from "@/components/hangouts";

import {
  joinCommunityRoom,
  getCommunityRoomOccupancy,
  type CommunityRoomInfo,
} from "@/lib/api";
import { UpcomingEvents } from "@/components/events";

export default function MainStage() {
  const { user, isAuthenticated } = useAuth();
  const { isAdmin } = useTier();
  const [occupancy, setOccupancy] = useState<number>(0);
  const [occupancyUsers, setOccupancyUsers] = useState<
    Array<{ userId: string; displayName: string; role: string; joinedAt: string }>
  >([]);
  const [loading, setLoading] = useState(false);
  const [joined, setJoined] = useState(false);
  const [iframeSrc, setIframeSrc] = useState("");
  const [roomInfo, setRoomInfo] = useState<CommunityRoomInfo | null>(null);
  const [error, setError] = useState("");
  const [occupancyError, setOccupancyError] = useState(false);
  const [showPermGate, setShowPermGate] = useState(false);
  const [jitsiApi, setJitsiApi] = useState<any>(null);
  useEffect(() => {
    getCommunityRoomOccupancy()
      .then((res) => {
        setOccupancy(res.occupancy?.activeUsers ?? 0);
        setOccupancyUsers(res.occupancy?.users ?? []);
      })
      .catch(() => {
        setOccupancyError(true);
      });
  }, []);

  const handleJoinClick = () => {
    if (!user) return;
    setShowPermGate(true);
  };

  const ALLOWED_CALL_ORIGINS = ["https://8x8.vc/", "https://meet.jit.si/"];

  const handlePermGranted = useCallback(async () => {
    setShowPermGate(false);
    if (!user) return;
    setLoading(true);
    setError("");
    try {
      const displayName =
        user.firstName ||
        user.displayName ||
        user.username ||
        "Guest";
      const res = await joinCommunityRoom(displayName);
      const src = res.meetingUrl;

      const isValidOrigin = ALLOWED_CALL_ORIGINS.some((prefix) =>
        src?.startsWith(prefix)
      );
      if (!src || !isValidOrigin) {
        setError("Video room is temporarily unavailable. Please try again.");
        return;
      }

      setRoomInfo(res);
      setIframeSrc(src);
      setJoined(true);
    } catch (e: unknown) {
      const message =
        e instanceof Error ? e.message : "Failed to join room";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [user]);

  const handleLeave = () => {
    setJoined(false);
    setIframeSrc("");
    setRoomInfo(null);
    setJitsiApi(null);
    getCommunityRoomOccupancy()
      .then((res) => {
        setOccupancy(res.occupancy?.activeUsers ?? 0);
        setOccupancyUsers(res.occupancy?.users ?? []);
      })
      .catch(() => {});
  };

  const handleApiReady = useCallback((api: any) => {
    setJitsiApi(api);
  }, []);

  // ─── Joined: fullscreen with side panel + mod bot ──────────────────────

  if (joined && iframeSrc) {
    return (
      <div className="fixed inset-0 z-[34] bg-black flex">
        <Helmet>
          <title>Main Stage | PNPtv</title>
        </Helmet>

        {/* Center: header + Jitsi */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Header bar */}
          <div className="flex items-center justify-between px-4 py-2 bg-pnp-surface border-b border-pnp-border flex-shrink-0">
            <div className="flex items-center gap-3">
              <svg className="w-5 h-5 text-pnp-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
              <div>
                <h2 className="text-pnp-textPrimary font-bold text-base leading-tight">
                  Main Stage
                </h2>
                {roomInfo && (
                  <p className="text-pnp-textSecondary text-xs">
                    {roomInfo.room.description}
                  </p>
                )}
              </div>
            </div>
            <Button variant="secondary" size="sm" onClick={handleLeave}>
              Leave Room
            </Button>
          </div>

          {/* Jitsi embed — chat disabled (we use hangout chat instead) */}
          <div className="flex-1 w-full">
            <JitsiMeetComponent
              meetingUrl={iframeSrc}
              roomName={roomInfo?.roomName}
              onCallEnd={handleLeave}
              isAdmin={isAdmin}
              isModerator={isAdmin}
              disableChat
              onApiReady={handleApiReady}
            />
          </div>
        </div>


      </div>
    );
  }

  // ─── Pre-join lobby ────────────────────────────────────────────────────

  return (
    <div className="p-4 pb-24 max-w-2xl mx-auto space-y-6">
      <Helmet>
        <title>Main Stage | PNPtv</title>
      </Helmet>

      {/* Hero */}
      <Card className="p-6 text-center space-y-4">
        <div className="w-16 h-16 mx-auto rounded-full flex items-center justify-center" style={{ background: "rgba(94, 209, 196, 0.15)" }}>
          <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} style={{ color: "#5ED1C4" }}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
        </div>
        <h1 className="text-2xl font-bold text-pnp-textPrimary">Main Stage</h1>
        <p className="text-pnp-textSecondary leading-relaxed">
          PNPtv's 24/7 open community video room. Drop in anytime to hang out,
          chat, and vibe with the community — no reservation needed.
        </p>

        {!occupancyError && occupancy > 0 && (
          <div className="flex items-center justify-center gap-2">
            <span className="w-2.5 h-2.5 bg-green-500 rounded-full animate-pulse" />
            <span className="text-green-400 text-sm font-medium">
              {occupancy} {occupancy === 1 ? "person" : "people"} in the room
              right now
            </span>
          </div>
        )}

        {!occupancyError && occupancy === 0 && (
          <p className="text-pnp-textSecondary text-sm">
            No one in the room right now — be the first to join!
          </p>
        )}

        {occupancyError && (
          <p className="text-pnp-textSecondary text-sm">
            Room is ready and waiting.
          </p>
        )}
      </Card>

      {/* Who's in the room */}
      {!occupancyError && occupancyUsers.length > 0 && (
        <Card className="p-4 space-y-3">
          <h2 className="text-sm font-semibold text-pnp-textSecondary uppercase tracking-wide">
            Currently Inside
          </h2>
          <div className="flex flex-wrap gap-2">
            {occupancyUsers.map((u) => (
              <div
                key={u.userId}
                className="flex items-center gap-1.5 bg-pnp-background rounded-full px-3 py-1"
              >
                <span className="w-2 h-2 bg-green-500 rounded-full" />
                <span className="text-pnp-textPrimary text-sm font-medium">
                  {u.displayName}
                </span>
                {u.role === "moderator" && (
                  <span className="text-xs text-pnp-accent ml-0.5">mod</span>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Join */}
      <Card className="p-6 space-y-4">
        <h2 className="text-lg font-semibold text-pnp-textPrimary">
          Ready to join?
        </h2>
        <p className="text-pnp-textSecondary text-sm leading-relaxed">
          Camera and microphone access required. The room is encrypted and
          private — no recordings allowed.
        </p>
        {error && (
          <p className="text-red-400 text-sm bg-red-950/30 border border-red-900/50 rounded-lg px-3 py-2">
            {error}
          </p>
        )}
        {isAuthenticated ? (
          <Button
            onClick={handleJoinClick}
            disabled={loading}
            className="w-full"
          >
            {loading ? "Connecting..." : "Join Main Stage"}
          </Button>
        ) : (
          <p className="text-pnp-textSecondary text-sm text-center py-2">
            Please log in to join the room.
          </p>
        )}
      </Card>

      {/* Upcoming Hangout Events */}
      <UpcomingEvents type="hangout_event" limit={3} title="Upcoming Hangout Events" />

      {/* Stage Rules */}
      <Card className="p-6 space-y-3">
        <h3 className="font-semibold text-pnp-textPrimary">Stage Rules</h3>
        <ul className="text-pnp-textSecondary text-sm space-y-2.5">
          <li className="flex items-start gap-2.5">
            <span className="mt-0.5 shrink-0">🔒</span>
            <span>
              End-to-end encrypted — your privacy is protected at all times
            </span>
          </li>
          <li className="flex items-start gap-2.5">
            <span className="mt-0.5 shrink-0">🚫</span>
            <span>
              No recording — what happens on the Stage stays on the Stage
            </span>
          </li>
          <li className="flex items-start gap-2.5">
            <span className="mt-0.5 shrink-0">💬</span>
            <span>
              Be respectful — hate speech and harassment will get you removed
              immediately
            </span>
          </li>
          <li className="flex items-start gap-2.5">
            <span className="mt-0.5 shrink-0">🌈</span>
            <span>
              All are welcome — this is a safe space for the PNP community
            </span>
          </li>
          <li className="flex items-start gap-2.5">
            <span className="mt-0.5 shrink-0">🕐</span>
            <span>Open 24/7 — the door is always unlocked</span>
          </li>
        </ul>
      </Card>

      {/* Permission gate modal */}
      {showPermGate && (
        <PermissionGate
          onGranted={handlePermGranted}
          onCancel={() => setShowPermGate(false)}
        />
      )}
    </div>
  );
}
