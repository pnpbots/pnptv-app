import React from "react";
import { Helmet } from "react-helmet-async";
import { useI18n } from "@/lib/i18n";
import { useCreatorData } from "@/hooks/useCreatorData";
import { PayoutsTab } from "@/pages/creator/PayoutsTab";

export default function CreatorPayouts() {
  const { creator: t } = useI18n();
  const { withdrawable, withdrawals, loading, reload } = useCreatorData();

  return (
    <>
      <Helmet>
        <title>Payouts — Creator Studio — PNPtv!</title>
      </Helmet>
      <div className="p-4 lg:p-6">
        {loading ? (
          <div className="animate-pulse space-y-4">
            <div className="h-32 bg-white/5 rounded-lg" />
            <div className="h-48 bg-white/5 rounded-lg" />
          </div>
        ) : (
          <PayoutsTab
            withdrawable={withdrawable}
            withdrawals={withdrawals}
            t={t}
            onReload={reload}
          />
        )}
      </div>
    </>
  );
}
