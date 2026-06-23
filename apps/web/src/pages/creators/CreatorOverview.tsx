import React from "react";
import { Helmet } from "react-helmet-async";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/lib/i18n";
import { useCreatorData } from "@/hooks/useCreatorData";
import { get2257Status } from "@/lib/api";
import { OverviewTab } from "@/pages/creator/OverviewTab";

export default function CreatorOverview() {
  const { user } = useAuth();
  const { creator: t } = useI18n();
  const { dashboard, withdrawable, loading } = useCreatorData();
  const navigate = useNavigate();
  const [identityVerified, setIdentityVerified] = React.useState<boolean | null>(null);

  React.useEffect(() => {
    get2257Status().then((res) => {
      if (res) setIdentityVerified(res.identity_verified);
    }).catch(() => {});
  }, []);

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
          <>
            {identityVerified === false && (
              <div
                className="mb-4 rounded-xl p-4 flex items-start gap-3 cursor-pointer"
                style={{ background: "rgba(212,0,122,0.08)", border: "1px solid rgba(212,0,122,0.3)" }}
                onClick={() => navigate("/creators/apply")}
              >
                <svg className="w-5 h-5 flex-shrink-0 mt-0.5 shrink-0" style={{ color: "#D4007A" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                </svg>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold" style={{ color: "#D4007A" }}>Identity verification required</p>
                  <p className="text-xs mt-0.5" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>
                    Complete your 2257 identity verification in Setup to keep your creator account active.
                  </p>
                </div>
                <svg className="w-4 h-4 shrink-0 mt-0.5" style={{ color: "#D4007A" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                </svg>
              </div>
            )}
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
          </>
        ) : (
          <div className="text-center py-12">
            <p className="text-sm text-pnp-textSecondary">No data available.</p>
          </div>
        )}
      </div>
    </>
  );
}
