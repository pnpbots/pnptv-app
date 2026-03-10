import React, { useState, useEffect } from "react";
import { Helmet } from "react-helmet-async";
import { useNavigate } from "react-router-dom";
import { Card, Skeleton } from "@pnptv/ui-kit";
import {
  getSubscriptionPlans,
  createPayment,
  getPaymentStatus,
  createDashSubscription,
  getDashSubscriptionStatus,
  getDashAvailable,
  activateMeruCode,
  type SubscriptionPlan,
} from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { useTutorial } from "@/hooks/useTutorial";
import { TutorialOverlay } from "@/components/tutorial/TutorialOverlay";
import { useI18n } from "@/lib/i18n";

type Provider = "epayco" | "daimo" | "dash";

const MEMBER_PLAN_IDS = new Set(["member-monthly"]);

const RECOMMENDED_PLAN = "yearly_pass";

function formatPrice(amount: number, currency: string): string {
  if (currency === "COP") {
    return new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", minimumFractionDigits: 0 }).format(amount);
  }
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);
}

function durationLabel(days: number): string {
  if (days >= 36500) return "Lifetime";
  if (days >= 365) return `${Math.round(days / 365)} Year`;
  if (days >= 30) return `${Math.round(days / 30)} Months`;
  return `${days} Days`;
}

export default function Subscribe() {
  const navigate = useNavigate();
  const { refreshUser } = useAuth();
  const { showTutorial, dismissTutorial } = useTutorial("subscribe");
  const t = useI18n();
  const s = t.subscribe;

  const PLAN_FEATURES: Record<string, string[]> = {
    "member-monthly": [
      s.featureMember1,
      s.featureMember2,
      s.featureMember3,
    ],
    "week_pass": [
      s.featureWeek1,
      s.featureWeek2,
      s.featureWeek3,
      s.featureWeek4,
    ],
    "three_months_pass": [
      s.featureThreeMonths1,
      s.featureThreeMonths2,
      s.featureThreeMonths3,
      s.featureThreeMonths4,
      s.featureThreeMonths5,
    ],
    "crystal_pass": [
      s.featureCrystal1,
      s.featureCrystal2,
      s.featureCrystal3,
      s.featureCrystal4,
      s.featureCrystal5,
    ],
    "yearly_pass": [
      s.featureYearly1,
      s.featureYearly2,
      s.featureYearly3,
      s.featureYearly4,
      s.featureYearly5,
    ],
    "lifetime_pass": [
      s.featureLifetime1,
      s.featureLifetime2,
      s.featureLifetime3,
      s.featureLifetime4,
      s.featureLifetime5,
    ],
  };

  const MEMBER_EXCLUDED = [
    s.excludedMember1,
    s.excludedMember2,
    s.excludedMember3,
    s.excludedMember4,
  ];

  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedPlan, setSelectedPlan] = useState<string | null>(null);
  const [provider, setProvider] = useState<Provider>("epayco");
  const [submitting, setSubmitting] = useState(false);
  const [showCOP, setShowCOP] = useState(false);

  // Payment polling state
  const [pollingPaymentId, setPollingPaymentId] = useState<string | null>(null);
  const [paymentSuccess, setPaymentSuccess] = useState(false);

  // Dash availability
  const [dashAvailable, setDashAvailable] = useState<boolean | null>(null);

  // Dash invoice state
  const [dashInvoice, setDashInvoice] = useState<{ invoiceId: string; checkoutUrl: string; planName: string } | null>(null);
  const [dashPolling, setDashPolling] = useState(false);

  // Meru code activation
  const [meruCode, setMeruCode] = useState("");
  const [meruSubmitting, setMeruSubmitting] = useState(false);
  const [meruError, setMeruError] = useState<string | null>(null);

  useEffect(() => {
    getSubscriptionPlans()
      .then((res) => {
        if (res.success && res.plans.length > 0) {
          setPlans(res.plans);
          const rec = res.plans.find((p) => p.id === RECOMMENDED_PLAN || p.sku === RECOMMENDED_PLAN);
          setSelectedPlan(rec?.id || res.plans[0].id);
        } else {
          setError(s.noPlansAvailable);
        }
      })
      .catch((err) => setError(err.message || s.failedToLoadPlans))
      .finally(() => setLoading(false));

    getDashAvailable()
      .then((res) => setDashAvailable(res.available === true && res.configured === true))
      .catch(() => setDashAvailable(false));

    // Resume polling if returning from same-tab Daimo checkout
    try {
      const pending = sessionStorage.getItem("pnp_pending_payment");
      if (pending) {
        sessionStorage.removeItem("pnp_pending_payment");
        setPollingPaymentId(pending);
      }
    } catch {}
  }, []);

  // Poll payment status after Daimo checkout opens
  useEffect(() => {
    if (!pollingPaymentId) return;

    let cancelled = false;
    let attempts = 0;
    const maxAttempts = 120; // 10 minutes at 5s intervals
    const interval = 5000;

    const poll = async () => {
      if (cancelled || attempts >= maxAttempts) {
        if (attempts >= maxAttempts) {
          setPollingPaymentId(null);
          setError(s.paymentTimedOut);
        }
        return;
      }
      attempts++;
      try {
        const data = await getPaymentStatus(pollingPaymentId);
        if (cancelled) return;
        if (data.status === "completed") {
          setPollingPaymentId(null);
          setPaymentSuccess(true);
          await refreshUser();
          return;
        }
        if (data.status === "failed" || data.status === "refunded") {
          setPollingPaymentId(null);
          setError(data.message || s.paymentNotSuccessful);
          return;
        }
        setTimeout(poll, interval);
      } catch {
        if (!cancelled) setTimeout(poll, interval);
      }
    };

    poll();
    return () => { cancelled = true; };
  }, [pollingPaymentId, refreshUser]);

  // Poll Dash invoice status after showing checkout
  useEffect(() => {
    if (!dashInvoice || !dashPolling) return;
    let cancelled = false;
    let attempts = 0;
    const maxAttempts = 120; // 10 minutes at 5s intervals

    const poll = async () => {
      if (cancelled || attempts >= maxAttempts) return;
      attempts++;
      try {
        const data = await getDashSubscriptionStatus(dashInvoice.invoiceId);
        if (cancelled) return;
        if (data.status === "completed") {
          setDashPolling(false);
          setDashInvoice(null);
          setPaymentSuccess(true);
          await refreshUser();
          return;
        }
        if (data.status === "expired" || data.status === "invalid") {
          setDashPolling(false);
          setError(s.dashExpired);
          return;
        }
        setTimeout(poll, 5000);
      } catch {
        if (!cancelled) setTimeout(poll, 5000);
      }
    };
    poll();
    return () => { cancelled = true; };
  }, [dashInvoice, dashPolling, refreshUser]);

  async function handleSubscribe() {
    if (!selectedPlan || submitting) return;

    setSubmitting(true);
    setError(null);

    try {
      if (provider === "dash") {
        const result = await createDashSubscription(selectedPlan);
        if (result.success && result.checkoutUrl) {
          setDashInvoice({
            invoiceId: result.invoiceId,
            checkoutUrl: result.checkoutUrl,
            planName: result.planName || "subscription",
          });
          setDashPolling(true);
        } else {
          const code = (result as { code?: string }).code;
          if (code === "BTCPAY_NOT_CONFIGURED") {
            setError(s.dashNotConfigured);
          } else if (code === "BTCPAY_UNREACHABLE") {
            setError(s.dashServerUnavailable);
          } else {
            setError(result.error || s.failedToCreateDashInvoice);
          }
        }
      } else {
        const result = await createPayment(selectedPlan, provider);
        if (result.success && result.paymentUrl) {
          if (provider === "daimo" && result.paymentId) {
            // Navigate in same tab for Daimo — avoids popup blockers
            // Store paymentId so we can resume polling if user comes back
            try { sessionStorage.setItem("pnp_pending_payment", result.paymentId); } catch {}
            window.location.href = result.paymentUrl;
          } else {
            window.open(result.paymentUrl, "_blank", "noopener,noreferrer");
            if (result.paymentId) {
              setPollingPaymentId(result.paymentId);
            }
          }
        } else {
          setError(result.error || s.failedToCreatePayment);
        }
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : s.paymentErrorGeneric;
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }

  // Meru email (only used for Meru code activation)
  const [meruEmail, setMeruEmail] = useState("");

  async function handleMeruActivate() {
    if (!meruCode.trim() || meruSubmitting) return;
    const trimmedEmail = meruEmail.trim();
    if (!trimmedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail) || trimmedEmail.length > 254) {
      setMeruError(s.invalidEmail);
      return;
    }

    setMeruSubmitting(true);
    setMeruError(null);

    try {
      const result = await activateMeruCode(meruCode.trim(), trimmedEmail);

      if (result.success) {
        await refreshUser();
        navigate("/welcome");
      } else {
        setMeruError(result.error || s.activationFailed);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : s.activationError;
      setMeruError(message);
    } finally {
      setMeruSubmitting(false);
    }
  }

  // Loading state
  if (loading) {
    return (
      <div className="page-container py-6 px-4 max-w-2xl mx-auto">
        <div className="text-center mb-8">
          <Skeleton className="h-8 w-48 mx-auto mb-2" />
          <Skeleton className="h-4 w-64 mx-auto" />
        </div>
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-32 w-full rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  // Payment success state
  if (paymentSuccess) {
    return (
      <div className="page-container flex items-center justify-center min-h-[60vh]">
        <Card className="max-w-md w-full p-6 text-center">
          <div className="w-12 h-12 rounded-full bg-green-500/20 flex items-center justify-center mx-auto mb-4">
            <svg className="w-6 h-6 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-pnp-textPrimary mb-2">{s.paymentConfirmed}</h2>
          <p className="text-pnp-textSecondary mb-4 text-sm">
            {s.subscriptionNowActive}
          </p>
          <button
            onClick={() => navigate("/welcome")}
            className="btn-gradient px-6 py-2.5 rounded-xl text-white font-medium"
          >
            {s.goToPNPtv}
          </button>
        </Card>
      </div>
    );
  }

  // Error state (no plans loaded)
  if (error && plans.length === 0) {
    return (
      <div className="page-container flex items-center justify-center min-h-[60vh]">
        <Card className="max-w-md w-full p-6 text-center">
          <div className="w-12 h-12 rounded-full bg-red-500/20 flex items-center justify-center mx-auto mb-4">
            <svg className="w-6 h-6 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
          </div>
          <p className="text-pnp-textSecondary mb-4">{error}</p>
          <button onClick={() => window.location.reload()} className="btn-gradient px-6 py-2 rounded-xl text-white font-medium">
            {s.retry}
          </button>
        </Card>
      </div>
    );
  }

  return (
    <div className="page-container py-6 px-4 max-w-2xl mx-auto">
      {showTutorial && <TutorialOverlay section="subscribe" onDismiss={dismissTutorial} />}
      <Helmet>
        <title>{s.pageTitle}</title>
        <meta name="description" content={s.pageDescription} />
      </Helmet>
      {/* Header */}
      <div className="text-center mb-6">
        <h1 className="text-2xl font-bold text-pnp-textPrimary mb-1">{s.chooseYourPlan}</h1>
        <p className="text-sm text-pnp-textSecondary">
          {s.subtitle}
        </p>
      </div>

      {/* Currency toggle */}
      <div className="flex justify-center mb-4">
        <button
          onClick={() => setShowCOP(!showCOP)}
          className="text-xs text-pnp-textSecondary hover:text-pnp-accent transition-colors"
        >
          {showCOP ? s.showPricesInUSD : s.showPricesInCOP}
        </button>
      </div>

      {/* Plan cards */}
      <div className="space-y-3 mb-6">
        {/* Member tier plans */}
        {plans.some((p) => MEMBER_PLAN_IDS.has(p.id)) && (
          <div className="mb-1">
            <div className="text-xs font-semibold uppercase tracking-wider text-pnp-textSecondary">
              {s.communityMember}
            </div>
            <p className="text-[10px] text-pnp-textSecondary/70 mt-0.5">
              {s.communityMemberDesc}
            </p>
          </div>
        )}
        {plans.filter((p) => MEMBER_PLAN_IDS.has(p.id)).map((plan) => {
          const isSelected = selectedPlan === plan.id;
          const features = PLAN_FEATURES[plan.id] || ["Member access"];
          const displayPrice = showCOP ? formatPrice(plan.priceCOP, "COP") : formatPrice(plan.priceUSD, "USD");

          return (
            <button
              key={plan.id}
              onClick={() => setSelectedPlan(plan.id)}
              className={`w-full text-left rounded-xl p-4 border-2 transition-all duration-200 ${
                isSelected
                  ? "border-[#D4007A] bg-[#D4007A]/10"
                  : "border-white/10 bg-white/5 hover:border-white/20"
              }`}
            >
              <div className="flex items-start justify-between mb-2">
                <div>
                  <span className="font-semibold text-pnp-textPrimary">
                    {plan.display_name || plan.name}
                  </span>
                  <div className="text-xs text-pnp-textSecondary">{s.monthly}</div>
                </div>
                <span className="text-lg font-bold text-pnp-textPrimary">{displayPrice}</span>
              </div>
              <ul className="space-y-1">
                {features.map((f) => (
                  <li key={f} className="flex items-center gap-2 text-xs text-pnp-textSecondary">
                    <svg className="w-3 h-3 text-[#D4007A] flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                    {f}
                  </li>
                ))}
              </ul>
              <ul className="space-y-1 mt-2 pt-2 border-t border-white/5">
                {MEMBER_EXCLUDED.map((f) => (
                  <li key={f} className="flex items-center gap-2 text-xs text-red-400/70">
                    <svg className="w-3 h-3 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                    </svg>
                    {f}
                  </li>
                ))}
              </ul>
            </button>
          );
        })}

        {/* PRIME tier plans */}
        {plans.some((p) => !MEMBER_PLAN_IDS.has(p.id)) && (
          <div className="mt-4 mb-1">
            <div className="text-xs font-semibold uppercase tracking-wider text-pnp-textSecondary">
              {s.prime}
            </div>
            <p className="text-[10px] text-pnp-textSecondary/70 mt-0.5">
              {s.primeDesc}
            </p>
          </div>
        )}
        {plans.filter((p) => !MEMBER_PLAN_IDS.has(p.id)).map((plan) => {
          const isSelected = selectedPlan === plan.id;
          const isRecommended = plan.id === RECOMMENDED_PLAN || plan.sku === RECOMMENDED_PLAN;
          const features = PLAN_FEATURES[plan.sku] || PLAN_FEATURES[plan.id] || ["PRIME access", "Exclusive content"];
          const displayPrice = showCOP ? formatPrice(plan.priceCOP, "COP") : formatPrice(plan.priceUSD, "USD");

          return (
            <button
              key={plan.id}
              onClick={() => setSelectedPlan(plan.id)}
              className={`w-full text-left rounded-xl p-4 border-2 transition-all duration-200 ${
                isSelected
                  ? "border-[#D4007A] bg-[#D4007A]/10"
                  : "border-white/10 bg-white/5 hover:border-white/20"
              } ${isRecommended ? "ring-1 ring-[#FFB454]/40" : ""}`}
            >
              <div className="flex items-start justify-between mb-2">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-pnp-textPrimary">
                      {plan.display_name || plan.name}
                    </span>
                    {isRecommended && (
                      <span className="text-[10px] font-bold uppercase tracking-wider bg-[#FFB454] text-[#1C1C1E] px-2 py-0.5 rounded-full">
                        {s.bestValue}
                      </span>
                    )}
                  </div>
                  <span className="text-xs text-pnp-textSecondary">
                    {durationLabel(plan.duration_days || plan.duration || 30)}
                  </span>
                </div>
                <div className="text-right">
                  <span className="text-lg font-bold text-pnp-textPrimary">{displayPrice}</span>
                  {(plan.duration_days || plan.duration || 0) >= 30 && (plan.duration_days || plan.duration || 0) < 36500 && (
                    <div className="text-[10px] text-pnp-textSecondary">
                      {showCOP
                        ? formatPrice(plan.priceCOP / Math.max(1, Math.round((plan.duration_days || plan.duration || 30) / 30)), "COP")
                        : formatPrice(plan.priceUSD / Math.max(1, Math.round((plan.duration_days || plan.duration || 30) / 30)), "USD")
                      }{s.perMonth}
                    </div>
                  )}
                </div>
              </div>
              <ul className="space-y-1">
                {features.map((f) => (
                  <li key={f} className="flex items-center gap-2 text-xs text-pnp-textSecondary">
                    <svg className="w-3 h-3 text-[#D4007A] flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                    {f}
                  </li>
                ))}
              </ul>
            </button>
          );
        })}
      </div>

      {/* Payment method */}
      <div className="mb-6">
        <h3 className="text-sm font-medium text-pnp-textPrimary mb-3">{s.paymentMethod}</h3>
        <div className="grid grid-cols-3 gap-2">
          <button
            onClick={() => setProvider("epayco")}
            className={`rounded-xl p-3 border-2 transition-all text-center ${
              provider === "epayco"
                ? "border-[#D4007A] bg-[#D4007A]/10"
                : "border-white/10 bg-white/5 hover:border-white/20"
            }`}
          >
            <div className="text-lg mb-1">💳</div>
            <div className="text-xs font-medium text-pnp-textPrimary">{s.cardPse}</div>
            <div className="text-[10px] text-pnp-textSecondary">{s.cardPseDesc}</div>
          </button>
          <button
            onClick={() => setProvider("daimo")}
            className={`rounded-xl p-3 border-2 transition-all text-center ${
              provider === "daimo"
                ? "border-[#D4007A] bg-[#D4007A]/10"
                : "border-white/10 bg-white/5 hover:border-white/20"
            }`}
          >
            <div className="text-lg mb-1">💸</div>
            <div className="text-xs font-medium text-pnp-textPrimary">{s.usdc}</div>
            <div className="text-[10px] text-pnp-textSecondary">{s.usdcDesc}</div>
          </button>
          <button
            onClick={() => dashAvailable !== false && setProvider("dash")}
            disabled={dashAvailable === false}
            className={`rounded-xl p-3 border-2 transition-all text-center relative ${
              dashAvailable === false
                ? "border-white/5 bg-white/3 opacity-50 cursor-not-allowed"
                : provider === "dash"
                ? "border-[#008DE4] bg-[#008DE4]/10"
                : "border-white/10 bg-white/5 hover:border-white/20"
            }`}
          >
            <div className="text-lg mb-1">🥷</div>
            <div className="text-xs font-medium text-pnp-textPrimary">{s.dash}</div>
            <div className="text-[10px] text-pnp-textSecondary">{dashAvailable === false ? s.dashComingSoon : s.dashAnonymous}</div>
            {dashAvailable !== false && (
              <span className="absolute -top-1.5 -right-1.5 text-[9px] font-bold bg-[#008DE4] text-white px-1.5 py-0.5 rounded-full leading-none">
                {s.dashAnonBadge}
              </span>
            )}
          </button>
        </div>

        {/* Daimo info panel */}
        {provider === "daimo" && (
          <div className="mt-3 rounded-xl p-3 border border-[#D4007A]/30 bg-[#D4007A]/5">
            <p className="text-xs text-pnp-textSecondary">
              {s.daimoHint}
            </p>
          </div>
        )}

        {/* Dash info panel */}
        {provider === "dash" && (
          <div className="mt-3 rounded-xl p-3 border border-[#008DE4]/30 bg-[#008DE4]/5 space-y-2">
            <p className="text-xs text-pnp-textSecondary">
              {s.dashInfoText}
            </p>
            <div className="flex flex-wrap gap-2 text-[10px]">
              <a href="https://www.dash.org/downloads/" target="_blank" rel="noopener noreferrer"
                className="text-[#008DE4] hover:underline">
                {s.getDashWallet}
              </a>
              <span className="text-pnp-textSecondary/40">·</span>
              <a href="https://www.kraken.com/learn/buy-dash-coin" target="_blank" rel="noopener noreferrer"
                className="text-[#008DE4] hover:underline">
                {s.buyOnKraken}
              </a>
              <span className="text-pnp-textSecondary/40">·</span>
              <a href="https://uphold.com/en/assets/crypto/buy-dash" target="_blank" rel="noopener noreferrer"
                className="text-[#008DE4] hover:underline">
                {s.buyOnUphold}
              </a>
            </div>
          </div>
        )}
      </div>

      {/* Dash invoice modal */}
      {dashInvoice && (
        <div className="mb-6 rounded-xl border border-[#008DE4]/40 bg-[#008DE4]/5 p-4">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-2 h-2 rounded-full bg-[#008DE4] animate-pulse" />
            <span className="text-sm font-medium text-pnp-textPrimary">
              {s.waitingForDashPayment} {dashInvoice.planName}
            </span>
          </div>
          <p className="text-xs text-pnp-textSecondary mb-3">
            {s.dashInvoiceDesc}
          </p>
          <a
            href={dashInvoice.checkoutUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="block w-full text-center py-2.5 rounded-xl bg-[#008DE4] text-white text-sm font-semibold hover:bg-[#0070b8] transition-colors mb-2"
          >
            {s.openDashCheckout}
          </a>
          <button
            onClick={() => { setDashInvoice(null); setDashPolling(false); }}
            className="w-full text-xs text-pnp-textSecondary hover:text-pnp-textPrimary transition-colors py-1"
          >
            {s.cancel}
          </button>
        </div>
      )}

      {/* Lifetime100 promo + Meru code */}
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-3">
          <div className="flex-1 h-px bg-white/10" />
          <span className="text-xs text-pnp-textSecondary">{s.or}</span>
          <div className="flex-1 h-px bg-white/10" />
        </div>

        {/* Lifetime100 promo */}
        <div className="rounded-xl p-4 border border-[#FFB454]/30 bg-[#FFB454]/5 mb-4">
          <p className="text-sm text-pnp-textPrimary font-medium mb-1">
            {s.wantBestDeal}
          </p>
          <p className="text-xs text-pnp-textSecondary mb-3">
            {s.lifetime100Desc}
          </p>
          <a
            href="/lifetime100"
            className="inline-block text-xs font-semibold text-[#FFB454] hover:text-[#ffcc80] transition-colors border-b border-[#FFB454]/50"
          >
            {s.checkoutLifetime100}
          </a>
        </div>

        {/* Meru code */}
        <label className="text-sm font-medium text-pnp-textPrimary mb-2 block">
          {s.haveMeruCode}
        </label>
        <input
          type="email"
          value={meruEmail}
          onChange={(e) => { setMeruEmail(e.target.value); setMeruError(null); }}
          placeholder={s.emailPlaceholder}
          disabled={meruSubmitting}
          className="w-full rounded-xl px-4 py-2.5 mb-2 bg-white/5 border border-white/10 text-sm text-pnp-textPrimary placeholder-pnp-textSecondary focus:outline-none focus:border-[#D4007A] transition-colors disabled:opacity-50"
        />
        <div className="flex gap-2">
          <input
            type="text"
            value={meruCode}
            onChange={(e) => { setMeruCode(e.target.value); setMeruError(null); }}
            placeholder={s.meruCodePlaceholder}
            disabled={meruSubmitting}
            className="flex-1 rounded-xl px-4 py-2.5 bg-white/5 border border-white/10 text-sm text-pnp-textPrimary placeholder-pnp-textSecondary focus:outline-none focus:border-[#D4007A] transition-colors disabled:opacity-50"
          />
          <button
            onClick={handleMeruActivate}
            disabled={!meruCode.trim() || !meruEmail.trim() || meruSubmitting}
            className="btn-gradient px-5 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
          >
            {meruSubmitting ? s.verifying : s.activate}
          </button>
        </div>
        {meruSubmitting && (
          <p className="mt-2 text-xs text-pnp-textSecondary">
            {s.verifyingPayment}
          </p>
        )}
        {meruError && (
          <p className="mt-2 text-xs text-red-400">{meruError}</p>
        )}
      </div>

      {/* Payment polling indicator */}
      {pollingPaymentId && (
        <div className="mb-4 p-3 rounded-xl bg-[#D4007A]/10 border border-[#D4007A]/20 text-sm text-pnp-textPrimary text-center">
          <div className="flex items-center justify-center gap-2 mb-1">
            <svg className="animate-spin h-4 w-4 text-[#D4007A]" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <span className="font-medium">{s.waitingForPayment}</span>
          </div>
          <p className="text-xs text-pnp-textSecondary">
            {s.completePaymentInWindow}
          </p>
        </div>
      )}

      {/* Error banner */}
      {error && (
        <div className="mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-sm text-red-400 text-center">
          {error}
        </div>
      )}

      {/* Subscribe button */}
      <button
        onClick={handleSubscribe}
        disabled={!selectedPlan || submitting}
        className="btn-gradient w-full py-3.5 rounded-xl font-semibold text-white disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {submitting ? (
          <span className="flex items-center justify-center gap-2">
            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            {s.processingPayment}
          </span>
        ) : (
          s.subscribeNow
        )}
      </button>

      {/* Back link */}
      <button
        onClick={() => navigate(-1)}
        className="w-full mt-3 py-2 text-sm text-pnp-textSecondary hover:text-pnp-textPrimary transition-colors"
      >
        {s.goBack}
      </button>
    </div>
  );
}
