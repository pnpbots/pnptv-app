import React from "react";
import { Helmet } from "react-helmet-async";
import { useI18n } from "@/lib/i18n";
import { useCreatorData } from "@/hooks/useCreatorData";
import { EarningsTab } from "@/pages/creator/EarningsTab";

export default function CreatorEarnings() {
  const { creator: t } = useI18n();
  const { earnings, loading } = useCreatorData();

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
        ) : (
          <EarningsTab earnings={earnings} t={t} />
        )}
      </div>
    </>
  );
}
