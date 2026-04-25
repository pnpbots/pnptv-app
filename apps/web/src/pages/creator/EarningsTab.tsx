import React from "react";
import type { ModelEarnings } from "@/lib/api";
import type { CreatorStrings } from "@/lib/i18n/creator";

interface EarningsTabProps {
  earnings: ModelEarnings | null;
  t: CreatorStrings;
}

export function EarningsTab({ earnings, t }: EarningsTabProps) {
  return (
    <div className="space-y-4">
      {earnings ? (
        <>
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

          {/* Revenue trends */}
          {earnings.trends && earnings.trends.length > 0 && (
            <div className="glass-card-sm p-4">
              <p className="text-sm font-semibold text-white mb-3">{t.monthlyTrends}</p>
              <div className="space-y-2">
                {earnings.trends.slice(-6).map((trend, i) => {
                  const maxAmount = Math.max(...earnings.trends.slice(-6).map(x => x.amount), 1);
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
            </div>
          )}
        </>
      ) : (
        <div className="glass-card-sm p-8 text-center">
          <p className="text-white/60 text-sm">{t.noEarningsYet}</p>
        </div>
      )}
    </div>
  );
}
