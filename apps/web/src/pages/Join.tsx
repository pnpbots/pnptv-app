import React, { useState, useEffect } from "react";
import { Helmet } from "react-helmet-async";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/lib/i18n";
import { getSubscriptionPlans, getFeaturedPerformers, type SubscriptionPlan, type FeaturedPerformer } from "@/lib/api";

// ── Helpers ───────────────────────────────────────────────────────────────────

function isValidPhoto(url: string | null | undefined): url is string {
  return typeof url === "string" && url.trim().length > 0;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function CheckIcon({ color = "#5ED1C4" }: { color?: string }) {
  return (
    <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="8" fill={color} fillOpacity="0.15" />
      <path d="M5 8l2 2 4-4" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CrossIcon() {
  return (
    <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="8" fill="rgba(255,255,255,0.06)" />
      <path d="M5.5 10.5l5-5M10.5 10.5l-5-5" stroke="rgba(255,255,255,0.2)" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function Join() {
  const { user, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const t = useI18n().join;

  const [performers, setPerformers] = useState<FeaturedPerformer[]>([]);
  const [memberPlan, setMemberPlan] = useState<SubscriptionPlan | null>(null);
  const [primePlan, setPrimePlan] = useState<SubscriptionPlan | null>(null);
  const [stats, setStats] = useState<{ totalUsers: number; newUsersLast30Days: number } | null>(null);

  // Capture referral code from URL and persist for post-auth redemption
  useEffect(() => {
    const ref = searchParams.get("ref");
    if (ref) {
      localStorage.setItem("pnptv:pendingRef", ref.toUpperCase());
    }
  }, [searchParams]);

  useEffect(() => {
    getFeaturedPerformers().catch(() => null).then((res) => {
      if (res?.performers) setPerformers(res.performers.slice(0, 6));
    });
    getSubscriptionPlans().catch(() => null).then((res) => {
      if (res?.plans) {
        setMemberPlan(res.plans.find((p: SubscriptionPlan) => p.id === "member-monthly") ?? null);
        setPrimePlan(res.plans.find((p: SubscriptionPlan) => p.id === "monthly-pass") ?? null);
      }
    });
    fetch("/api/stats").then((r) => r.json()).then((d) => setStats(d)).catch(() => null);
  }, []);

  const handleJoinFree = () => {
    if (isAuthenticated) {
      navigate("/social");
    } else {
      navigate("/welcome");
    }
  };

  const handleGetMember = () => {
    if (isAuthenticated) {
      navigate("/subscribe");
    } else {
      navigate("/welcome?next=subscribe");
    }
  };

  const handleGetPrime = () => {
    if (isAuthenticated) {
      navigate("/subscribe");
    } else {
      navigate("/welcome?next=subscribe");
    }
  };

  const comparisonRows = [
    { label: t.comparisonRows[0], free: true, member: true, prime: true },
    { label: t.comparisonRows[1], free: true, member: true, prime: true },
    { label: t.comparisonRows[2], free: true, member: true, prime: true },
    { label: t.comparisonRows[3], free: true, member: true, prime: true },
    { label: t.comparisonRows[4], free: false, member: true, prime: true },
    { label: t.comparisonRows[5], free: false, member: true, prime: true },
    { label: t.comparisonRows[6], free: false, member: true, prime: true },
    { label: t.comparisonRows[7], free: false, member: true, prime: true },
    { label: t.comparisonRows[8], free: false, member: false, prime: true },
    { label: t.comparisonRows[9], free: false, member: false, prime: true },
    { label: t.comparisonRows[10], free: false, member: false, prime: true },
    { label: t.comparisonRows[11], free: false, member: false, prime: true },
  ];

  return (
    <>
      <Helmet>
        <title>{t.pageTitle}</title>
        <meta name="description" content={t.metaDescription} />
        <meta property="og:type" content="website" />
        <meta property="og:site_name" content="PNPtv" />
        <meta property="og:title" content={t.pageTitle} />
        <meta property="og:description" content={t.ogDescription} />
        <meta property="og:image" content="https://app.pnptv.app/og-image.png" />
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="630" />
        <meta property="og:url" content="https://pnptv.app/login" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:site" content="@PNPTelevision" />
        <meta name="twitter:title" content={t.pageTitle} />
        <meta name="twitter:description" content={t.ogDescription} />
        <meta name="twitter:image" content="https://app.pnptv.app/og-image.png" />
      </Helmet>

      <div className="min-h-screen" style={{ background: "#0A0A0B", color: "#fff" }}>

        {/* ── Sticky Top Bar ── */}
        <div className="sticky top-0 z-50 flex items-center justify-between px-4 py-3" style={{ background: "rgba(10,10,11,0.92)", backdropFilter: "blur(12px)", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
          <div className="flex items-center gap-2">
            <span className="text-lg font-black tracking-tight" style={{ background: "linear-gradient(135deg, #D4007A, #E69138)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
              PNPtv!
            </span>
          </div>
          <div className="flex gap-2">
            {isAuthenticated ? (
              <button onClick={() => navigate("/social")} className="px-4 py-1.5 rounded-full text-xs font-semibold text-white" style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}>
                {t.openApp}
              </button>
            ) : (
              <>
                <button onClick={handleJoinFree} className="px-3 py-1.5 rounded-full text-xs font-semibold text-white/70 border border-white/15 hover:bg-white/5 transition-colors">
                  {t.signIn}
                </button>
                <button onClick={handleGetMember} className="px-4 py-1.5 rounded-full text-xs font-semibold text-white" style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}>
                  {t.joinNow}
                </button>
              </>
            )}
          </div>
        </div>

        {/* ── Hero ── */}
        <div className="relative overflow-hidden">
          {/* Gradient blobs */}
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[400px] rounded-full opacity-20" style={{ background: "radial-gradient(ellipse, #D4007A 0%, transparent 70%)", filter: "blur(60px)" }} />
            <div className="absolute top-1/3 right-0 w-[300px] h-[300px] rounded-full opacity-15" style={{ background: "radial-gradient(ellipse, #E69138 0%, transparent 70%)", filter: "blur(40px)" }} />
          </div>

          <div className="relative max-w-2xl mx-auto px-4 pt-16 pb-12 text-center">
            {/* Badge */}
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full mb-6 text-xs font-semibold" style={{ background: "rgba(212,0,122,0.15)", border: "1px solid rgba(212,0,122,0.3)", color: "#D4007A" }}>
              <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
              {t.heroBadge}
            </div>

            <h1 className="text-4xl sm:text-5xl font-black leading-tight mb-4" style={{ letterSpacing: "-0.02em" }}>
              {t.heroHeadlinePart1}{" "}
              <span style={{ background: "linear-gradient(135deg, #D4007A, #E69138)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
                {t.heroHeadlinePart2}
              </span>
            </h1>

            <p className="text-base sm:text-lg mb-2" style={{ color: "rgba(255,255,255,0.65)", maxWidth: "480px", margin: "0 auto 8px" }}>
              {t.heroBody}
            </p>

            {/* Stats */}
            {stats && (
              <p className="text-sm font-medium mb-8" style={{ color: "#5ED1C4" }}>
                {t.heroStatsMembersTemplate.replace("{count}", stats.totalUsers.toLocaleString())} · {t.heroStatsJoinedTemplate.replace("{count}", stats.newUsersLast30Days.toLocaleString())}
              </p>
            )}
            {!stats && <div className="mb-8" />}

            {/* CTAs */}
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <button
                onClick={handleGetPrime}
                className="px-8 py-3.5 rounded-xl text-sm font-bold text-white shadow-lg transition-transform active:scale-95"
                style={{ background: "linear-gradient(135deg, #D4007A, #E69138)", boxShadow: "0 4px 24px rgba(212,0,122,0.35)" }}
              >
                {t.getPrimeCta}
              </button>
              <button
                onClick={handleJoinFree}
                className="px-8 py-3.5 rounded-xl text-sm font-bold transition-colors"
                style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", color: "rgba(255,255,255,0.75)" }}
              >
                {t.joinFreeCta}
              </button>
            </div>

            <p className="mt-3 text-xs" style={{ color: "rgba(255,255,255,0.3)" }}>
              {t.noCreditCard}
            </p>
          </div>
        </div>

        {/* ── What is PNPtv! ── */}
        <div className="max-w-3xl mx-auto px-4 py-12">
          <div className="rounded-2xl p-6 sm:p-8" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}>
            <p className="text-xs font-semibold uppercase tracking-widest mb-4" style={{ color: "#D4007A" }}>{t.whatIsPnptvLabel}</p>
            <div className="grid sm:grid-cols-3 gap-6">
              {([
                { icon: "🔒", ...t.whatIsCards[0] },
                { icon: "🎬", ...t.whatIsCards[1] },
                { icon: "🌎", ...t.whatIsCards[2] },
              ] as { icon: string; title: string; desc: string }[]).map((item) => (
                <div key={item.title}>
                  <div className="text-2xl mb-3">{item.icon}</div>
                  <p className="text-sm font-semibold text-white mb-1.5">{item.title}</p>
                  <p className="text-xs leading-relaxed" style={{ color: "rgba(255,255,255,0.5)" }}>{item.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── Tier Comparison ── */}
        <div className="max-w-3xl mx-auto px-4 pb-12">
          <p className="text-center text-xs font-semibold uppercase tracking-widest mb-6" style={{ color: "rgba(255,255,255,0.4)" }}>
            {t.comparePlansLabel}
          </p>

          {/* Column headers */}
          <div className="grid grid-cols-4 gap-2 mb-3 px-2">
            <div />
            <div className="text-center">
              <p className="text-xs font-semibold text-white/50">{t.colFree}</p>
              <p className="text-xs text-white/30">{t.colFreePrice}</p>
            </div>
            <div className="text-center">
              <p className="text-xs font-semibold" style={{ color: "#5ED1C4" }}>{t.colMember}</p>
              <p className="text-xs font-bold text-white">{t.colMemberPrice}<span className="text-white/40 font-normal">{t.colMemberPriceSuffix}</span></p>
            </div>
            <div className="text-center rounded-lg py-1" style={{ background: "linear-gradient(135deg, rgba(212,0,122,0.15), rgba(230,145,56,0.15))", border: "1px solid rgba(212,0,122,0.25)" }}>
              <p className="text-xs font-bold" style={{ background: "linear-gradient(135deg, #D4007A, #E69138)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>{t.colPrime}</p>
              <p className="text-xs font-bold text-white">{t.colPrimePrice}<span className="text-white/40 font-normal">{t.colPrimePriceSuffix}</span></p>
            </div>
          </div>

          {/* Rows */}
          <div className="rounded-2xl overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.07)" }}>
            {comparisonRows.map((row, i) => (
              <div key={row.label} className="grid grid-cols-4 gap-2 px-4 py-3 items-center" style={{ background: i % 2 === 0 ? "rgba(255,255,255,0.02)" : "transparent", borderBottom: i < comparisonRows.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none" }}>
                <p className="text-xs text-white/70 col-span-1">{row.label}</p>
                <div className="flex justify-center">{row.free ? <CheckIcon color="rgba(255,255,255,0.4)" /> : <CrossIcon />}</div>
                <div className="flex justify-center">{row.member ? <CheckIcon color="#5ED1C4" /> : <CrossIcon />}</div>
                <div className="flex justify-center">{row.prime ? <CheckIcon color="#D4007A" /> : <CrossIcon />}</div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Pricing Cards ── */}
        <div className="max-w-3xl mx-auto px-4 pb-12">
          <p className="text-center text-xs font-semibold uppercase tracking-widest mb-6" style={{ color: "rgba(255,255,255,0.4)" }}>
            {t.choosePlanLabel}
          </p>

          <div className="grid sm:grid-cols-3 gap-4">
            {/* Free Card */}
            <div className="rounded-2xl p-5 flex flex-col" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}>
              <p className="text-xs font-semibold text-white/50 mb-1">{t.freePlanName}</p>
              <p className="text-3xl font-black text-white mb-1">{t.freePlanPrice}</p>
              <p className="text-xs text-white/40 mb-4">{t.freePlanPeriod}</p>
              <ul className="space-y-2 flex-1 mb-5">
                {(t.freePlanFeatures as readonly string[]).map((f) => (
                  <li key={f} className="flex items-center gap-2 text-xs text-white/60">
                    <CheckIcon color="rgba(255,255,255,0.35)" />
                    {f}
                  </li>
                ))}
              </ul>
              <button
                onClick={handleJoinFree}
                className="w-full py-2.5 rounded-xl text-sm font-semibold text-white/60 transition-colors hover:text-white"
                style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }}
              >
                {t.freePlanCta}
              </button>
            </div>

            {/* Member Card */}
            <div className="rounded-2xl p-5 flex flex-col" style={{ background: "rgba(94,209,196,0.05)", border: "1px solid rgba(94,209,196,0.25)" }}>
              <p className="text-xs font-semibold mb-1" style={{ color: "#5ED1C4" }}>{t.memberPlanName}</p>
              <div className="flex items-baseline gap-1 mb-1">
                <p className="text-3xl font-black text-white">{t.memberPlanPrice}</p>
                <p className="text-xs text-white/40">{t.memberPlanPriceSuffix}</p>
              </div>
              <p className="text-xs text-white/40 mb-4">{t.memberPlanPeriod}</p>
              <ul className="space-y-2 flex-1 mb-5">
                {(t.memberPlanFeatures as readonly string[]).map((f) => (
                  <li key={f} className="flex items-center gap-2 text-xs text-white/70">
                    <CheckIcon color="#5ED1C4" />
                    {f}
                  </li>
                ))}
              </ul>
              <button
                onClick={handleGetMember}
                className="w-full py-2.5 rounded-xl text-sm font-semibold text-white transition-colors"
                style={{ background: "rgba(94,209,196,0.15)", border: "1px solid rgba(94,209,196,0.4)", color: "#5ED1C4" }}
              >
                {t.memberPlanCta}
              </button>
            </div>

            {/* PRIME Card */}
            <div className="rounded-2xl p-5 flex flex-col relative overflow-hidden" style={{ background: "rgba(212,0,122,0.06)", border: "1px solid rgba(212,0,122,0.35)" }}>
              {/* Recommended badge */}
              <div className="absolute top-0 right-0 px-3 py-1 text-xs font-bold text-white rounded-bl-xl rounded-tr-xl" style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}>
                {t.primePlanBestValue}
              </div>

              <p className="text-xs font-bold mb-1" style={{ background: "linear-gradient(135deg, #D4007A, #E69138)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>{t.primePlanName}</p>
              <div className="flex items-baseline gap-1 mb-1">
                <p className="text-3xl font-black text-white">{t.primePlanPrice}</p>
                <p className="text-xs text-white/40">{t.primePlanPriceSuffix}</p>
              </div>
              <p className="text-xs text-white/40 mb-4">{t.primePlanPeriod}</p>
              <ul className="space-y-2 flex-1 mb-5">
                {(t.primePlanFeatures as readonly string[]).map((f) => (
                  <li key={f} className="flex items-center gap-2 text-xs text-white/80">
                    <CheckIcon color="#D4007A" />
                    {f}
                  </li>
                ))}
              </ul>
              <button
                onClick={handleGetPrime}
                className="w-full py-2.5 rounded-xl text-sm font-bold text-white transition-transform active:scale-95"
                style={{ background: "linear-gradient(135deg, #D4007A, #E69138)", boxShadow: "0 4px 20px rgba(212,0,122,0.3)" }}
              >
                {t.primePlanCta}
              </button>
            </div>
          </div>

          {/* Longer plans teaser */}
          <div className="mt-4 rounded-xl p-4 flex items-center justify-between" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
            <div>
              <p className="text-xs font-semibold text-white/70">{t.longerPlansTitle}</p>
              <p className="text-xs text-white/35 mt-0.5">{t.longerPlansDesc}</p>
            </div>
            <button onClick={handleGetPrime} className="text-xs font-semibold px-3 py-1.5 rounded-lg flex-shrink-0" style={{ color: "#D4007A", background: "rgba(212,0,122,0.1)", border: "1px solid rgba(212,0,122,0.2)" }}>
              {t.longerPlansSeeAll}
            </button>
          </div>
        </div>

        {/* ── Featured Creators ── */}
        {performers.length > 0 && (
          <div className="max-w-3xl mx-auto px-4 pb-12">
            <p className="text-center text-xs font-semibold uppercase tracking-widest mb-6" style={{ color: "rgba(255,255,255,0.4)" }}>
              {t.meetCreatorsLabel}
            </p>
            <div className="flex gap-4 overflow-x-auto pb-2 scrollbar-none">
              {performers.map((p) => (
                <div key={p.id} className="flex-shrink-0 flex flex-col items-center gap-2 w-20">
                  {isValidPhoto(p.photoUrl) ? (
                    <img src={p.photoUrl} alt={p.displayName} className="w-16 h-16 rounded-full object-cover" style={{ border: "2px solid rgba(212,0,122,0.4)" }} />
                  ) : (
                    <div className="w-16 h-16 rounded-full flex items-center justify-center text-xl font-bold" style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}>
                      {(p.displayName || "?")[0].toUpperCase()}
                    </div>
                  )}
                  <p className="text-xs text-center text-white/60 leading-tight line-clamp-2">{p.displayName}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Testimonial / Trust ── */}
        <div className="max-w-3xl mx-auto px-4 pb-12">
          <div className="grid sm:grid-cols-3 gap-4">
            {([
              { icon: "🌍", ...t.stats[0] },
              { icon: "🔥", ...t.stats[1] },
              { icon: "🔒", ...t.stats[2] },
            ] as { icon: string; stat: string; label: string }[]).map((item) => (
              <div key={item.stat} className="rounded-2xl p-5 text-center" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}>
                <div className="text-2xl mb-2">{item.icon}</div>
                <p className="text-2xl font-black text-white">{item.stat}</p>
                <p className="text-xs mt-1" style={{ color: "rgba(255,255,255,0.45)" }}>{item.label}</p>
              </div>
            ))}
          </div>
        </div>

        {/* ── Bottom CTA ── */}
        <div className="relative overflow-hidden">
          <div className="absolute inset-0 pointer-events-none" style={{ background: "linear-gradient(to bottom, transparent, rgba(212,0,122,0.07))" }} />
          <div className="relative max-w-xl mx-auto px-4 py-16 text-center">
            <h2 className="text-2xl sm:text-3xl font-black mb-3" style={{ letterSpacing: "-0.02em" }}>
              {t.bottomCtaHeadlinePart1}{" "}
              <span style={{ background: "linear-gradient(135deg, #D4007A, #E69138)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
                {t.bottomCtaHeadlinePart2}
              </span>
            </h2>
            <p className="text-sm mb-8" style={{ color: "rgba(255,255,255,0.5)" }}>
              {t.bottomCtaBody}
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <button
                onClick={handleGetPrime}
                className="px-8 py-3.5 rounded-xl text-sm font-bold text-white transition-transform active:scale-95"
                style={{ background: "linear-gradient(135deg, #D4007A, #E69138)", boxShadow: "0 4px 24px rgba(212,0,122,0.35)" }}
              >
                {t.getPrimeCta}
              </button>
              <button
                onClick={handleJoinFree}
                className="px-8 py-3.5 rounded-xl text-sm font-bold transition-colors"
                style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", color: "rgba(255,255,255,0.75)" }}
              >
                {t.joinFreeCta}
              </button>
            </div>
          </div>
        </div>

        {/* ── Footer ── */}
        <div className="border-t px-4 py-6 text-center" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
          <p className="text-xs" style={{ color: "rgba(255,255,255,0.25)" }}>
            &copy; {new Date().getFullYear()} PNPtv! · {t.footerAdults}
          </p>
          <p className="text-xs mt-2 flex items-center justify-center gap-2 flex-wrap" style={{ color: "rgba(255,255,255,0.25)" }}>
            <button onClick={() => navigate("/terms")} className="underline hover:text-white/50 transition-colors" style={{ color: "#D4007A" }}>{t.footerTerms}</button>
            <span>·</span>
            <button onClick={() => navigate("/privacy")} className="underline hover:text-white/50 transition-colors" style={{ color: "#D4007A" }}>{t.footerPrivacy}</button>
            <span>·</span>
            <button onClick={() => navigate("/support")} className="underline hover:text-white/50 transition-colors" style={{ color: "#D4007A" }}>{t.footerSupport}</button>
          </p>
        </div>

      </div>
    </>
  );
}
