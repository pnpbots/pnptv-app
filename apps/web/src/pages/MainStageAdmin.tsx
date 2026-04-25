import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMainStage } from "@/hooks/useMainStage";
import { AdminPanelContent } from "@/pages/MainStage";
import type { MainStageState } from "@/lib/api";

interface MainStageAdminProps {
  standalone?: boolean;
}

function CammerRow({
  identity,
  isFocused,
  onSpotlight,
  onMute,
  onKick,
}: {
  identity: string;
  isFocused: boolean;
  onSpotlight: () => void;
  onMute: () => void;
  onKick: () => void;
}) {
  return (
    <div
      className="flex items-center gap-3 px-4 py-3 transition-colors"
      style={{
        background: isFocused ? "rgba(212,0,122,0.08)" : "transparent",
        borderBottom: "1px solid rgba(255,255,255,0.05)",
      }}
    >
      {/* Avatar placeholder */}
      <div
        className="w-9 h-9 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-bold"
        style={{
          background: isFocused
            ? "linear-gradient(135deg,#D4007A,#7B61FF)"
            : "rgba(255,255,255,0.08)",
          color: isFocused ? "#fff" : "rgba(255,255,255,0.50)",
        }}
      >
        {identity.slice(0, 2).toUpperCase()}
      </div>

      {/* Identity */}
      <div className="flex-1 min-w-0">
        <p className="text-white text-xs font-semibold truncate">{identity}</p>
        {isFocused && (
          <p className="text-xs" style={{ color: "#D4007A" }}>
            Spotlighted
          </p>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 flex-shrink-0">
        <button
          type="button"
          aria-label={`Spotlight ${identity}`}
          onClick={onSpotlight}
          disabled={isFocused}
          className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-xl transition-all active:scale-[0.92] disabled:opacity-30 disabled:cursor-not-allowed"
          style={{ background: "rgba(212,0,122,0.12)", border: "1px solid rgba(212,0,122,0.20)" }}
          title="Set as spotlight"
        >
          <svg className="w-3.5 h-3.5" style={{ color: "#D4007A" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <circle cx="12" cy="10" r="4" />
            <path strokeLinecap="round" d="M12 14v5M8 19h8" />
          </svg>
        </button>

        <button
          type="button"
          aria-label={`Mute ${identity}`}
          onClick={onMute}
          className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-xl transition-all active:scale-[0.92]"
          style={{ background: "rgba(255,165,0,0.10)", border: "1px solid rgba(255,165,0,0.20)" }}
          title="Mute"
        >
          <svg className="w-3.5 h-3.5 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3zM3 3l18 18" />
          </svg>
        </button>

        <button
          type="button"
          aria-label={`Kick ${identity}`}
          onClick={onKick}
          className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-xl transition-all active:scale-[0.92]"
          style={{ background: "rgba(255,69,58,0.10)", border: "1px solid rgba(255,69,58,0.20)" }}
          title="Kick"
        >
          <svg className="w-3.5 h-3.5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M22 10.5h-6m-2.25-4.125a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zM4 19.235v-.11a6.375 6.375 0 0112.75 0v.109A12.318 12.318 0 0110.374 21c-2.331 0-4.512-.645-6.374-1.766z" />
          </svg>
        </button>
      </div>
    </div>
  );
}

export default function MainStageAdmin({ standalone = true }: MainStageAdminProps) {
  const navigate = useNavigate();
  const { state, isAdmin, admin, loading, error } = useMainStage();

  // Simulated cammer list from state.counts — in real usage the socket would
  // provide a list of identities; we derive it from participants in the room.
  // For the standalone admin page, we show the count and let the admin use
  // the embedded AdminPanelContent which surfaces all controls.

  if (!isAdmin) {
    return (
      <div
        className="fixed inset-0 flex flex-col items-center justify-center gap-4 px-6 text-center"
        style={{ background: "var(--pnp-background, #0A0A0F)" }}
      >
        <div
          className="w-14 h-14 rounded-2xl flex items-center justify-center"
          style={{ background: "rgba(255,69,58,0.10)", border: "1px solid rgba(255,69,58,0.20)" }}
        >
          <svg className="w-7 h-7 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
          </svg>
        </div>
        <div>
          <p className="text-white font-semibold text-sm mb-1">Admin only</p>
          <p className="text-white/40 text-xs">You don't have permission to view this page.</p>
        </div>
        <button
          type="button"
          onClick={() => navigate("/main-stage")}
          className="min-h-[44px] px-6 rounded-2xl text-sm font-semibold text-white transition-all active:scale-[0.97]"
          style={{ background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.10)" }}
        >
          Back to Main Stage
        </button>
      </div>
    );
  }

  if (loading) {
    return (
      <div
        className="fixed inset-0 flex flex-col items-center justify-center gap-4"
        style={{ background: "var(--pnp-background, #0A0A0F)" }}
      >
        <div
          className="w-8 h-8 rounded-full border-2 animate-spin"
          style={{ borderColor: "rgba(212,0,122,0.2)", borderTopColor: "#D4007A" }}
        />
        <p className="text-white/50 text-sm">Loading…</p>
      </div>
    );
  }

  if (error || !state) {
    return (
      <div
        className="fixed inset-0 flex flex-col items-center justify-center gap-4 px-6 text-center"
        style={{ background: "var(--pnp-background, #0A0A0F)" }}
      >
        <p className="text-red-400 text-sm">{error ?? "Failed to load state"}</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="min-h-[44px] px-5 rounded-2xl text-sm font-semibold text-white transition-all active:scale-[0.97]"
          style={{ background: "linear-gradient(135deg,#D4007A,#7B61FF)" }}
        >
          Retry
        </button>
      </div>
    );
  }

  if (standalone) {
    return (
      <div
        className="fixed inset-0 flex flex-col"
        style={{
          background: "var(--pnp-background, #111117)",
          paddingTop: "env(safe-area-inset-top, 0px)",
          paddingBottom: "env(safe-area-inset-bottom, 0px)",
        }}
      >
        {/* Standalone header */}
        <header
          className="flex-shrink-0 flex items-center justify-between px-4 h-14"
          style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}
        >
          <button
            type="button"
            aria-label="Back to Main Stage"
            onClick={() => navigate("/main-stage")}
            className="min-h-[44px] flex items-center gap-1.5 text-xs font-semibold text-white/60 hover:text-white transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            Main Stage
          </button>
          <h1 className="text-white font-bold text-sm">Admin Console</h1>
          <div className="w-16" />
        </header>

        <div className="flex-1 overflow-y-auto">
          <AdminPanelContent state={state} admin={admin} cammerInfos={[]} />
        </div>
      </div>
    );
  }

  // When used as a drawer (non-standalone), render just the panel content
  return <AdminPanelContent state={state} admin={admin} cammerInfos={[]} />;
}
