import React, { useState, useEffect, useCallback, useRef } from "react";
import { Helmet } from "react-helmet-async";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Card, Skeleton } from "@pnptv/ui-kit";
import { QRCodeSVG } from "qrcode.react";
import {
  getSubscriptionPlans,
  createPayment,
  getPaymentStatus,
  createDashSubscription,
  getDashSubscriptionStatus,
  getDashAvailable,
  getDashPaymentDetails,
  activateMeruCode,
  getLabelColor,
  assertPaymentUrl,
  validatePromoCode,
  type SubscriptionPlan,
} from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { useTutorial } from "@/hooks/useTutorial";
import { TutorialOverlay } from "@/components/tutorial/TutorialOverlay";
import { useI18n } from "@/lib/i18n";

type Provider = "epayco" | "dash";

const MEMBER_PLAN_IDS = new Set(["member_monthly"]);

const RECOMMENDED_PLAN = "prime-diamond-pass-365d";

function formatPrice(amount: number, currency: string): string {
  if (currency === "COP") {
    return new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", minimumFractionDigits: 0 }).format(amount);
  }
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);
}

function durationLabel(days: number): string {
  if (days >= 36500) return "Lifetime";
  const years = Math.round(days / 365);
  if (days >= 365) return `${years} ${years === 1 ? "Year" : "Years"}`;
  const months = Math.round(days / 30);
  if (days >= 30) return `${months} ${months === 1 ? "Month" : "Months"}`;
  return `${days} ${days === 1 ? "Day" : "Days"}`;
}

function getPlanLabel(plan: SubscriptionPlan, isMemberPlan: boolean): 'PRIME' | 'BASIC' | 'FREE' {
  if (plan.tier) {
    const t = plan.tier.toLowerCase();
    if (t === 'prime') return 'PRIME';
    if (t === 'member') return 'BASIC';
  }
  return isMemberPlan ? 'BASIC' : 'PRIME';
}

function isLifetimePlan(plan: SubscriptionPlan): boolean {
  return !!(plan.isLifetime || (plan.duration_days ?? plan.duration ?? 0) >= 36500);
}

export default function Subscribe() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user, refreshUser } = useAuth();
  const { showTutorial, dismissTutorial, dismissForever } = useTutorial("subscribe");
  const t = useI18n();
  const s = t.subscribe;

  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedPlan, setSelectedPlan] = useState<string | null>(null);
  const [provider, setProvider] = useState<Provider>("epayco");
  const [submitting, setSubmitting] = useState(false);
  const [showCOP, setShowCOP] = useState(false);

  // Promo code state — driven by ?promo= URL param or the "Have a code?" input
  const [promoInput, setPromoInput] = useState(searchParams.get("promo") || "");
  const [appliedPromo, setAppliedPromo] = useState<{
    code: string;
    finalPrice: number;
    originalPrice: number;
    discountAmount: number;
    basePlanId: string | null;
    isAnyPlan: boolean;
  } | null>(null);
  const [promoError, setPromoError] = useState<string | null>(null);
  const [promoValidating, setPromoValidating] = useState(false);

  // Payment polling state
  const [pollingPaymentId, setPollingPaymentId] = useState<string | null>(null);
  const [paymentSuccess, setPaymentSuccess] = useState(false);

  // Dash availability
  const [dashAvailable, setDashAvailable] = useState<boolean | null>(null);

  // Dash invoice state
  const [dashInvoice, setDashInvoice] = useState<{
    invoiceId: string;
    checkoutUrl: string;
    planName: string;
    destination?: string;
    amount?: string;
    due?: string;
    totalDue?: string;
    rate?: string | null;
    loadingDetails?: boolean;
    detailsError?: string;
    invoiceAmount?: number | null;
    createdAt: number;
  } | null>(null);
  const [dashPolling, setDashPolling] = useState(false);
  const [dashCopied, setDashCopied] = useState(false);
  const [dashSecondsLeft, setDashSecondsLeft] = useState(900);
  const [dashPaymentSuccess, setDashPaymentSuccess] = useState(false);
  const dashCountdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

  // Validate a promo code server-side. For base-plan promos, we lock the
  // selected plan to the promo's base plan so the displayed price matches.
  const applyPromo = useCallback(async (rawCode: string, planId?: string | null) => {
    const code = rawCode.trim();
    if (!code) {
      setAppliedPromo(null);
      setPromoError(null);
      return;
    }
    setPromoValidating(true);
    setPromoError(null);
    try {
      const res = await validatePromoCode(code, planId || undefined);
      if (!res.success) {
        setAppliedPromo(null);
        setPromoError(res.message || s.promoInvalid);
        return;
      }
      // For any-plan promos without a planId yet, we can't compute finalPrice — defer.
      if (res.isAnyPlan && (!res.pricing || res.pricing.finalPrice == null)) {
        setAppliedPromo({
          code: res.code || code,
          finalPrice: 0,
          originalPrice: 0,
          discountAmount: 0,
          basePlanId: null,
          isAnyPlan: true,
        });
        setPromoError(null);
        return;
      }
      if (!res.pricing || res.pricing.finalPrice == null || res.pricing.originalPrice == null) {
        setAppliedPromo(null);
        setPromoError(s.promoInvalid);
        return;
      }
      setAppliedPromo({
        code: res.code || code,
        finalPrice: res.pricing.finalPrice,
        originalPrice: res.pricing.originalPrice,
        discountAmount: res.pricing.discountAmount || (res.pricing.originalPrice - res.pricing.finalPrice),
        basePlanId: res.basePlanId || null,
        isAnyPlan: !!res.isAnyPlan,
      });
      // Lock selection to the promo's base plan if it's a single-plan promo
      if (!res.isAnyPlan && res.basePlanId) {
        setSelectedPlan(res.basePlanId);
      }
    } catch (err) {
      setAppliedPromo(null);
      setPromoError(err instanceof Error ? err.message : s.promoInvalid);
    } finally {
      setPromoValidating(false);
    }
  }, [s]);

  // Auto-apply promo from URL once plans load — need plans first so we can lock selection
  const autoAppliedRef = useRef(false);
  useEffect(() => {
    if (autoAppliedRef.current) return;
    const urlPromo = searchParams.get("promo");
    if (!urlPromo || plans.length === 0) return;
    autoAppliedRef.current = true;
    applyPromo(urlPromo, null);
  }, [plans, searchParams, applyPromo]);

  // When selectedPlan changes and an any-plan promo is applied, re-validate
  // to get the correct discounted price for the new plan.
  useEffect(() => {
    if (!appliedPromo?.isAnyPlan || !selectedPlan) return;
    applyPromo(appliedPromo.code, selectedPlan);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPlan]);

  function clearPromo() {
    setAppliedPromo(null);
    setPromoInput("");
    setPromoError(null);
    const next = new URLSearchParams(searchParams);
    next.delete("promo");
    setSearchParams(next, { replace: true });
  }

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
        if (data.status === "completed" || data.status === "paid" || data.status === "success") {
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
          setDashPaymentSuccess(true);
          await refreshUser();
          setTimeout(() => {
            setDashInvoice(null);
            setDashPaymentSuccess(false);
            setPaymentSuccess(true);
          }, 2000);
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

  // Countdown timer for Dash invoice (15-minute expiry)
  useEffect(() => {
    if (!dashInvoice || !dashPolling) {
      if (dashCountdownRef.current) {
        clearInterval(dashCountdownRef.current);
        dashCountdownRef.current = null;
      }
      return;
    }
    const tick = () => {
      const elapsed = Math.floor((Date.now() - dashInvoice.createdAt) / 1000);
      const remaining = Math.max(0, 900 - elapsed);
      setDashSecondsLeft(remaining);
      if (remaining === 0) {
        if (dashCountdownRef.current) {
          clearInterval(dashCountdownRef.current);
          dashCountdownRef.current = null;
        }
        setDashPolling(false);
      }
    };
    tick();
    dashCountdownRef.current = setInterval(tick, 1000);
    return () => {
      if (dashCountdownRef.current) {
        clearInterval(dashCountdownRef.current);
        dashCountdownRef.current = null;
      }
    };
  }, [dashInvoice, dashPolling]);

  async function handleSubscribe() {
    if (!selectedPlan || submitting) return;

    setSubmitting(true);
    setError(null);

    try {
      if (provider === "dash") {
        const result = await createDashSubscription(selectedPlan);
        if (result.success && result.checkoutUrl) {
          const invoice = {
            invoiceId: result.invoiceId,
            checkoutUrl: assertPaymentUrl(result.checkoutUrl),
            planName: result.planName || "subscription",
            loadingDetails: true,
            createdAt: Date.now(),
          };
          setDashInvoice(invoice);
          setDashSecondsLeft(900);
          setDashPolling(true);
          // Fetch payment details for in-app widget
          getDashPaymentDetails(result.invoiceId)
            .then((details) => {
              if (details.success) {
                setDashInvoice((prev) => prev ? {
                  ...prev,
                  destination: details.destination,
                  amount: details.amount,
                  due: details.due,
                  totalDue: details.totalDue,
                  rate: details.rate,
                  invoiceAmount: details.invoiceAmount,
                  loadingDetails: false,
                } : prev);
              } else {
                setDashInvoice((prev) => prev ? { ...prev, loadingDetails: false, detailsError: "Could not load payment details" } : prev);
              }
            })
            .catch(() => {
              setDashInvoice((prev) => prev ? { ...prev, loadingDetails: false, detailsError: "Could not load payment details" } : prev);
            });
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
        const result = await createPayment(
          selectedPlan,
          provider,
          undefined,
          appliedPromo?.code,
        );
        if (result.success && result.paymentUrl) {
          window.open(assertPaymentUrl(result.paymentUrl), "_blank", "noopener,noreferrer");
          if (result.paymentId) {
            setPollingPaymentId(result.paymentId);
          }
        } else {
          // If the promo got rejected at claim-time (e.g. already_redeemed),
          // surface the message and clear the applied promo so the user can retry.
          setError(result.message || result.error || s.failedToCreatePayment);
          if (result.error && /promo|claim|redeem/.test(result.error)) {
            setAppliedPromo(null);
          }
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

  // Derive current tier display from user object
  function renderTierBanner() {
    if (!user) return null;
    const tier = (user.tier || "free").toLowerCase();
    if (tier === "prime") {
      return (
        <div className="mb-5 rounded-xl px-4 py-3 border border-[#FFB454]/30 bg-[#FFB454]/8 flex items-center gap-3">
          <span className="text-[#FFB454] text-lg">★</span>
          <div>
            <p className="text-sm font-semibold text-[#FFB454]">{s.currentTierPrime}</p>
            <p className="text-xs text-pnp-textSecondary">{s.extendCta}</p>
          </div>
        </div>
      );
    }
    if (tier === "member") {
      return (
        <div className="mb-5 rounded-xl px-4 py-3 border border-blue-400/30 bg-blue-400/8 flex items-center gap-3">
          <span className="text-blue-400 text-lg">◆</span>
          <div>
            <p className="text-sm font-semibold text-blue-400">{s.currentTierMember}</p>
            <p className="text-xs text-pnp-textSecondary">{s.extendCta}</p>
          </div>
        </div>
      );
    }
    // free / unknown
    return (
      <div className="mb-5 rounded-xl px-4 py-3 border border-white/10 bg-white/5 flex items-center gap-3">
        <span className="text-pnp-textSecondary text-lg">○</span>
        <div>
          <p className="text-sm font-medium text-pnp-textPrimary">{s.currentTierFree}</p>
          <p className="text-xs text-pnp-textSecondary">{s.upgradeCta}</p>
        </div>
      </div>
    );
  }

  // Build feature list for a plan from server-driven data
  function getPlanFeatures(plan: SubscriptionPlan, isMemberPlan: boolean): string[] {
    if (plan.features && plan.features.length > 0) {
      return plan.features;
    }
    return isMemberPlan ? [s.platformAccess] : [s.primeAccess];
  }

  // Resolve an add-on to a display label
  function addOnLabel(addOnId: string | undefined, name?: string): string {
    if (!addOnId) return name || "";
    const id = addOnId.toLowerCase();
    if (id === "pnp-member" || id === "member" || id === "basic") return s.addonMember;
    if (id === "prime") return s.addonPrime;
    if (id === "creator-subscription" || id === "creator") return s.addonCreator;
    if (id.includes("private") || id.includes("call")) return s.addonPrivateCalls;
    return name || addOnId;
  }

  // Newsletter opt-in state (shown after payment success)
  // IMPORTANT: hooks must be before any early returns to satisfy React's rules of hooks
  const [newsletterDismissed, setNewsletterDismissed] = useState(() => {
    try { return localStorage.getItem("pnp_newsletter_dismissed") === "1"; } catch { return false; }
  });
  const [newsletterSubscribed, setNewsletterSubscribed] = useState(false);
  const [newsletterLoading, setNewsletterLoading] = useState(false);

  const handleNewsletterSubscribe = useCallback(async () => {
    if (!user?.email) return;
    setNewsletterLoading(true);
    try {
      await fetch("/api/newsletter/subscription", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: user.email, list_ids: [3], name: user.firstName || undefined }),
      });
      setNewsletterSubscribed(true);
    } catch { /* silent */ }
    finally { setNewsletterLoading(false); }
  }, [user]);

  const handleNewsletterDismiss = useCallback(() => {
    try { localStorage.setItem("pnp_newsletter_dismissed", "1"); } catch { /* noop */ }
    setNewsletterDismissed(true);
  }, []);

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

          {/* Newsletter opt-in */}
          {!newsletterDismissed && !newsletterSubscribed && user?.email && (
            <div className="mb-4 p-3 rounded-xl text-left" style={{ background: "rgba(212,0,122,0.08)", border: "1px solid rgba(212,0,122,0.2)" }}>
              <p className="text-xs font-semibold text-pnp-textPrimary mb-0.5">Stay in the loop</p>
              <p className="text-xs text-pnp-textSecondary mb-2">Get PNPtv! news, creator drops, and exclusive offers in your inbox.</p>
              <div className="flex gap-2">
                <button
                  onClick={handleNewsletterSubscribe}
                  disabled={newsletterLoading}
                  className="flex-1 py-1.5 rounded-lg text-xs font-semibold text-white transition-all disabled:opacity-50"
                  style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
                >
                  {newsletterLoading ? "..." : "Subscribe"}
                </button>
                <button onClick={handleNewsletterDismiss} className="py-1.5 px-3 rounded-lg text-xs text-pnp-textSecondary hover:text-white/70 transition-colors">
                  No thanks
                </button>
              </div>
            </div>
          )}
          {newsletterSubscribed && (
            <p className="text-xs text-green-400 mb-4">You're subscribed to the PNPtv! newsletter.</p>
          )}

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

  const memberPlans = plans.filter((p) => MEMBER_PLAN_IDS.has(p.id));
  const primePlans = plans.filter((p) => !MEMBER_PLAN_IDS.has(p.id));

  return (
    <div className="page-container py-6 px-4 max-w-2xl mx-auto">
      {showTutorial && <TutorialOverlay section="subscribe" onDismiss={dismissTutorial} onDismissForever={dismissForever} />}
      <Helmet>
        <title>{s.pageTitle}</title>
        <meta name="description" content={s.pageDescription} />
      </Helmet>

      {/* Header */}
      <div className="text-center mb-6">
        <h1 className="text-2xl font-bold text-pnp-textPrimary mb-1">{s.chooseYourPlan}</h1>
        <p className="text-sm text-pnp-textSecondary">{s.subtitle}</p>
      </div>

      {/* Current tier status banner */}
      {renderTierBanner()}

      {/* Promo code banner — applied state */}
      {appliedPromo && (
        <div
          className="mb-4 rounded-xl px-4 py-3 border flex items-center justify-between gap-3"
          style={{ borderColor: "rgba(212,0,122,0.4)", background: "rgba(212,0,122,0.10)" }}
        >
          <div className="min-w-0">
            <p className="text-xs font-semibold text-pnp-accent uppercase tracking-wider">
              {s.promoApplied}
            </p>
            <p className="text-sm font-mono text-pnp-textPrimary truncate">
              {appliedPromo.code}
            </p>
            {appliedPromo.originalPrice > 0 && (
              <p className="text-xs text-pnp-textSecondary mt-0.5">
                <span className="line-through">{formatPrice(appliedPromo.originalPrice, "USD")}</span>
                <span className="mx-2">→</span>
                <span className="text-pnp-accent font-semibold">{formatPrice(appliedPromo.finalPrice, "USD")}</span>
              </p>
            )}
          </div>
          <button
            onClick={clearPromo}
            className="shrink-0 text-xs text-pnp-textSecondary hover:text-pnp-textPrimary underline decoration-dotted"
            aria-label={s.promoRemove}
          >
            {s.promoRemove}
          </button>
        </div>
      )}

      {/* Promo code input — shown only when no promo is applied yet */}
      {!appliedPromo && (
        <details className="mb-4 rounded-xl px-4 py-3 border border-white/10 bg-white/[0.02]">
          <summary className="cursor-pointer text-xs font-semibold text-pnp-textSecondary hover:text-pnp-textPrimary transition-colors select-none">
            {s.promoHaveCode}
          </summary>
          <div className="flex gap-2 mt-3">
            <input
              type="text"
              value={promoInput}
              onChange={(e) => setPromoInput(e.target.value.toUpperCase())}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  applyPromo(promoInput, selectedPlan);
                }
              }}
              placeholder={s.promoCodePlaceholder}
              maxLength={64}
              className="flex-1 px-3 py-2 rounded-lg bg-pnp-surface border border-white/10 text-sm text-pnp-textPrimary placeholder:text-pnp-textSecondary/60 focus:outline-none focus:border-pnp-accent/50"
            />
            <button
              onClick={() => applyPromo(promoInput, selectedPlan)}
              disabled={promoValidating || !promoInput.trim()}
              className="px-4 py-2 rounded-lg bg-pnp-accent text-white text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {promoValidating ? "…" : s.promoApply}
            </button>
          </div>
          {promoError && (
            <p className="mt-2 text-xs text-red-400">{promoError}</p>
          )}
        </details>
      )}

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
        {memberPlans.length > 0 && (
          <div className="mb-1">
            <div className="text-xs font-semibold uppercase tracking-wider text-pnp-textSecondary">
              {s.communityMember}
            </div>
            <p className="text-[10px] text-pnp-textSecondary/70 mt-0.5">
              {s.communityMemberDesc}
            </p>
          </div>
        )}
        {memberPlans.map((plan) => {
          const isSelected = selectedPlan === plan.id;
          const features = getPlanFeatures(plan, true);
          const displayPrice = showCOP ? formatPrice(plan.priceCOP, "COP") : formatPrice(plan.priceUSD, "USD");
          const planLabel = getPlanLabel(plan, true);
          const hasAddOns = plan.addOns && plan.addOns.length > 0;

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
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-pnp-textPrimary">
                      {plan.display_name || plan.name}
                    </span>
                    <span className={`inline-flex items-center text-[10px] font-bold px-1.5 py-0.5 rounded-full border ${getLabelColor(planLabel)}`}>
                      {planLabel}
                    </span>
                    {isLifetimePlan(plan) && (
                      <span className="text-[10px] font-bold uppercase tracking-wider bg-[#FFB454] text-[#1C1C1E] px-2 py-0.5 rounded-full">
                        {s.lifetime}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-pnp-textSecondary">{s.monthly}</div>
                </div>
                <span className="text-lg font-bold text-pnp-textPrimary">{displayPrice}</span>
              </div>
              <ul className="space-y-1">
                {features.map((f, i) => (
                  <li key={i} className="flex items-center gap-2 text-xs text-pnp-textSecondary">
                    <svg className="w-3 h-3 text-[#D4007A] flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                    {f}
                  </li>
                ))}
              </ul>
              {hasAddOns && (
                <div className="mt-2 pt-2 border-t border-white/5 flex items-center gap-1.5 flex-wrap">
                  <span className="text-[10px] text-pnp-textSecondary/70">{s.includesAddOns}</span>
                  {plan.addOns!.map((ao) => (
                    <span
                      key={ao.id || ao.add_on_id}
                      className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-white/10 text-pnp-textSecondary border border-white/10"
                    >
                      {addOnLabel(ao.id || ao.add_on_id, ao.name)}
                      {ao.is_lifetime && " ∞"}
                    </span>
                  ))}
                </div>
              )}
            </button>
          );
        })}

        {/* PRIME tier plans */}
        {primePlans.length > 0 && (
          <div className="mt-4 mb-1">
            <div className="text-xs font-semibold uppercase tracking-wider text-pnp-textSecondary">
              {s.prime}
            </div>
            <p className="text-[10px] text-pnp-textSecondary/70 mt-0.5">
              {s.primeDesc}
            </p>
          </div>
        )}
        {primePlans.map((plan) => {
          const isSelected = selectedPlan === plan.id;
          const isRecommended = plan.id === RECOMMENDED_PLAN || plan.sku === RECOMMENDED_PLAN;
          const features = getPlanFeatures(plan, false);
          const displayPrice = showCOP ? formatPrice(plan.priceCOP, "COP") : formatPrice(plan.priceUSD, "USD");
          const planLabel = getPlanLabel(plan, false);
          const hasAddOns = plan.addOns && plan.addOns.length > 0;
          const planDays = plan.duration_days || plan.duration || 30;

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
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-pnp-textPrimary">
                      {plan.display_name || plan.name}
                    </span>
                    <span className={`inline-flex items-center text-[10px] font-bold px-1.5 py-0.5 rounded-full border ${getLabelColor(planLabel)}`}>
                      {planLabel}
                    </span>
                    {isRecommended && (
                      <span className="text-[10px] font-bold uppercase tracking-wider bg-[#FFB454] text-[#1C1C1E] px-2 py-0.5 rounded-full">
                        {s.bestValue}
                      </span>
                    )}
                    {isLifetimePlan(plan) && !isRecommended && (
                      <span className="text-[10px] font-bold uppercase tracking-wider bg-[#FFB454] text-[#1C1C1E] px-2 py-0.5 rounded-full">
                        {s.lifetime}
                      </span>
                    )}
                  </div>
                  <span className="text-xs text-pnp-textSecondary">
                    {durationLabel(planDays)}
                  </span>
                </div>
                <div className="text-right">
                  <span className="text-lg font-bold text-pnp-textPrimary">{displayPrice}</span>
                  {planDays >= 30 && planDays < 36500 && (
                    <div className="text-[10px] text-pnp-textSecondary">
                      {showCOP
                        ? formatPrice(plan.priceCOP / Math.max(1, Math.round(planDays / 30)), "COP")
                        : formatPrice(plan.priceUSD / Math.max(1, Math.round(planDays / 30)), "USD")
                      }{s.perMonth}
                    </div>
                  )}
                </div>
              </div>

              {/* "Everything in Member plus:" header for PRIME plans */}
              <p className="text-[10px] text-pnp-textSecondary/70 mb-1.5">{s.everythingInMemberPlus}</p>

              <ul className="space-y-1">
                {features.map((f, i) => (
                  <li key={i} className="flex items-center gap-2 text-xs text-pnp-textSecondary">
                    <svg className="w-3 h-3 text-[#D4007A] flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                    {f}
                  </li>
                ))}
              </ul>

              {hasAddOns && (
                <div className="mt-2 pt-2 border-t border-white/5 flex items-center gap-1.5 flex-wrap">
                  <span className="text-[10px] text-pnp-textSecondary/70">{s.includesAddOns}</span>
                  {plan.addOns!.map((ao) => (
                    <span
                      key={ao.id || ao.add_on_id}
                      className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-white/10 text-pnp-textSecondary border border-white/10"
                    >
                      {addOnLabel(ao.id || ao.add_on_id, ao.name)}
                      {ao.is_lifetime && " ∞"}
                    </span>
                  ))}
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* Payment method */}
      <div className="mb-6">
        <h3 className="text-sm font-medium text-pnp-textPrimary mb-3">{s.paymentMethod}</h3>
        <div className="grid grid-cols-2 gap-2">
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

      {/* Dash in-app payment widget */}
      {dashInvoice && (
        <div className="mb-6 rounded-xl border border-[#008DE4]/40 bg-[#008DE4]/5 p-4">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-2 h-2 rounded-full bg-[#008DE4] animate-pulse" />
            <span className="text-sm font-medium text-pnp-textPrimary">
              {s.waitingForDashPayment} {dashInvoice.planName}
            </span>
          </div>

          {dashInvoice.loadingDetails ? (
            <div className="flex flex-col items-center py-6 gap-3">
              <svg className="animate-spin h-6 w-6 text-[#008DE4]" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              <p className="text-xs text-pnp-textSecondary">{s.dashLoadingDetails}</p>
            </div>
          ) : dashPaymentSuccess ? (
            <div className="flex flex-col items-center gap-3 py-6">
              <div className="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center">
                <svg className="w-8 h-8 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <p className="text-base font-semibold text-green-400">{s.dashPaymentConfirmed}</p>
              <p className="text-xs text-pnp-textSecondary">{s.subscriptionNowActive}</p>
            </div>
          ) : dashSecondsLeft === 0 ? (
            <div className="flex flex-col items-center gap-3 py-6">
              <p className="text-sm font-medium text-red-400">{s.dashExpired}</p>
              <button
                onClick={() => { setDashInvoice(null); setDashPolling(false); setDashCopied(false); setDashSecondsLeft(900); }}
                className="mt-1 px-4 py-2 rounded-lg bg-[#008DE4] text-white text-xs font-semibold hover:bg-[#0070b8] transition-colors"
              >
                {s.retry}
              </button>
            </div>
          ) : dashInvoice.destination && dashInvoice.amount ? (
            <div className="flex flex-col items-center gap-4">
              {/* QR Code */}
              <div className="bg-white p-3 rounded-xl">
                <QRCodeSVG
                  value={`dash:${dashInvoice.destination}?amount=${dashInvoice.amount}`}
                  size={180}
                  level="M"
                />
              </div>
              <p className="text-[10px] text-pnp-textSecondary">{s.dashScanQr}</p>

              {/* Amount */}
              <div className="text-center">
                <p className="text-xs text-pnp-textSecondary mb-1">{s.dashAmountDue}</p>
                <p className="text-xl font-bold text-white">{dashInvoice.amount} DASH</p>
                {dashInvoice.invoiceAmount != null && (
                  <p className="text-xs text-pnp-textSecondary mt-0.5">
                    ~${dashInvoice.invoiceAmount.toFixed(2)} USD
                  </p>
                )}
              </div>

              {/* Countdown timer */}
              <p className={`text-xs font-mono tabular-nums ${
                dashSecondsLeft <= 60
                  ? "text-red-400"
                  : dashSecondsLeft <= 300
                  ? "text-orange-400"
                  : "text-pnp-textSecondary"
              }`}>
                {String(Math.floor(dashSecondsLeft / 60)).padStart(2, "0")}:{String(dashSecondsLeft % 60).padStart(2, "0")} remaining
              </p>

              {/* Address + Copy */}
              <div className="w-full">
                <p className="text-[10px] text-pnp-textSecondary mb-1">{s.dashToAddress}</p>
                <div className="flex items-center gap-2 rounded-lg px-3 py-2 bg-white/5 border border-white/10">
                  <code className="flex-1 text-xs text-white/80 break-all font-mono">
                    {dashInvoice.destination}
                  </code>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(dashInvoice.destination!).catch(() => {});
                      setDashCopied(true);
                      setTimeout(() => setDashCopied(false), 2000);
                    }}
                    className={`flex-shrink-0 text-xs font-semibold px-2 py-1 rounded transition-colors ${dashCopied ? "text-green-400" : "text-[#008DE4]"}`}
                  >
                    {dashCopied ? s.dashCopied : s.dashCopyAddress}
                  </button>
                </div>
              </div>

              <p className="text-xs text-pnp-textSecondary text-center">
                {s.dashInvoiceDesc}
              </p>

              {/* Fallback external link */}
              <a
                href={dashInvoice.checkoutUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-[#008DE4] hover:underline transition-colors"
              >
                {s.dashOpenExternal}
              </a>
            </div>
          ) : (
            /* Fallback if details failed to load — show original external link */
            <>
              <p className="text-xs text-pnp-textSecondary mb-3">
                {dashInvoice.detailsError || s.dashInvoiceDesc}
              </p>
              <a
                href={dashInvoice.checkoutUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="block w-full text-center py-2.5 rounded-xl bg-[#008DE4] text-white text-sm font-semibold hover:bg-[#0070b8] transition-colors mb-2"
              >
                {s.openDashCheckout}
              </a>
            </>
          )}

          <button
            onClick={() => { setDashInvoice(null); setDashPolling(false); setDashCopied(false); setDashSecondsLeft(900); setDashPaymentSuccess(false); }}
            className="w-full text-xs text-pnp-textSecondary hover:text-pnp-textPrimary transition-colors py-1 mt-2"
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
            href="/subscribe?promo=lifetime100"
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
          className="w-full rounded-xl px-4 py-2.5 mb-2 bg-white/5 border border-white/10 text-pnp-textPrimary placeholder-pnp-textSecondary focus:outline-none focus:border-[#D4007A] transition-colors disabled:opacity-50"
          style={{ fontSize: "16px" }}
        />
        <div className="flex gap-2">
          <input
            type="text"
            value={meruCode}
            onChange={(e) => { setMeruCode(e.target.value); setMeruError(null); }}
            placeholder={s.meruCodePlaceholder}
            disabled={meruSubmitting}
            className="flex-1 rounded-xl px-4 py-2.5 bg-white/5 border border-white/10 text-pnp-textPrimary placeholder-pnp-textSecondary focus:outline-none focus:border-[#D4007A] transition-colors disabled:opacity-50"
            style={{ fontSize: "16px" }}
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
