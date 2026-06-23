import React, { useEffect, useState } from "react";
import { Helmet } from "react-helmet-async";
import { useNavigate } from "react-router-dom";
import { getMyAccess, unsubscribeFromCreator, type MyAccessResponse } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

// ── Helpers ─────────────────────────────────────────────────────────────────

type I18n = ReturnType<typeof useI18n>;

function formatExpiry(iso: string | null, isLifetime: boolean, t: I18n): string {
  if (isLifetime) return t.myAccess.lifetime;
  if (!iso) return t.myAccess.dash;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return t.myAccess.dash;
  const diffMs = d.getTime() - Date.now();
  if (diffMs <= 0) return t.myAccess.expired;
  const days = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  if (days <= 1) return t.myAccess.expiresToday;
  if (days <= 30) return t.myAccess.daysLeft(days);
  return t.myAccess.untilDate(
    d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
  );
}

function tierBadge(
  tier: "PRIME" | "BASIC" | "FREE",
  t: I18n
): { label: string; className: string } {
  if (tier === "PRIME") return { label: t.myAccess.primeLabel, className: "bg-gradient-to-r from-amber-400 to-orange-500 text-black" };
  if (tier === "BASIC") return { label: t.myAccess.basicLabel, className: "bg-blue-500/90 text-white" };
  return { label: t.myAccess.freeLabel, className: "bg-neutral-700 text-white" };
}

// ── Components ──────────────────────────────────────────────────────────────

function Section({
  title,
  subtitle,
  empty,
  children,
}: {
  title: string;
  subtitle?: string;
  empty?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-6">
      <div className="mb-3">
        <h2 className="text-base font-semibold text-pnp-textPrimary">{title}</h2>
        {subtitle ? <p className="text-xs text-pnp-textSecondary">{subtitle}</p> : null}
      </div>
      {React.Children.count(children) > 0
        ? <div className="space-y-2">{children}</div>
        : (empty
            ? <p className="text-xs text-pnp-textSecondary py-4 text-center">{empty}</p>
            : null)}
    </section>
  );
}

function AccessRow({
  title,
  subtitle,
  expiryText,
  thumbnailUrl,
  onClick,
  onCancel,
  cancelLoading,
}: {
  title: string;
  subtitle?: string;
  expiryText: string;
  thumbnailUrl: string | null;
  onClick?: () => void;
  onCancel?: () => void;
  cancelLoading?: boolean;
}) {
  return (
    <div className="w-full flex items-center gap-3 p-3 rounded-xl bg-white/5 border border-white/10 transition-all">
      <button
        type="button"
        onClick={onClick}
        disabled={!onClick}
        className="flex items-center gap-3 flex-1 min-w-0 text-left hover:bg-white/5 active:scale-[0.99] transition-all rounded-lg disabled:opacity-60 disabled:cursor-default"
      >
        <div className="w-12 h-12 rounded-lg overflow-hidden bg-neutral-800 flex-shrink-0">
          {thumbnailUrl
            ? <img src={thumbnailUrl} alt="" className="w-full h-full object-cover" />
            : <div className="w-full h-full flex items-center justify-center text-pnp-textSecondary text-xs">—</div>}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-pnp-textPrimary truncate">{title}</p>
          {subtitle ? <p className="text-xs text-pnp-textSecondary truncate">{subtitle}</p> : null}
        </div>
        <span className="text-xs text-pnp-textSecondary whitespace-nowrap mr-1">{expiryText}</span>
      </button>
      {onCancel && (
        <button
          type="button"
          onClick={onCancel}
          disabled={cancelLoading}
          aria-label={`Cancel subscription to ${title}`}
          className="flex-shrink-0 min-w-[32px] min-h-[32px] flex items-center justify-center rounded-lg transition-colors disabled:opacity-50"
          style={{ background: "rgba(255,59,48,0.08)", color: "#FF453A", border: "1px solid rgba(255,59,48,0.2)" }}
        >
          {cancelLoading ? (
            <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          ) : (
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          )}
        </button>
      )}
    </div>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────

export default function MyAccess() {
  const navigate = useNavigate();
  const t = useI18n();
  const [data, setData] = useState<MyAccessResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cancellingCreatorId, setCancellingCreatorId] = useState<string | null>(null);

  const handleCancelCreatorSub = async (creatorId: string, displayName: string) => {
    const confirmed = window.confirm(
      `Cancel subscription to ${displayName}? Your access will end immediately.`
    );
    if (!confirmed) return;
    setCancellingCreatorId(creatorId);
    try {
      await unsubscribeFromCreator(creatorId);
      setData((prev) =>
        prev
          ? { ...prev, creators: prev.creators.filter((c) => c.id !== creatorId) }
          : prev
      );
    } catch { /* silent — row stays if it fails */ }
    setCancellingCreatorId(null);
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await getMyAccess();
        if (!cancelled) setData(res);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load access");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const badge = data ? tierBadge(data.tier, t) : tierBadge("FREE", t);

  return (
    <div className="min-h-dvh bg-pnp-background text-pnp-textPrimary">
      <Helmet>
        <title>{t.myAccess.pageTitle}</title>
      </Helmet>

      <div className="max-w-xl mx-auto p-4 pb-24">
        <h1 className="text-xl font-bold mb-1">{t.myAccess.heading}</h1>
        <p className="text-xs text-pnp-textSecondary mb-5">{t.myAccess.subheading}</p>

        {loading && (
          <div className="space-y-3">
            <div className="h-20 rounded-xl bg-white/5 animate-pulse" />
            <div className="h-20 rounded-xl bg-white/5 animate-pulse" />
            <div className="h-20 rounded-xl bg-white/5 animate-pulse" />
          </div>
        )}

        {error && !loading && (
          <div className="rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 p-4 text-sm">
            {error}
          </div>
        )}

        {!loading && !error && data && (
          <>
            {/* Membership card */}
            <section className="mb-6 rounded-2xl bg-white/5 border border-white/10 p-4">
              <div className="flex items-center justify-between mb-3">
                <span className={`px-3 py-1 rounded-full text-xs font-bold ${badge.className}`}>
                  {badge.label}
                </span>
                {data.tier === "FREE" && (
                  <button
                    className="text-xs font-semibold text-pnp-accent underline"
                    onClick={() => navigate("/subscribe")}
                  >
                    {t.myAccess.upgrade}
                  </button>
                )}
              </div>
              <div className="grid grid-cols-1 gap-2 text-sm">
                {data.global.primeLifetime || data.global.primeExpiresAt ? (
                  <div className="flex justify-between">
                    <span className="text-pnp-textSecondary">{t.myAccess.rowPrime}</span>
                    <span>{formatExpiry(data.global.primeExpiresAt, data.global.primeLifetime, t)}</span>
                  </div>
                ) : null}
                {data.global.memberLifetime || data.global.memberExpiresAt ? (
                  <div className="flex justify-between">
                    <span className="text-pnp-textSecondary">{t.myAccess.rowMember}</span>
                    <span>{formatExpiry(data.global.memberExpiresAt, data.global.memberLifetime, t)}</span>
                  </div>
                ) : null}
                {data.global.privateCallCredits > 0 ? (
                  <div className="flex justify-between">
                    <span className="text-pnp-textSecondary">{t.myAccess.rowPrivateCalls}</span>
                    <span>{data.global.privateCallCredits}</span>
                  </div>
                ) : null}
                {!data.global.primeLifetime && !data.global.primeExpiresAt
                  && !data.global.memberLifetime && !data.global.memberExpiresAt
                  && data.global.privateCallCredits === 0 && (
                    <p className="text-xs text-pnp-textSecondary">
                      {t.myAccess.noMembership}
                    </p>
                  )}
              </div>
            </section>

            {/* Paid Channels */}
            <Section
              title={t.myAccess.paidChannelsTitle}
              subtitle={t.myAccess.paidChannelsSubtitle}
              empty={t.myAccess.paidChannelsEmpty}
            >
              {data.channels.map((c) => (
                <AccessRow
                  key={`ch-${c.id}`}
                  title={c.name || t.myAccess.defaultChannelName}
                  subtitle={t.myAccess.rowChannelAccess}
                  expiryText={formatExpiry(c.expiresAt, c.isLifetime, t)}
                  thumbnailUrl={c.coverUrl}
                  onClick={() => navigate(c.url)}
                />
              ))}
            </Section>

            {/* Subscribed Creators */}
            <Section
              title={t.myAccess.subscribedCreatorsTitle}
              subtitle={t.myAccess.subscribedCreatorsSubtitle}
              empty={t.myAccess.subscribedCreatorsEmpty}
            >
              {data.creators.map((cr) => (
                <AccessRow
                  key={`cr-${cr.id}`}
                  title={cr.displayName || t.myAccess.defaultCreatorName}
                  subtitle={cr.handle ? `@${cr.handle}` : undefined}
                  expiryText={formatExpiry(cr.expiresAt, cr.isLifetime, t)}
                  thumbnailUrl={cr.avatarUrl}
                  onClick={() => navigate(cr.url)}
                  onCancel={!cr.isLifetime ? () => handleCancelCreatorSub(cr.id, cr.displayName || t.myAccess.defaultCreatorName) : undefined}
                  cancelLoading={cancellingCreatorId === cr.id}
                />
              ))}
            </Section>

            {/* Paid Hangouts (standalone) */}
            <Section
              title={t.myAccess.paidHangoutsTitle}
              subtitle={t.myAccess.paidHangoutsSubtitle}
              empty={t.myAccess.paidHangoutsEmpty}
            >
              {data.hangouts.map((h) => (
                <AccessRow
                  key={`hg-${h.id}`}
                  title={h.name || t.myAccess.defaultHangoutName}
                  subtitle={t.myAccess.rowHangoutAccess}
                  expiryText={formatExpiry(h.expiresAt, h.isLifetime, t)}
                  thumbnailUrl={h.avatarUrl}
                  onClick={() => navigate(h.url)}
                />
              ))}
            </Section>
          </>
        )}
      </div>
    </div>
  );
}
