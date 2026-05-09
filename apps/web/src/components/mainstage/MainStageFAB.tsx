import React, { useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { getMainStageState } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

export function MainStageFAB() {
  const navigate = useNavigate();
  const location = useLocation();
  const t = useI18n();
  const [isLive, setIsLive] = useState(false);
  const [participantCount, setParticipantCount] = useState(0);
  const isMainStageRoute = location.pathname === "/main-stage";

  useEffect(() => {
    if (isMainStageRoute) return;

    let cancelled = false;
    const checkState = async () => {
      try {
        const res = await getMainStageState();
        if (cancelled) return;
        const participantCount = res.counts?.participants ?? res.counts?.cammers ?? 0;
        setIsLive(participantCount > 0);
        setParticipantCount(participantCount);
      } catch {
        if (!cancelled) setIsLive(false);
      }
    };

    checkState();
    const interval = setInterval(checkState, 30000); // Check every 30s
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [isMainStageRoute]);

  // Don't show if already on main stage or nobody is live
  if (isMainStageRoute || !isLive) return null;

  return (
    <div
      className="fixed right-4 z-[40] bottom-32 animate-in fade-in slide-in-from-bottom-4 duration-500"
    >
      <div className="main-stage-cristina-float">
        <button
          onClick={() => navigate("/main-stage")}
          className="relative group flex items-center gap-2 pl-3 pr-4 py-2.5 rounded-2xl shadow-2xl transition-all hover:scale-105 active:scale-95 overflow-hidden border border-white/20"
          style={{
            background: "linear-gradient(135deg, #D4007A, #7B61FF)",
          }}
          aria-label={t.live.mainStageAriaGoToStage}
        >
          {/* Animated background glow */}
          <div className="absolute inset-0 bg-white/20 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />

          {/* Pulsing "Live" indicator */}
          <div className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-white" />
          </div>

          <div className="flex flex-col items-start leading-tight">
            <span className="text-[10px] font-bold text-white/80 uppercase tracking-widest">{t.live.mainStageFabLabel}</span>
            <span className="text-xs font-extrabold text-white">
              {isLive ? `${participantCount} ${t.live.mainStageFabOnCam}` : t.live.mainStageFabLiveNow}
            </span>
          </div>

          {/* Video icon */}
          <svg className="w-4 h-4 text-white ml-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9A2.25 2.25 0 004.5 18.75z" />
          </svg>
        </button>
      </div>
    </div>
  );
}
