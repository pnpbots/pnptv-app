import React from "react";
import { Helmet } from "react-helmet-async";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/lib/i18n";
import { useCreatorData } from "@/hooks/useCreatorData";
import { OverviewTab } from "@/pages/creator/OverviewTab";

export default function CreatorOverview() {
  const { user } = useAuth();
  const { creator: t } = useI18n();
  const { dashboard, withdrawable, loading } = useCreatorData();
  const navigate = useNavigate();

  return (
    <>
      <Helmet>
        <title>Dashboard — Creator Studio — PNPtv!</title>
      </Helmet>
      <div className="p-4 lg:p-6">
        {loading ? (
          <div className="animate-pulse space-y-4">
            <div className="h-8 bg-white/5 rounded w-48" />
            <div className="grid grid-cols-2 gap-3">
              <div className="h-24 bg-white/5 rounded-lg" />
              <div className="h-24 bg-white/5 rounded-lg" />
              <div className="h-24 bg-white/5 rounded-lg" />
              <div className="h-24 bg-white/5 rounded-lg" />
            </div>
          </div>
        ) : dashboard ? (
          <OverviewTab
            dashboard={dashboard}
            user={user}
            withdrawable={withdrawable}
            t={t}
            onTabChange={(tab) => {
              if (tab === "payouts") navigate("/creators/payouts");
              else if (tab === "earnings") navigate("/creators/earnings");
              else if (tab === "content") navigate("/creators/content");
              else if (tab === "settings") navigate("/creators/settings");
            }}
          />
        ) : (
          <div className="text-center py-12">
            <p className="text-sm text-pnp-textSecondary">No data available.</p>
          </div>
        )}
      </div>
    </>
  );
}
