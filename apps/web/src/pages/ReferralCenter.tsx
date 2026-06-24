import React, { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/lib/i18n";
import {
  getMyReferral,
  getReferralList,
  type ReferralStats,
  type ReferralEntry,
} from "@/lib/api";

// ── Helpers ───────────────────────────────────────────────────────────────────

function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }).catch(() => {/* blocked — silent */});
  };
  return (
    <button
      type="button"
      onClick={handleCopy}
      className="inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-xl transition-all"
      style={{
        background: copied ? "rgba(34,197,94,0.15)" : "rgba(212,0,122,0.12)",
        color: copied ? "#4ADE80" : "#D4007A",
        border: copied ? "1px solid rgba(34,197,94,0.30)" : "1px solid rgba(212,0,122,0.25)",
        flexShrink: 0,
      }}
    >
      {copied ? "✓ Copiado" : (label ?? "Copiar")}
    </button>
  );
}

function formatShortDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  } catch { return iso; }
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ReferralCenter() {
  const { user } = useAuth();
  const { lang } = useI18n();
  const es = !lang?.toLowerCase().startsWith("en");

  const [stats, setStats] = useState<ReferralStats | null>(null);
  const [list, setList] = useState<ReferralEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const [statsRes, listRes] = await Promise.all([
        getMyReferral(),
        getReferralList(),
      ]);
      setStats(statsRes);
      setList(listRes.success ? listRes.list : []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error cargando datos.");
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { load(); }, [load]);

  const referralUrl = stats?.link ?? "";

  return (
    <div
      className="min-h-screen"
      style={{
        background: "linear-gradient(180deg, #0a0a0f 0%, #0d0d16 100%)",
        paddingBottom: 80,
      }}
    >
      {/* Hero */}
      <div
        style={{
          background: "linear-gradient(135deg, rgba(212,0,122,0.12), rgba(155,0,176,0.08))",
          borderBottom: "1px solid rgba(212,0,122,0.12)",
          padding: "32px 20px 24px",
        }}
      >
        <div style={{ maxWidth: 540, margin: "0 auto" }}>
          <p className="text-xs font-bold uppercase tracking-widest" style={{ color: "#D4007A", marginBottom: 6 }}>
            {es ? "Centro de Referidos" : "Referral Center"}
          </p>
          <h1 className="text-2xl font-bold text-white" style={{ lineHeight: 1.25, marginBottom: 8 }}>
            {es ? "Invita amigos, gana PRIME + tokens" : "Invite friends, earn PRIME + tokens"}
          </h1>
          <p className="text-sm" style={{ color: "rgba(255,255,255,0.50)", marginBottom: 20 }}>
            {es
              ? "Cada vez que alguien se registra con tu enlace, ambos reciben 24 horas de PRIME gratis. Si además pagan un plan, tú ganas tokens PNP Live."
              : "Every time someone signs up with your link, you both get 24 hours of PRIME free. When they buy a plan, you also earn PNP Live tokens."}
          </p>

          {/* Referral link box */}
          {loading ? (
            <div className="h-12 rounded-2xl animate-pulse" style={{ background: "rgba(255,255,255,0.06)" }} />
          ) : stats ? (
            <div
              className="flex items-center gap-3"
              style={{
                background: "rgba(255,255,255,0.05)",
                border: "1px solid rgba(212,0,122,0.25)",
                borderRadius: 16,
                padding: "10px 14px",
              }}
            >
              <p
                className="flex-1 text-sm font-mono text-white/80 truncate"
                style={{ minWidth: 0 }}
              >
                {referralUrl}
              </p>
              <CopyButton text={referralUrl} label={es ? "Copiar enlace" : "Copy link"} />
            </div>
          ) : null}
        </div>
      </div>

      <div style={{ maxWidth: 540, margin: "0 auto", padding: "24px 20px 0" }}>
        {/* Stats */}
        {stats && (
          <div className="grid grid-cols-3 gap-3" style={{ marginBottom: 28 }}>
            {[
              { label: es ? "Referidos" : "Referred", value: stats.total },
              { label: es ? "Pagaron" : "Paid", value: stats.completed },
              { label: es ? "Tokens ganados" : "Tokens earned", value: stats.tokensEarned ?? 0 },
            ].map(({ label, value }) => (
              <div
                key={label}
                className="flex flex-col items-center justify-center text-center rounded-2xl"
                style={{
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  padding: "16px 8px",
                }}
              >
                <span className="text-2xl font-bold text-white">{value}</span>
                <span className="text-xs mt-1" style={{ color: "rgba(255,255,255,0.45)" }}>{label}</span>
              </div>
            ))}
          </div>
        )}

        {/* Error */}
        {error && (
          <div
            className="rounded-2xl p-4 text-sm text-red-400 mb-6"
            style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.20)" }}
          >
            {error}
          </div>
        )}

        {/* How it works */}
        <div
          className="rounded-2xl p-5"
          style={{
            background: "rgba(255,255,255,0.03)",
            border: "1px solid rgba(255,255,255,0.07)",
            marginBottom: 24,
          }}
        >
          <h2 className="text-sm font-bold text-white mb-4">
            {es ? "¿Cómo funciona?" : "How it works"}
          </h2>
          <div className="flex flex-col gap-4">
            {(es
              ? [
                  { step: "1", title: "Comparte tu enlace", body: "Envíalo por WhatsApp, Instagram, Telegram — donde quieras." },
                  { step: "2", title: "Ambos obtienen 24h de PRIME gratis", body: "En cuanto se registra con tu enlace, tú y tu amigo reciben 24 horas de PRIME automáticamente — sin pagar nada." },
                  { step: "3", title: "Paga su primer plan", body: "En cuanto completa su primera compra, tú recibes tokens PNP Live automáticamente." },
                ]
              : [
                  { step: "1", title: "Share your link", body: "Send it via WhatsApp, Instagram, Telegram — wherever." },
                  { step: "2", title: "You both get 24h of PRIME free", body: "As soon as they sign up with your link, both of you get 24 hours of PRIME automatically — no payment needed." },
                  { step: "3", title: "They buy a plan", body: "Once they complete their first purchase, you get PNP Live tokens automatically." },
                ]
            ).map(({ step, title, body }) => (
              <div key={step} className="flex items-start gap-4">
                <span
                  className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold"
                  style={{ background: "linear-gradient(135deg,#D4007A,#9B00B0)", color: "#fff" }}
                >
                  {step}
                </span>
                <div>
                  <p className="text-sm font-semibold text-white">{title}</p>
                  <p className="text-xs mt-0.5" style={{ color: "rgba(255,255,255,0.45)" }}>{body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Reward table */}
        <div
          className="rounded-2xl overflow-hidden"
          style={{
            border: "1px solid rgba(255,255,255,0.07)",
            marginBottom: 28,
          }}
        >
          <div
            className="px-5 py-3 flex items-center gap-2"
            style={{ background: "rgba(255,255,255,0.04)", borderBottom: "1px solid rgba(255,255,255,0.06)" }}
          >
            <span className="text-sm font-bold text-white">
              {es ? "Tokens por plan" : "Tokens per plan"}
            </span>
          </div>
          {[
            { plan: es ? "Pase semanal / Mensual" : "Weekly / Monthly pass", tokens: 1 },
            { plan: es ? "Trimestral, semestral, anual, lifetime..." : "Quarterly, biannual, yearly, lifetime...", tokens: 3 },
          ].map(({ plan, tokens }, i) => (
            <div
              key={plan}
              className="flex items-center justify-between px-5 py-3"
              style={{
                background: i % 2 === 0 ? "rgba(255,255,255,0.02)" : "transparent",
                borderBottom: i === 0 ? "1px solid rgba(255,255,255,0.05)" : "none",
              }}
            >
              <span className="text-sm" style={{ color: "rgba(255,255,255,0.65)" }}>{plan}</span>
              <span
                className="text-sm font-bold px-2.5 py-0.5 rounded-full"
                style={{ background: "rgba(212,0,122,0.12)", color: "#D4007A", border: "1px solid rgba(212,0,122,0.20)" }}
              >
                {tokens} {tokens === 1 ? "token" : "tokens"}
              </span>
            </div>
          ))}
        </div>

        {/* Recent referrals */}
        {!loading && list.length > 0 && (
          <div>
            <h2 className="text-sm font-bold text-white mb-3">
              {es ? "Referidos recientes" : "Recent referrals"}
            </h2>
            <div
              className="rounded-2xl overflow-hidden"
              style={{ border: "1px solid rgba(255,255,255,0.07)" }}
            >
              {list.map((entry, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between px-4 py-3"
                  style={{
                    background: i % 2 === 0 ? "rgba(255,255,255,0.02)" : "transparent",
                    borderBottom: i < list.length - 1 ? "1px solid rgba(255,255,255,0.05)" : "none",
                  }}
                >
                  <div className="flex items-center gap-3">
                    <span
                      className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                      style={{ background: "rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.5)" }}
                    >
                      {entry.referee_username ? entry.referee_username[0].toUpperCase() : "?"}
                    </span>
                    <div>
                      <p className="text-sm font-semibold text-white/80">
                        {entry.referee_username ?? (es ? "Usuario desconocido" : "Unknown user")}
                      </p>
                      <p className="text-xs" style={{ color: "rgba(255,255,255,0.35)" }}>
                        {formatShortDate(entry.created_at)}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {entry.status === "completed" ? (
                      <span
                        className="text-xs font-semibold px-2 py-0.5 rounded-full"
                        style={{ background: "rgba(34,197,94,0.12)", color: "#4ADE80", border: "1px solid rgba(34,197,94,0.20)" }}
                      >
                        +{entry.reward_tokens} {entry.reward_tokens === 1 ? "token" : "tokens"}
                      </span>
                    ) : (
                      <span
                        className="text-xs font-semibold px-2 py-0.5 rounded-full"
                        style={{ background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.35)", border: "1px solid rgba(255,255,255,0.10)" }}
                      >
                        {es ? "Pendiente" : "Pending"}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {!loading && list.length === 0 && stats && (
          <div
            className="rounded-2xl p-8 text-center"
            style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}
          >
            <p className="text-2xl mb-2">🔗</p>
            <p className="text-sm font-semibold text-white/60">
              {es ? "Aún no tienes referidos" : "No referrals yet"}
            </p>
            <p className="text-xs mt-1" style={{ color: "rgba(255,255,255,0.35)" }}>
              {es ? "¡Comparte tu enlace y empieza a ganar!" : "Share your link and start earning!"}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
