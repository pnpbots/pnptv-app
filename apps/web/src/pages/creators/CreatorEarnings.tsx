import React from "react";
import { Helmet } from "react-helmet-async";
import { useI18n } from "@/lib/i18n";
import { useCreatorData } from "@/hooks/useCreatorData";
import { EarningsTab } from "@/pages/creator/EarningsTab";

export default function CreatorEarnings() {
  const { creator: t } = useI18n();
  const { earnings, loading, error, reload } = useCreatorData();

  return (
    <>
      <Helmet>
        <title>Earnings — Creator Studio — PNPtv!</title>
      </Helmet>
      <div className="p-4 lg:p-6">
        {loading ? (
          <div className="animate-pulse space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="h-24 bg-white/5 rounded-lg" />
              <div className="h-24 bg-white/5 rounded-lg" />
            </div>
            <div className="h-48 bg-white/5 rounded-lg" />
          </div>
        ) : error ? (
          <div
            className="rounded-xl p-6 text-center"
            style={{ background: "rgba(239,68,68,0.05)", border: "1px solid rgba(239,68,68,0.2)" }}
          >
            <p className="text-sm text-red-400 mb-3">{error}</p>
            <button
              onClick={reload}
              className="text-xs font-semibold px-4 py-2 rounded-lg transition-opacity hover:opacity-80"
              style={{ background: "rgba(255,255,255,0.08)", color: "#fff" }}
            >
              Retry
            </button>
          </div>
        ) : (
          <EarningsTab earnings={earnings} t={t} />
        )}
      </div>
    </>
  );
}
