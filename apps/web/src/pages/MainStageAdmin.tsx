import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useMainStage } from "@/hooks/useMainStage";
import { AdminPanelContent } from "@/pages/MainStage";
import { useI18n } from "@/lib/i18n";

interface MainStageAdminProps {
  standalone?: boolean;
}

export default function MainStageAdmin({ standalone = true }: MainStageAdminProps) {
  const navigate = useNavigate();
  const t = useI18n();
  const { state, isAdmin, admin, loading, error } = useMainStage();

  // Derive cammer list from the socket-broadcast spotlight queue.
  // state.spotlight.queue is an array of identity strings kept live by the
  // mainstage:state socket events — no LiveKitRoom context required.
  // AdminPanelContent only needs { identity, name } for its moderation buttons.
  const cammerInfos = useMemo(
    () =>
      (state?.spotlight?.queue ?? []).map((identity) => ({
        identity,
        name: identity,
      })),
    [state?.spotlight?.queue]
  );

  if (!isAdmin) {
    return (
      <div
        className="fixed inset-0 flex flex-col items-center justify-center gap-4 px-6 text-center bg-pnp-background"
      >
        <div className="w-14 h-14 rounded-2xl flex items-center justify-center bg-pnp-error/10 border border-pnp-error/20">
          <svg className="w-7 h-7 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
          </svg>
        </div>
        <div>
          <p className="text-white font-semibold text-sm mb-1">{t.live.mainStageAdminOnly}</p>
          <p className="text-white/40 text-xs">{t.live.mainStageNoPermission}</p>
        </div>
        <button
          type="button"
          onClick={() => navigate("/main-stage")}
          className="min-h-[44px] px-6 rounded-2xl text-sm font-semibold text-white transition-all active:scale-[0.97] bg-white/[0.07] border border-white/10"
        >
          {t.live.mainStageBackToStage}
        </button>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="fixed inset-0 flex flex-col items-center justify-center gap-4 bg-pnp-background">
        <div
          className="w-8 h-8 rounded-full border-2 animate-spin"
          style={{ borderColor: "rgba(212,0,122,0.2)", borderTopColor: "#D4007A" }}
        />
        <p className="text-white/50 text-sm">{t.live.mainStageLoading}</p>
      </div>
    );
  }

  if (error || !state) {
    return (
      <div className="fixed inset-0 flex flex-col items-center justify-center gap-4 px-6 text-center bg-pnp-background">
        <p className="text-red-400 text-sm">{error ?? t.live.mainStageFailedToLoadState}</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="min-h-[44px] px-5 rounded-2xl text-sm font-semibold text-white transition-all active:scale-[0.97]"
          style={{ background: "linear-gradient(135deg,#D4007A,#7B61FF)" }}
        >
          {t.live.mainStageRetry}
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
        <header className="flex-shrink-0 flex items-center justify-between px-4 h-14 border-b border-white/[0.07]">
          <button
            type="button"
            aria-label={t.live.mainStageBackToStage}
            onClick={() => navigate("/main-stage")}
            className="min-h-[44px] flex items-center gap-1.5 text-xs font-semibold text-white/60 hover:text-white transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            {t.live.mainStageTitle}
          </button>
          <h1 className="text-white font-bold text-sm">{t.live.mainStageAdminConsole}</h1>
          <div className="w-16" />
        </header>

        <div className="flex-1 overflow-y-auto">
          <AdminPanelContent state={state} admin={admin} cammerInfos={cammerInfos} />
        </div>
      </div>
    );
  }

  // When used as a drawer (non-standalone), render just the panel content
  return <AdminPanelContent state={state} admin={admin} cammerInfos={cammerInfos} />;
}
