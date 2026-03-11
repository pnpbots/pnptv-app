import React, { useState, useCallback } from "react";
import { Helmet } from "react-helmet-async";
import { Card, Button } from "@pnptv/ui-kit";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { PermissionGate } from "@/components/PermissionGate";
import { JitsiMeetComponent } from "@/components/hangouts";

const DA_HAUS_URL = "https://meet.jit.si/pnptv-da-haus";

export default function DaHaus() {
  const { user, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [joined, setJoined] = useState(false);
  const [showPermGate, setShowPermGate] = useState(false);

  const handleJoinClick = () => {
    if (!user) return;
    setShowPermGate(true);
  };

  const handlePermGranted = useCallback(() => {
    setShowPermGate(false);
    setJoined(true);
  }, []);

  const handleLeave = () => {
    setJoined(false);
  };

  // ─── Joined: fullscreen layout ─────────────────────────────────────────

  if (joined) {
    return (
      <div className="fixed inset-0 z-50 bg-black flex flex-col">
        <Helmet>
          <title>Da Haus — PNPtv!</title>
        </Helmet>

        {/* Header bar */}
        <div className="flex items-center justify-between px-4 py-2 bg-pnp-surface border-b border-pnp-border flex-shrink-0">
          <div className="flex items-center gap-3">
            <svg
              className="w-5 h-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
              style={{ color: "#A259FF" }}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"
              />
            </svg>
            <div>
              <h2 className="text-pnp-textPrimary font-bold text-base leading-tight">
                Da Haus
              </h2>
              <p className="text-pnp-textSecondary text-xs">
                Open community hangout — free for everyone
              </p>
            </div>
          </div>
          <Button variant="secondary" size="sm" onClick={handleLeave}>
            Leave Room
          </Button>
        </div>

        {/* Jitsi embed */}
        <div className="flex-1 w-full">
          <JitsiMeetComponent
            meetingUrl={DA_HAUS_URL}
            roomName="pnptv-da-haus"
            onCallEnd={handleLeave}
            isAdmin={false}
            disableChat={false}
          />
        </div>
      </div>
    );
  }

  // ─── Pre-join lobby ────────────────────────────────────────────────────

  return (
    <div className="p-4 pb-24 max-w-2xl mx-auto space-y-6">
      <Helmet>
        <title>Da Haus — PNPtv!</title>
      </Helmet>

      {/* Hero */}
      <Card className="p-6 text-center space-y-4">
        <div
          className="w-16 h-16 mx-auto rounded-full flex items-center justify-center"
          style={{ background: "rgba(162, 89, 255, 0.15)" }}
        >
          <svg
            className="w-8 h-8"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
            style={{ color: "#A259FF" }}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"
            />
          </svg>
        </div>

        <div className="space-y-1">
          <h1 className="text-2xl font-bold text-pnp-textPrimary">Da Haus</h1>
          <div className="flex justify-center">
            <span
              className="text-xs font-bold px-3 py-1 rounded-full"
              style={{ background: "rgba(162,89,255,0.15)", color: "#A259FF" }}
            >
              Free for all
            </span>
          </div>
        </div>

        <p className="text-pnp-textSecondary leading-relaxed">
          The community hangout spot — open to everyone. Drop in, vibe,
          connect. No membership needed.
        </p>

        {isAuthenticated ? (
          <button
            onClick={handleJoinClick}
            className="w-full py-3 rounded-full text-base font-semibold text-white transition-opacity hover:opacity-90"
            style={{ background: "linear-gradient(135deg, #A259FF, #7C3AED)" }}
          >
            Join Da Haus
          </button>
        ) : (
          <div className="space-y-3">
            <p className="text-pnp-textSecondary text-sm">
              You need to be logged in to join the room.
            </p>
            <button
              onClick={() => navigate("/login")}
              className="w-full py-3 rounded-full text-base font-semibold text-white transition-opacity hover:opacity-90"
              style={{ background: "linear-gradient(135deg, #A259FF, #7C3AED)" }}
            >
              Log in to join
            </button>
          </div>
        )}
      </Card>

      {/* House Rules */}
      <Card className="p-6 space-y-3">
        <h3 className="font-semibold text-pnp-textPrimary">House Rules</h3>
        <ul className="text-pnp-textSecondary text-sm space-y-2.5">
          <li className="flex items-start gap-2.5">
            <span className="mt-0.5 shrink-0">🏠</span>
            <span>
              Da Haus is for everyone — free members welcome
            </span>
          </li>
          <li className="flex items-start gap-2.5">
            <span className="mt-0.5 shrink-0">🚫</span>
            <span>
              No recording — what happens in Da Haus stays in Da Haus
            </span>
          </li>
          <li className="flex items-start gap-2.5">
            <span className="mt-0.5 shrink-0">💬</span>
            <span>Keep it chill — respect is the house rule</span>
          </li>
          <li className="flex items-start gap-2.5">
            <span className="mt-0.5 shrink-0">🌈</span>
            <span>
              Safe space — hate speech gets you removed immediately
            </span>
          </li>
          <li className="flex items-start gap-2.5">
            <span className="mt-0.5 shrink-0">🎉</span>
            <span>Have fun — this is the vibe room</span>
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
