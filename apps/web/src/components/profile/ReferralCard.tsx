import React, { useState, useEffect } from "react";
import { useI18n } from "@/lib/i18n";
import { getMyReferral, type ReferralStats } from "@/lib/api";

// ── Component ─────────────────────────────────────────────────────────────────

export default function ReferralCard() {
  const t = useI18n();
  const p = t.profile;
  const [stats, setStats] = useState<ReferralStats | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    getMyReferral().then(setStats).catch(() => {});
  }, []);

  const copy = () => {
    if (!stats?.link) return;
    navigator.clipboard.writeText(stats.link).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="glass-card-sm p-5 mt-4">
      <h2 className="text-sm font-semibold text-white mb-1 tracking-wide uppercase opacity-60">{p.referralProgram}</h2>
      <p className="text-xs mb-4" style={{ color: "#8E8E93" }}>
        {p.referralInviteDesc} <strong style={{ color: "#FFB454" }}>{p.referralFreePrime}</strong> {p.referralWhenTheyJoin}
      </p>
      {stats ? (
        <>
          <div className="flex items-center gap-2 mb-3">
            <div
              className="flex-1 px-3 py-2 rounded-lg text-xs font-mono truncate"
              style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "#fff" }}
            >
              {stats.link}
            </div>
            <button
              onClick={copy}
              className="px-3 py-2 rounded-lg text-xs font-medium flex-shrink-0 transition-colors"
              style={{
                background: copied ? "rgba(94,209,196,0.15)" : "rgba(255,180,84,0.15)",
                border: copied ? "1px solid rgba(94,209,196,0.4)" : "1px solid rgba(255,180,84,0.4)",
                color: copied ? "#5ED1C4" : "#FFB454",
              }}
            >
              {copied ? p.copied : p.copy}
            </button>
          </div>
          <div className="flex gap-4">
            <div className="text-center">
              <div className="text-xl font-bold text-white">{stats.total}</div>
              <div className="text-[10px]" style={{ color: "#8E8E93" }}>{p.invited}</div>
            </div>
            <div className="text-center">
              <div className="text-xl font-bold" style={{ color: "#FFB454" }}>{stats.completed}</div>
              <div className="text-[10px]" style={{ color: "#8E8E93" }}>{p.joined_noun}</div>
            </div>
            <div className="text-center">
              <div className="text-xl font-bold" style={{ color: "#5ED1C4" }}>{stats.completed * 3}</div>
              <div className="text-[10px]" style={{ color: "#8E8E93" }}>{p.daysEarned}</div>
            </div>
          </div>
        </>
      ) : (
        <div className="h-16 rounded-lg animate-pulse" style={{ background: "rgba(255,255,255,0.05)" }} />
      )}
    </div>
  );
}
