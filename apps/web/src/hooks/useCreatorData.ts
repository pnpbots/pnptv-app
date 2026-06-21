import { useState, useEffect, useCallback } from "react";
import {
  getCreatorEligibility,
  getCreatorDashboard,
  getModelEarnings,
  getWithdrawableAmount,
  getWithdrawalHistory,
  type CreatorEligibility,
  type CreatorDashboard as DashboardData,
  type ModelEarnings,
  type ModelWithdrawal,
} from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";

export interface CreatorDataResult {
  eligibility: CreatorEligibility | null;
  dashboard: (DashboardData & { success: boolean }) | null;
  earnings: ModelEarnings | null;
  withdrawable: number;
  withdrawals: ModelWithdrawal[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

export function useCreatorData(): CreatorDataResult {
  const { isAuthenticated } = useAuth();
  const [eligibility, setEligibility] = useState<CreatorEligibility | null>(null);
  const [dashboard, setDashboard] = useState<(DashboardData & { success: boolean }) | null>(null);
  const [earnings, setEarnings] = useState<ModelEarnings | null>(null);
  const [withdrawable, setWithdrawable] = useState<number>(0);
  const [withdrawals, setWithdrawals] = useState<ModelWithdrawal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [eligResult, dashResult] = await Promise.allSettled([
        getCreatorEligibility(),
        getCreatorDashboard(),
      ]);

      const eligRes = eligResult.status === "fulfilled" ? eligResult.value : null;
      const dashRes = dashResult.status === "fulfilled" ? dashResult.value : null;

      if (eligRes) setEligibility(eligRes);
      if (dashRes) setDashboard(dashRes);

      if (eligResult.status === "rejected" && dashResult.status === "rejected") {
        setError(
          eligResult.reason instanceof Error
            ? eligResult.reason.message
            : "Failed to load creator data"
        );
      }

      if (dashRes?.creatorStatus === "active") {
        const [earningsRes, withdrawableRes, historyRes] = await Promise.allSettled([
          getModelEarnings(),
          getWithdrawableAmount(),
          getWithdrawalHistory(),
        ]);
        if (earningsRes.status === "fulfilled" && earningsRes.value.success) {
          setEarnings(earningsRes.value.data);
        }
        if (withdrawableRes.status === "fulfilled" && withdrawableRes.value.success) {
          setWithdrawable(withdrawableRes.value.data.withdrawable.amount);
        }
        if (historyRes.status === "fulfilled" && historyRes.value.success) {
          setWithdrawals(historyRes.value.data.withdrawals);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load creator data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      reload();
    }
  }, [isAuthenticated, reload]);

  return { eligibility, dashboard, earnings, withdrawable, withdrawals, loading, error, reload };
}
