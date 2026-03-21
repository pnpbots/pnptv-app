import React from "react";
import { Helmet } from "react-helmet-async";
import { useI18n } from "@/lib/i18n";
import { useCreatorData } from "@/hooks/useCreatorData";
import { SettingsTab } from "@/pages/creator/SettingsTab";

export default function CreatorSettings() {
  const { creator: t } = useI18n();
  const { dashboard, loading } = useCreatorData();

  return (
    <>
      <Helmet>
        <title>Settings — Creator Studio — PNPtv!</title>
      </Helmet>
      <div className="p-4 lg:p-6">
        {loading ? (
          <div className="animate-pulse space-y-4">
            <div className="h-40 bg-white/5 rounded-lg" />
            <div className="h-32 bg-white/5 rounded-lg" />
          </div>
        ) : dashboard ? (
          <SettingsTab dashboard={dashboard} t={t} />
        ) : (
          <div className="glass-card-sm p-8 text-center">
            <p className="text-sm text-pnp-textSecondary">No creator data available.</p>
          </div>
        )}
      </div>
    </>
  );
}
