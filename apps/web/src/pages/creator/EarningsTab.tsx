import React, { useState, useEffect, useCallback } from "react";
import type { ModelEarnings, CreatorPayoutBalance, CreatorPayoutRecord, CreatorEarningsTrend } from "@/lib/api";
import { getCreatorPayoutBalance, requestCreatorPayout, getCreatorPayoutHistory, getCreatorEarnings } from "@/lib/api";
import type { CreatorStrings } from "@/lib/i18n/creator";

interface EarningsTabProps {
  earnings: ModelEarnings | null;
  t: CreatorStrings;
}

function statusBadge(status: string) {
  if (status === 'sent' || status === 'completed') {
    return <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-teal-500/20 text-teal-400">Sent</span>;
  }
  if (status === 'failed') {
    return <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-500/20 text-red-400">Failed</span>;
  }
  return <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-amber-500/20 text-amber-400">Processing</span>;
}

export function EarningsTab({ earnings, t }: EarningsTabProps) {
  const [period, setPeriod] = useState<3 | 6 | 12>(6);

  const [balance, setBalance] = useState<CreatorPayoutBalance | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(true);
  // FIX 12: Track balance fetch errors so creators see a retry option instead of silent failure
  const [balanceError, setBalanceError] = useState(false);

  const [showWithdraw, setShowWithdraw] = useState(false);
  const [withdrawAddress, setWithdrawAddress] = useState('');
  const [withdrawLoading, setWithdrawLoading] = useState(false);
  const [withdrawError, setWithdrawError] = useState('');
  const [withdrawSuccess, setWithdrawSuccess] = useState<{ payoutId: string | null } | null>(null);

  const [payouts, setPayouts] = useState<CreatorPayoutRecord[]>([]);
  const [payoutsLoading, setPayoutsLoading] = useState(true);

  // FIX 8: Trends are fetched server-side with the selected period so the
  // months window is enforced at the DB level, not by slicing a fixed 6-month array.
  const [trends, setTrends] = useState<CreatorEarningsTrend[]>(() => earnings?.trends || []);
  const [trendsLoading, setTrendsLoading] = useState(false);

  // FIX 12: Extracted so it can be called on initial load and after a successful payout
  const fetchBalance = useCallback(() => {
    setBalanceLoading(true);
    setBalanceError(false);
    return getCreatorPayoutBalance()
      .then(res => { if (res.success) setBalance(res); })
      .catch(() => { setBalanceError(true); })
      .finally(() => setBalanceLoading(false));
  }, []);

  useEffect(() => {
    fetchBalance();

    setPayoutsLoading(true);
    getCreatorPayoutHistory()
      .then(res => { if (res.success) setPayouts(res.payouts.slice(0, 5)); })
      .catch(() => {})
      .finally(() => setPayoutsLoading(false));
  }, [fetchBalance]);

  // FIX 8: Re-fetch trends from server whenever the period selector changes
  useEffect(() => {
    setTrendsLoading(true);
    getCreatorEarnings({ months: period })
      .then(res => { if (res.success) setTrends(res.trends); })
      .catch(() => {})
      .finally(() => setTrendsLoading(false));
  }, [period]);

  async function handleWithdrawSubmit(e: React.FormEvent) {
    e.preventDefault();
    setWithdrawError('');
    setWithdrawLoading(true);
    try {
      const res = await requestCreatorPayout({ address: withdrawAddress.trim() });
      if (res.success) {
        setWithdrawSuccess({ payoutId: res.payout.nowpayments_payout_id });
        // FIX 12: Refetch authoritative server balance instead of optimistic mutation
        fetchBalance();
        getCreatorPayoutHistory()
          .then(r => { if (r.success) setPayouts(r.payouts.slice(0, 5)); })
          .catch(() => {});
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Payout request failed';
      setWithdrawError(msg);
    } finally {
      setWithdrawLoading(false);
    }
  }

  const canWithdraw = balance && balance.available_usd >= 5 && !withdrawSuccess;

  return (
    <div className="space-y-4">
      {earnings ? (
        <div className="grid grid-cols-2 gap-3">
          <div className="glass-card-sm p-4 text-center">
            <p className="text-xl font-bold" style={{ color: "#5ED1C4" }}>
              ${(earnings.summary.total_creator || 0).toFixed(2)}
            </p>
            <p className="text-xs mt-1" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>{t.yourEarnings70}</p>
          </div>
          <div className="glass-card-sm p-4 text-center">
            <p className="text-xl font-bold text-white">
              ${(earnings.summary.total_gross || 0).toFixed(2)}
            </p>
            <p className="text-xs mt-1" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>{t.grossRevenue}</p>
          </div>
        </div>
      ) : (
        <div className="glass-card-sm p-8 text-center">
          <p className="text-white/60 text-sm">{t.noEarningsYet}</p>
        </div>
      )}

      <div className="glass-card-sm p-4">
        <p className="text-sm font-semibold text-white mb-3">{t.monthlyTrends}</p>

        <div className="flex gap-2 mb-3">
          {([3, 6, 12] as const).map(p => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
                period === p
                  ? 'bg-[#D4007A] text-white'
                  : 'bg-white/5 text-pnp-textSecondary hover:bg-white/10'
              }`}
            >
              {p}m
            </button>
          ))}
        </div>

        {trendsLoading ? (
          <div className="space-y-2">
            {[0, 1, 2].map(i => <div key={i} className="h-4 rounded-full bg-white/5 animate-pulse" />)}
          </div>
        ) : trends.length === 0 ? (
          <p className="text-xs text-white/40">No earnings in the last {period} months</p>
        ) : (
          <div className="space-y-2">
            {trends.map((trend, i) => {
              const maxAmount = Math.max(...trends.map(x => x.amount), 1);
              const pct = (trend.amount / maxAmount) * 100;
              return (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-xs w-16 flex-shrink-0" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>
                    {new Date(trend.month).toLocaleDateString("en-US", { month: "short", year: "2-digit" })}
                  </span>
                  <div className="flex-1 h-4 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.05)" }}>
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${pct}%`, background: "linear-gradient(to right, #D4007A, #E69138)" }}
                    />
                  </div>
                  <span className="text-xs font-medium text-white w-16 text-right">${trend.amount.toFixed(2)}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="glass-card-sm p-4 space-y-3">
        <p className="text-sm font-semibold text-white">Withdraw Earnings</p>

        {balanceLoading ? (
          <div className="h-12 rounded-lg bg-white/5 animate-pulse" />
        ) : balanceError ? (
          <div className="space-y-2">
            <p className="text-xs text-red-400">Could not load your balance. Check your connection and try again.</p>
            <button
              onClick={fetchBalance}
              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-white/10 text-white hover:bg-white/20 transition-colors"
            >
              Retry
            </button>
          </div>
        ) : balance ? (
          <>
            <div className="flex items-end justify-between">
              <div>
                <p className="text-2xl font-bold" style={{ color: "#5ED1C4" }}>
                  ${balance.available_usd.toFixed(2)}
                  <span className="text-sm font-normal ml-1" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>available</span>
                </p>
                {balance.holding_count > 0 && (
                  <p className="text-xs mt-0.5" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>
                    ${balance.holding_usd.toFixed(2)} releasing
                    {balance.earliest_available_at
                      ? ` ${new Date(balance.earliest_available_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
                      : ' soon'}
                  </p>
                )}
                {balance.in_payout_usd > 0 && (
                  <p className="text-xs mt-0.5 text-amber-400">${balance.in_payout_usd.toFixed(2)} in transit</p>
                )}
              </div>

              {!showWithdraw && !withdrawSuccess && (
                <button
                  onClick={() => setShowWithdraw(true)}
                  disabled={!canWithdraw}
                  className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all ${
                    canWithdraw
                      ? 'bg-[#D4007A] text-white hover:bg-[#b8006a] active:scale-95'
                      : 'bg-white/10 text-white/30 cursor-not-allowed'
                  }`}
                >
                  {balance.available_usd < 5 ? 'Min. $5.00' : 'Withdraw All'}
                </button>
              )}
            </div>

            {withdrawSuccess && (
              <div className="rounded-xl p-3 bg-teal-500/10 border border-teal-500/20">
                <p className="text-sm font-semibold text-teal-400">Payout initiated</p>
                {withdrawSuccess.payoutId && (
                  <p className="text-xs mt-0.5" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>
                    ID: {withdrawSuccess.payoutId}
                  </p>
                )}
              </div>
            )}

            {showWithdraw && !withdrawSuccess && (
              <form onSubmit={handleWithdrawSubmit} className="space-y-3 pt-1 border-t border-white/10">
                <div>
                  <p className="text-xs font-medium text-white/60 mb-1.5">USDT TRC-20 wallet address</p>
                  <input
                    type="text"
                    placeholder="T…"
                    value={withdrawAddress}
                    onChange={e => setWithdrawAddress(e.target.value)}
                    required
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder-white/30 focus:outline-none focus:border-[#D4007A] font-mono"
                  />
                </div>

                <div className="flex items-center justify-between text-xs" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>
                  <span>Withdrawing</span>
                  <span className="font-semibold text-white">${balance.available_usd.toFixed(2)}</span>
                </div>

                {withdrawError && (
                  <p className="text-xs text-red-400 bg-red-500/10 rounded-lg px-3 py-2">{withdrawError}</p>
                )}

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => { setShowWithdraw(false); setWithdrawError(''); setWithdrawAddress(''); }}
                    className="flex-1 py-2.5 rounded-xl text-sm font-medium bg-white/5 text-white/60 hover:bg-white/10 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={withdrawLoading || !withdrawAddress.trim()}
                    className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-[#D4007A] text-white hover:bg-[#b8006a] disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-95"
                  >
                    {withdrawLoading ? 'Sending…' : 'Confirm Withdrawal'}
                  </button>
                </div>
              </form>
            )}
          </>
        ) : (
          <p className="text-xs text-white/40">Balance unavailable</p>
        )}
      </div>

      <div className="glass-card-sm p-4 space-y-3">
        <p className="text-sm font-semibold text-white">Recent Payouts</p>
        {payoutsLoading ? (
          <div className="space-y-2">
            {[0, 1, 2].map(i => <div key={i} className="h-10 rounded-lg bg-white/5 animate-pulse" />)}
          </div>
        ) : payouts.length === 0 ? (
          <p className="text-xs text-white/40">No payouts yet</p>
        ) : (
          <div className="space-y-2">
            {payouts.map(p => (
              <div key={p.id} className="flex items-center justify-between py-2 border-b border-white/5 last:border-0">
                <div className="flex items-center gap-2">
                  {statusBadge(p.status)}
                  <div>
                    <p className="text-xs font-medium text-white">${Number(p.amount_usd).toFixed(2)}</p>
                    <p className="text-xs" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>USDT TRC-20</p>
                  </div>
                </div>
                <span className="text-xs" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>
                  {p.requested_at
                    ? new Date(p.requested_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })
                    : '—'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
