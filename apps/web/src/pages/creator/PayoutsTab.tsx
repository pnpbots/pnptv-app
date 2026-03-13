import React, { useState } from "react";
import { ConfirmDialog } from "@/components/creators/ConfirmDialog";
import { requestWithdrawal, type ModelWithdrawal } from "@/lib/api";
import type { CreatorStrings } from "@/lib/i18n/creator";

interface PayoutsTabProps {
  withdrawable: number;
  withdrawals: ModelWithdrawal[];
  t: CreatorStrings;
  onReload: () => Promise<void>;
}

export function PayoutsTab({ withdrawable, withdrawals, t, onReload }: PayoutsTabProps) {
  const [withdrawing, setWithdrawing] = useState(false);
  const [withdrawError, setWithdrawError] = useState<string | null>(null);
  const [withdrawSuccess, setWithdrawSuccess] = useState<string | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);

  const handleWithdraw = async () => {
    setShowConfirm(false);
    setWithdrawing(true);
    setWithdrawError(null);
    setWithdrawSuccess(null);
    try {
      const res = await requestWithdrawal("bank_transfer");
      setWithdrawSuccess(t.withdrawAmount(res.data.withdrawal.amountUsd.toFixed(2)) + " requested successfully");
      await onReload();
    } catch (err) {
      setWithdrawError(err instanceof Error ? err.message : "Failed to request withdrawal");
    } finally {
      setWithdrawing(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Withdraw card */}
      <div className="glass-card-sm p-5" style={{ borderColor: "rgba(94,209,196,0.2)" }}>
        <p className="text-sm font-semibold text-white mb-1">{t.requestWithdrawalTitle}</p>
        <p className="text-xs mb-3" style={{ color: "#8E8E93" }}>
          {t.availableBalance} <strong style={{ color: "#5ED1C4" }}>${withdrawable.toFixed(2)}</strong>
        </p>
        {withdrawSuccess && (
          <div className="mb-3 px-3 py-2 rounded-lg text-xs" style={{ background: "rgba(94,209,196,0.1)", color: "#5ED1C4" }}>
            {withdrawSuccess}
          </div>
        )}
        {withdrawError && (
          <div className="mb-3 px-3 py-2 rounded-lg text-xs text-red-300" style={{ background: "rgba(239,68,68,0.1)" }}>
            {withdrawError}
          </div>
        )}
        <button
          onClick={() => setShowConfirm(true)}
          disabled={withdrawing || withdrawable <= 0}
          className="text-xs font-semibold px-4 py-2 rounded-lg transition-colors disabled:opacity-40"
          style={{ background: "linear-gradient(135deg, #5ED1C4, #00D4E8)", color: "#000" }}
        >
          {withdrawing ? t.processing : withdrawable <= 0 ? t.noBalance : t.withdrawAmount(withdrawable.toFixed(2))}
        </button>
      </div>

      {/* Withdrawal history */}
      <div className="glass-card-sm p-4">
        <p className="text-sm font-semibold text-white mb-3">{t.withdrawalHistoryTitle}</p>
        {withdrawals.length === 0 ? (
          <p className="text-xs text-center py-4" style={{ color: "#8E8E93" }}>{t.noWithdrawalsYet}</p>
        ) : (
          <div className="space-y-2">
            {withdrawals.map((w) => (
              <div key={w.id} className="flex items-center justify-between py-2 border-b border-white/5 last:border-0">
                <div>
                  <p className="text-sm font-medium text-white">${w.amountUsd.toFixed(2)}</p>
                  <p className="text-xs" style={{ color: "#8E8E93" }}>
                    {new Date(w.requestedAt).toLocaleDateString()} &middot; {w.method.replace("_", " ")}
                  </p>
                </div>
                <span
                  className="text-xs font-semibold px-2 py-0.5 rounded-full"
                  style={{
                    background: w.status === "completed" ? "rgba(94,209,196,0.15)" :
                                w.status === "pending" ? "rgba(255,180,84,0.15)" : "rgba(142,142,147,0.15)",
                    color: w.status === "completed" ? "#5ED1C4" :
                           w.status === "pending" ? "#FFB454" : "#8E8E93",
                  }}
                >
                  {w.status}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Withdrawal confirmation dialog */}
      <ConfirmDialog
        open={showConfirm}
        title={t.withdrawConfirmTitle}
        message={t.withdrawConfirmMsg(withdrawable.toFixed(2))}
        confirmLabel={t.withdrawBtn}
        cancelLabel={t.cancelBtn}
        onConfirm={handleWithdraw}
        onCancel={() => setShowConfirm(false)}
      />
    </div>
  );
}
