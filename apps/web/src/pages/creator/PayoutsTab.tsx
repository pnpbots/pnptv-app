import React, { useState } from "react";
import { ConfirmDialog } from "@/components/creators/ConfirmDialog";
import { requestWithdrawal, type ModelWithdrawal } from "@/lib/api";
import type { CreatorStrings } from "@/lib/i18n/creator";

type PayoutMethod = "bank_transfer" | "dash";

const DASH_ADDRESS_REGEX = /^[X7][1-9A-HJ-NP-Za-km-z]{33}$/;

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
  const [payoutMethod, setPayoutMethod] = useState<PayoutMethod>("bank_transfer");
  const [dashAddress, setDashAddress] = useState("");
  const [dashAddressError, setDashAddressError] = useState<string | null>(null);

  const validateAndConfirm = () => {
    setDashAddressError(null);
    if (payoutMethod === "dash") {
      const trimmed = dashAddress.trim();
      if (!trimmed) {
        setDashAddressError("Please enter your Dash wallet address.");
        return;
      }
      if (!DASH_ADDRESS_REGEX.test(trimmed)) {
        setDashAddressError("Invalid Dash address. Mainnet addresses start with X (or 7) and are 34 characters long.");
        return;
      }
    }
    setShowConfirm(true);
  };

  const handleWithdraw = async () => {
    setShowConfirm(false);
    setWithdrawing(true);
    setWithdrawError(null);
    setWithdrawSuccess(null);
    try {
      const paymentDetails: Record<string, string> = {};
      if (payoutMethod === "dash" && dashAddress.trim()) {
        paymentDetails.dash_address = dashAddress.trim();
      }
      const res = await requestWithdrawal(payoutMethod, paymentDetails);
      setWithdrawSuccess(
        t.withdrawAmount(res.data.withdrawal.amountUsd.toFixed(2)) +
          " requested successfully. You will receive a Dash claim link by email shortly."
      );
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
        <p className="text-xs mb-4" style={{ color: "#8E8E93" }}>
          {t.availableBalance} <strong style={{ color: "#5ED1C4" }}>${withdrawable.toFixed(2)}</strong>
        </p>

        {/* Payout method selector */}
        <div className="mb-4">
          <label className="block text-xs font-medium mb-1.5" style={{ color: "#8E8E93" }}>
            Payout Method
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => { setPayoutMethod("bank_transfer"); setDashAddressError(null); }}
              className="flex-1 text-xs font-semibold py-2 px-3 rounded-lg border transition-colors"
              style={{
                background: payoutMethod === "bank_transfer" ? "rgba(94,209,196,0.12)" : "rgba(255,255,255,0.04)",
                borderColor: payoutMethod === "bank_transfer" ? "#5ED1C4" : "rgba(255,255,255,0.1)",
                color: payoutMethod === "bank_transfer" ? "#5ED1C4" : "#8E8E93",
              }}
            >
              Bank Transfer
            </button>
            <button
              type="button"
              onClick={() => { setPayoutMethod("dash"); setDashAddressError(null); }}
              className="flex-1 text-xs font-semibold py-2 px-3 rounded-lg border transition-colors"
              style={{
                background: payoutMethod === "dash" ? "rgba(0,141,228,0.12)" : "rgba(255,255,255,0.04)",
                borderColor: payoutMethod === "dash" ? "#008DE4" : "rgba(255,255,255,0.1)",
                color: payoutMethod === "dash" ? "#008DE4" : "#8E8E93",
              }}
            >
              🥷 Dash
            </button>
          </div>
        </div>

        {/* Method-specific instructions / inputs */}
        {payoutMethod === "bank_transfer" && (
          <div
            className="mb-4 px-3 py-3 rounded-lg text-xs"
            style={{ background: "rgba(255,255,255,0.04)", color: "#8E8E93", lineHeight: "1.6" }}
          >
            <strong style={{ color: "#fff", display: "block", marginBottom: 4 }}>Bank Transfer</strong>
            To receive payouts via bank transfer, contact{" "}
            <a href="mailto:support@pnptv.app" style={{ color: "#5ED1C4" }}>
              support@pnptv.app
            </a>{" "}
            to provide your banking details securely. Our team will process the transfer within 1–3 business days after approval.
          </div>
        )}

        {payoutMethod === "dash" && (
          <div className="mb-4">
            <label className="block text-xs font-medium mb-1.5" style={{ color: "#8E8E93" }}>
              Dash Wallet Address
            </label>
            <input
              type="text"
              value={dashAddress}
              onChange={(e) => { setDashAddress(e.target.value); setDashAddressError(null); }}
              placeholder="e.g. Xa1bc2d3e... (34 chars, starts with X or 7)"
              className="w-full text-xs px-3 py-2 rounded-lg border outline-none font-mono"
              style={{
                background: "rgba(255,255,255,0.05)",
                borderColor: dashAddressError ? "#ef4444" : "rgba(255,255,255,0.12)",
                color: "#fff",
              }}
            />
            {dashAddressError && (
              <p className="mt-1 text-xs" style={{ color: "#ef4444" }}>{dashAddressError}</p>
            )}
            <p className="mt-1 text-xs leading-relaxed" style={{ color: "#8E8E93" }}>
              You'll receive an email with a claim link. Open it, paste this Dash address, and BTCPay sends the funds on-chain. Your USD balance is converted to Dash at the live exchange rate at claim time.
            </p>
          </div>
        )}

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
          onClick={validateAndConfirm}
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
        message={
          payoutMethod === "dash"
            ? `Request payout of $${withdrawable.toFixed(2)} in Dash to ${dashAddress.trim()}?`
            : t.withdrawConfirmMsg(withdrawable.toFixed(2))
        }
        confirmLabel={t.withdrawBtn}
        cancelLabel={t.cancelBtn}
        onConfirm={handleWithdraw}
        onCancel={() => setShowConfirm(false)}
      />
    </div>
  );
}
