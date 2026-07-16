import React, { useState, useEffect, useCallback, useRef } from "react";
import { Helmet } from "react-helmet-async";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Card, Skeleton } from "@pnptv/ui-kit";
import {
  getSubscriptionPlans,
  getPaymentStatus,
  getUsdcAvailable,
  getBtcAvailable,
  createBtcSubscription,
  getBtcSubscriptionStatus,
  getDashAvailable,
  createDashSubscription,
  getDashSubscriptionStatus,
  getLabelColor,
  validatePromoCode,
  trackEvent,
  redeemActivationCode,
  assertPaymentUrl,
  NP_COINS,
  type SubscriptionPlan,
} from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { useTutorial } from "@/hooks/useTutorial";
import { TutorialOverlay } from "@/components/tutorial/TutorialOverlay";
import { useI18n } from "@/lib/i18n";

import { useNowPayments } from "@/hooks/useNowPayments";
import { NowPaymentsWaitingPanel } from "@/components/payments/NowPaymentsWaitingPanel";

const MEMBER_PLAN_IDS = new Set(["member_monthly"]);
const HIDDEN_PLAN_IDS = new Set(["prime-trial-3d"]);

const RECURRING_PLANS = new Set(["prime-week-pass-7d", "monthly-pass", "prime-diamond-pass-365d"]);

const RECOMMENDED_PLAN = "prime-diamond-pass-365d";

function formatPrice(amount: number, currency: string): string {
  if (currency === "COP") {
    return new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", minimumFractionDigits: 0 }).format(amount);
  }
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);
}

function PriceDisplay({ amount, className = "" }: { amount: number; className?: string }) {
  const formatted = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);
  const match = formatted.match(/^(\$)(\d+)(\.\d+)?$/);
  if (!match) return <span className={className}>{formatted}</span>;
  const [, symbol, integer, decimal] = match;
  return (
    <span className={`inline-flex items-start leading-none ${className}`}>
      <span className="text-sm font-bold self-start mt-[3px] opacity-80">{symbol}</span>
      <span className="text-2xl font-black tracking-tight">{integer}</span>
      {decimal && <span className="text-sm font-bold self-start mt-[3px] opacity-80">{decimal}</span>}
    </span>
  );
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
  const [submitting, setSubmitting] = useState(false);
  const [meruPanelPlanId, setMeruPanelPlanId] = useState<string | null>(null);
  // Per-plan benefits expand state — plans start collapsed (N-06)
  const [expandedPlans, setExpandedPlans] = useState<Set<string>>(new Set());
  const togglePlanBenefits = (planId: string) => {
    setExpandedPlans((prev) => {
      const next = new Set(prev);
      if (next.has(planId)) next.delete(planId);
      else next.add(planId);
      return next;
    });
  };

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

  // Polling payment ID (legacy fallback)
  const [pollingPaymentId, setPollingPaymentId] = useState<string | null>(null);
  const [paymentSuccess, setPaymentSuccess] = useState(false);

  // Crypto nudge — shown after any payment failure
  const [showCryptoNudge, setShowCryptoNudge] = useState(false);

  function failWithNudge(msg: string) {
    setError(msg);
    setShowCryptoNudge(true);
  }

  // USDC / USDT / BTC stablecoin+crypto state (NOWPayments hook)
  const [usdcAvailable, setUsdcAvailable] = useState<boolean | null>(null);

  // BTCPay BTC+Lightning state
  const [btcAvailable, setBtcAvailable] = useState<boolean | null>(null);
  const [btcOrder, setBtcOrder] = useState<{ invoiceId: string; checkoutUrl: string; planName: string; usdAmount: number } | null>(null);
  const [btcPolling, setBtcPolling] = useState(false);
  const [btcSuccess, setBtcSuccess] = useState(false);
  const btcPopupRef = useRef<Window | null>(null);
  const btcPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // BTCPay Dash state
  const [cryptoPickerPlanId, setCryptoPickerPlanId] = useState<string | null>(null);
  const [dashAvailable, setDashAvailable] = useState<boolean | null>(null);
  const [dashOrder, setDashOrder] = useState<{ invoiceId: string; checkoutUrl: string; planName: string; usdAmount: number } | null>(null);
  const [dashPolling, setDashPolling] = useState(false);
  const [dashSuccess, setDashSuccess] = useState(false);

  // Activation code
  const [activationExpanded, setActivationExpanded] = useState(false);
  const [activationCode, setActivationCode] = useState("");
  const [activationSubmitting, setActivationSubmitting] = useState(false);
  const [activationSuccess, setActivationSuccess] = useState(false);
  const [activationError, setActivationError] = useState<string | null>(null);
  const dashPopupRef = useRef<Window | null>(null);
  const dashPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const {
    order: usdcOrder,
    isPolling: usdcPolling,
    isSuccess: usdcPaymentSuccess,
    isConfirming: usdcConfirming,
    startPayment: startNowPayments,
    cancelOrder: cancelNowPayments,
    error: nowpaymentsError,
    setError: setNowpaymentsError,
  } = useNowPayments({
    storageKey: "pnp_pending_usdc_order",
    returnUrl: "/subscribe",
    onSuccess: async () => {
      await refreshUser();
      setTimeout(() => {
        setPaymentSuccess(true);
        trackEvent("payment_success", { plan: selectedPlan || "unknown", provider: "nowpayments" });
      }, 500);
    },
  });

  useEffect(() => {
    getSubscriptionPlans()
      .then((res) => {
        if (res.success && res.plans.length > 0) {
          setPlans(res.plans);
          const requestedPlanId = searchParams.get("plan");
          const requestedPlan = requestedPlanId
            ? res.plans.find((p) => p.id === requestedPlanId)
            : null;
          if (requestedPlan) {
            setSelectedPlan(requestedPlan.id);
          } else {
            const rec = res.plans.find((p) => p.id === RECOMMENDED_PLAN || p.sku === RECOMMENDED_PLAN);
            setSelectedPlan(rec?.id || res.plans[0].id);
          }
        } else {
          setError(s.noPlansAvailable);
        }
      })
      .catch((err) => setError(err.message || s.failedToLoadPlans))
      .finally(() => setLoading(false));

    getUsdcAvailable()
      .then((res) => setUsdcAvailable(res.available === true && res.configured === true))
      .catch(() => setUsdcAvailable(false));

    getBtcAvailable()
      .then((res) => setBtcAvailable(res.available === true))
      .catch(() => setBtcAvailable(false));

    getDashAvailable()
      .then((res) => setDashAvailable(res.available === true && res.configured === true))
      .catch(() => setDashAvailable(false));

    // Resume BTC polling if user navigated away mid-payment
    try {
      const stored = sessionStorage.getItem("pnp_pending_btc_order");
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed?.invoiceId && Date.now() - (parsed.createdAt || 0) < 3600000) {
          setBtcOrder(parsed);
          setBtcPolling(true);
        } else {
          sessionStorage.removeItem("pnp_pending_btc_order");
        }
      }
    } catch {}

    // Resume Dash polling if user navigated away mid-payment
    try {
      const storedDash = sessionStorage.getItem("pnp_pending_dash_order");
      if (storedDash) {
        const parsed = JSON.parse(storedDash);
        if (parsed?.invoiceId && Date.now() - (parsed.createdAt || 0) < 3600000) {
          setDashOrder(parsed);
          setDashPolling(true);
        } else {
          sessionStorage.removeItem("pnp_pending_dash_order");
        }
      }
    } catch {}

    // Handle ?nowpayments=success&order=<id> from hosted checkout return
    const nowpResult = searchParams.get("nowpayments");
    const nowpOrderId = searchParams.get("order");
    if (nowpResult === "success" && nowpOrderId && /^pnptv-nowp-[A-Za-z0-9_-]+-\d+$/.test(nowpOrderId)) {
      window.history.replaceState({}, "", window.location.pathname);
      // The hook will pick up the pending order from sessionStorage if it exists,
      // but if the user is returning from a redirect, we might need to trigger polling
      // if it wasn't already in storage (though it should be).
    }

    // Resume polling if returning from crypto checkout
    try {
      const pending = sessionStorage.getItem("pnp_pending_payment");
      if (pending) {
        sessionStorage.removeItem("pnp_pending_payment");
        setPollingPaymentId(pending);
      }
    } catch {}

  }, [searchParams]);


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
  const orderPanelRef = useRef<HTMLDivElement>(null);
  const inFlightRef = useRef(false);
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

  // Auto-scroll to inline crypto panel when a new order is created
  useEffect(() => {
    if (usdcOrder?.orderId && orderPanelRef.current) {
      setTimeout(() => {
        orderPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }, 100);
    }
  }, [usdcOrder?.orderId]);

  function clearPromo() {
    setAppliedPromo(null);
    setPromoInput("");
    setPromoError(null);
    const next = new URLSearchParams(searchParams);
    next.delete("promo");
    setSearchParams(next, { replace: true });
  }

  // Poll payment status after hosted checkout opens (legacy fallback flow).
  useEffect(() => {
    if (!pollingPaymentId) return;

    let cancelled = false;
    let attempts = 0;
    const maxAttempts = 120; // 10 minutes at 5s intervals
    const interval = 5000;
    let timerId: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      if (cancelled || attempts >= maxAttempts) {
        if (attempts >= maxAttempts) {
          setPollingPaymentId(null);
          try { sessionStorage.removeItem("pnp_pending_payment"); } catch {}
          failWithNudge(s.paymentTimedOut);
        }
        return;
      }
      attempts++;
      try {
        const data = await getPaymentStatus(pollingPaymentId);
        if (cancelled) return;
        if (data.status === "completed" || data.status === "paid" || data.status === "success") {
          setPollingPaymentId(null);
          try { sessionStorage.removeItem("pnp_pending_payment"); } catch {}
          setPaymentSuccess(true);
          trackEvent("payment_success", { plan: selectedPlan || "unknown", provider: "polling" });
          await refreshUser();
          return;
        }
        if (data.status === "failed" || data.status === "refunded" || data.status === "abandoned") {
          setPollingPaymentId(null);
          try { sessionStorage.removeItem("pnp_pending_payment"); } catch {}
          failWithNudge(data.message || s.paymentNotSuccessful);
          return;
        }
        if (!cancelled) timerId = setTimeout(poll, interval);
      } catch {
        if (!cancelled) timerId = setTimeout(poll, interval);
      }
    };

    poll();
    return () => {
      cancelled = true;
      if (timerId) clearTimeout(timerId);
    };
  }, [pollingPaymentId, refreshUser]);

  async function handleQuickCheckout(planId: string, payCurrency?: string) {
    if (submitting) return;
    setSelectedPlan(planId);
    setError(null);
    setShowCryptoNudge(false);
    setSubmitting(true);
    try {
      const result = await startNowPayments(planId, user?.email || undefined, undefined, false, payCurrency);
      if (!result.success) {
        setError(result.error || s.failedToCreateUsdcInvoice);
      }
    } catch (err: unknown) {
      failWithNudge(err instanceof Error ? err.message : s.paymentErrorGeneric);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCryptoSubscribe(planId: string, payCurrency?: string) {
    if (submitting) return;
    setSelectedPlan(planId);
    setError(null);
    setSubmitting(true);
    try {
      const result = await startNowPayments(planId, user?.email || undefined, undefined, true, payCurrency);
      if (!result.success) {
        setError(result.error || (t.lang === "es" ? "No se pudo crear la suscripción. Intenta de nuevo." : "Failed to create subscription. Please try again."));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : (t.lang === "es" ? "No se pudo crear la suscripción. Intenta de nuevo." : "Failed to create subscription. Please try again."));
    } finally {
      setSubmitting(false);
    }
  }

  const handleBitcoinCheckout = useCallback(async (planId: string) => {
    if (submitting || !btcAvailable || inFlightRef.current) return;
    inFlightRef.current = true;
    setSelectedPlan(planId);
    setError(null);
    try {
      const result = await createBtcSubscription(planId, undefined);
      if (!result.success || !result.checkoutUrl) {
        setError(result.error || "Failed to create Bitcoin invoice.");
        return;
      }
      const order = { invoiceId: result.invoiceId, checkoutUrl: result.checkoutUrl, planName: result.planName || planId, usdAmount: result.usdAmount || 0 };
      setBtcOrder(order);
      setBtcPolling(true);
      setBtcSuccess(false);
      sessionStorage.setItem("pnp_pending_btc_order", JSON.stringify({ ...order, createdAt: Date.now() }));
      const w = window.screen.width, h = window.screen.height;
      const pw = Math.min(560, w), ph = Math.min(780, h);
      btcPopupRef.current = window.open(assertPaymentUrl(result.checkoutUrl), "btcpay_btc", `width=${pw},height=${ph},left=${Math.round((w - pw) / 2)},top=${Math.round((h - ph) / 2)},resizable=yes,scrollbars=yes`);
    } catch (err: any) {
      setError(err.message || "Failed to create Bitcoin invoice.");
    } finally {
      inFlightRef.current = false;
    }
  }, [submitting, btcAvailable]);

  const handleDashCheckout = useCallback(async (planId: string) => {
    if (submitting || !dashAvailable || inFlightRef.current) return;
    inFlightRef.current = true;
    setSelectedPlan(planId);
    setError(null);
    try {
      const result = await createDashSubscription(planId, undefined);
      if (!result.success || !result.checkoutUrl) {
        setError(result.error || "Failed to create Dash invoice.");
        return;
      }
      const order = { invoiceId: result.invoiceId, checkoutUrl: result.checkoutUrl, planName: result.planName || planId, usdAmount: result.usdAmount || 0 };
      setDashOrder(order);
      setDashPolling(true);
      setDashSuccess(false);
      sessionStorage.setItem("pnp_pending_dash_order", JSON.stringify({ ...order, createdAt: Date.now() }));
      const w = window.screen.width, h = window.screen.height;
      const pw = Math.min(560, w), ph = Math.min(780, h);
      dashPopupRef.current = window.open(assertPaymentUrl(result.checkoutUrl), "btcpay_dash", `width=${pw},height=${ph},left=${Math.round((w - pw) / 2)},top=${Math.round((h - ph) / 2)},resizable=yes,scrollbars=yes`);
    } catch (err: any) {
      setError(err.message || "Failed to create Dash invoice.");
    } finally {
      inFlightRef.current = false;
    }
  }, [submitting, dashAvailable]);

  // BTC polling effect
  useEffect(() => {
    if (!btcOrder || !btcPolling || btcSuccess) return;
    let cancelled = false;
    const startedAt = Date.now();
    const maxMs = 60 * 60 * 1000;
    btcPollRef.current = setInterval(async () => {
      if (cancelled || Date.now() - startedAt > maxMs) {
        clearInterval(btcPollRef.current!);
        setBtcPolling(false);
        return;
      }
      try {
        const data = await getBtcSubscriptionStatus(btcOrder.invoiceId);
        if (cancelled) return;
        if (data.completed) {
          clearInterval(btcPollRef.current!);
          setBtcPolling(false);
          setBtcSuccess(true);
          btcPopupRef.current?.close();
          btcPopupRef.current = null;
          sessionStorage.removeItem("pnp_pending_btc_order");
          await refreshUser();
          setTimeout(() => { setPaymentSuccess(true); trackEvent("payment_success", { plan: selectedPlan || "unknown", provider: "btc" }); }, 500);
        } else if (data.failed) {
          clearInterval(btcPollRef.current!);
          setBtcPolling(false);
          sessionStorage.removeItem("pnp_pending_btc_order");
          setError("Bitcoin payment failed or expired. Please try again.");
        }
      } catch {}
    }, 10000);
    return () => {
      cancelled = true;
      if (btcPollRef.current) clearInterval(btcPollRef.current);
    };
  }, [btcOrder, btcPolling, btcSuccess]);

  // Dash polling effect
  useEffect(() => {
    if (!dashOrder || !dashPolling || dashSuccess) return;
    let cancelled = false;
    const startedAt = Date.now();
    const maxMs = 60 * 60 * 1000;
    dashPollRef.current = setInterval(async () => {
      if (cancelled || Date.now() - startedAt > maxMs) {
        clearInterval(dashPollRef.current!);
        setDashPolling(false);
        return;
      }
      try {
        const data = await getDashSubscriptionStatus(dashOrder.invoiceId);
        if (cancelled) return;
        if (data.status === 'completed') {
          clearInterval(dashPollRef.current!);
          setDashPolling(false);
          setDashSuccess(true);
          dashPopupRef.current?.close();
          dashPopupRef.current = null;
          sessionStorage.removeItem("pnp_pending_dash_order");
          await refreshUser();
          setTimeout(() => { setPaymentSuccess(true); trackEvent("payment_success", { plan: selectedPlan || "unknown", provider: "dash" }); }, 500);
        } else if (data.status === 'failed' || data.status === 'expired') {
          clearInterval(dashPollRef.current!);
          setDashPolling(false);
          sessionStorage.removeItem("pnp_pending_dash_order");
          setError("Dash payment failed or expired. Please try again.");
        }
      } catch {}
    }, 10000);
    return () => {
      cancelled = true;
      if (dashPollRef.current) clearInterval(dashPollRef.current);
    };
  }, [dashOrder, dashPolling, dashSuccess]);

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

  const memberPlans = plans.filter((p) => MEMBER_PLAN_IDS.has(p.id) && !HIDDEN_PLAN_IDS.has(p.id));
  const primePlans = plans.filter((p) => !MEMBER_PLAN_IDS.has(p.id) && !HIDDEN_PLAN_IDS.has(p.id));

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
          const displayPrice = formatPrice(plan.price, "USD");
          const planLabel = getPlanLabel(plan, true);
          const hasAddOns = plan.addOns && plan.addOns.length > 0;
          const cryptoDisplayPrice = formatPrice(plan.price, "USD");

          const planDays = plan.duration_days || plan.duration || 30;
          const isBtcPanelActive = !!(btcOrder && selectedPlan === plan.id);
          const isDashPanelActive = !!(dashOrder && selectedPlan === plan.id);
          const isPanelActive = !!(usdcOrder && selectedPlan === plan.id) || isBtcPanelActive || isDashPanelActive;
          const isDimmed = (!!(usdcOrder && !usdcPaymentSuccess) || !!(btcOrder && !btcSuccess) || !!(dashOrder && !dashSuccess)) && selectedPlan !== plan.id;
          return (
            <div key={plan.id} className={`transition-all duration-200 ${isDimmed ? "opacity-50 pointer-events-none" : ""}`}>
            <button
              onClick={() => setSelectedPlan(plan.id)}
              className={`w-full text-left p-4 border-2 transition-all duration-200 ${
                isPanelActive ? "rounded-t-xl rounded-b-none" : "rounded-xl"
              } ${
                isSelected
                  ? `border-[#D4007A] bg-[#D4007A]/10${isPanelActive ? " border-b-transparent" : ""}`
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
                    <span className="text-[10px] font-medium tracking-wide bg-white/5 text-pnp-textSecondary border border-white/10 px-2 py-0.5 rounded-full">
                      {s.launchRate}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    <span className="text-xs text-pnp-textSecondary">{durationLabel(planDays)}</span>
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20">{s.oneTimePayment}</span>
                  </div>
                </div>
                <span className="flex flex-col items-end">
                  <PriceDisplay amount={plan.price} className="text-pnp-textPrimary" />
                </span>
              </div>
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => { e.stopPropagation(); togglePlanBenefits(plan.id); }}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); e.preventDefault(); togglePlanBenefits(plan.id); } }}
                className="inline-flex items-center gap-1 mt-1 text-xs font-semibold text-[#D4007A] hover:text-[#E69138] transition-colors cursor-pointer"
                aria-expanded={expandedPlans.has(plan.id)}
              >
                {expandedPlans.has(plan.id) ? s.hideBenefits : s.showBenefits}
                <svg
                  className={`w-3 h-3 transition-transform ${expandedPlans.has(plan.id) ? "rotate-180" : ""}`}
                  fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </span>
              {expandedPlans.has(plan.id) && (
                <ul className="space-y-1 mt-2">
                  {features.map((f, i) => (
                    <li key={i} className="flex items-center gap-2 text-xs text-pnp-textSecondary">
                      <svg className="w-3 h-3 text-[#D4007A] flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                      {f}
                    </li>
                  ))}
                </ul>
              )}
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

              {/* Quick-pay buttons */}
              <div className="mt-3 pt-3 border-t border-white/5 flex gap-2 flex-wrap" onClick={(e) => e.stopPropagation()}>
                {usdcAvailable !== false && (
                  <button
                    disabled={submitting}
                    onClick={(e) => { e.stopPropagation(); setCryptoPickerPlanId(cryptoPickerPlanId === plan.id ? null : plan.id); }}
                    className={`flex-1 min-w-[80px] flex flex-col items-center justify-center gap-0.5 py-2 rounded-lg border transition-colors disabled:opacity-50 ${cryptoPickerPlanId === plan.id ? "border-green-400/60 bg-green-500/20" : "border-green-500/40 bg-green-500/10 hover:bg-green-500/20"}`}
                  >
                    <span className="flex items-center gap-1 text-xs font-semibold text-green-300">
                      <span>🪙</span>
                      <span>Crypto</span>
                      <span className="text-[9px] text-green-400/70">▾</span>
                    </span>
                    <span className="text-[11px] font-bold text-green-400 leading-none">{cryptoDisplayPrice}</span>
                  </button>
                )}
                {usdcAvailable !== false && (
                  <button
                    disabled={submitting}
                    onClick={(e) => { e.stopPropagation(); handleQuickCheckout(plan.id, "usdtbsc"); }}
                    className="flex-1 min-w-[80px] flex flex-col items-center justify-center gap-0.5 py-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 hover:bg-emerald-500/20 disabled:opacity-50 transition-colors"
                    title="Tether (USDT) on BNB Smart Chain — works with MetaMask, Trust Wallet, Binance"
                  >
                    <span className="flex items-center gap-1 text-xs font-semibold text-emerald-300">
                      <span>₮</span>
                      <span>USDT</span>
                    </span>
                    <span className="text-[11px] font-bold text-emerald-300 leading-none">{cryptoDisplayPrice}</span>
                  </button>
                )}
                {btcAvailable && (
                  <button
                    disabled={submitting}
                    onClick={(e) => { e.stopPropagation(); handleBitcoinCheckout(plan.id); }}
                    className="flex-1 min-w-[80px] flex flex-col items-center justify-center gap-0.5 py-2 rounded-lg border border-orange-500/40 bg-orange-500/10 hover:bg-orange-500/20 disabled:opacity-50 transition-colors"
                  >
                    <span className="flex items-center gap-1 text-xs font-semibold text-orange-300">
                      <span>₿</span>
                      <span>Bitcoin</span>
                    </span>
                    <span className="text-[11px] font-bold text-orange-400 leading-none">{cryptoDisplayPrice}</span>
                  </button>
                )}
                {dashAvailable && (
                  <button
                    disabled={submitting}
                    onClick={(e) => { e.stopPropagation(); handleDashCheckout(plan.id); }}
                    className="flex-1 min-w-[80px] flex flex-col items-center justify-center gap-0.5 py-2 rounded-lg border border-[#008DE4]/40 bg-[#008DE4]/10 hover:bg-[#008DE4]/20 disabled:opacity-50 transition-colors"
                  >
                    <span className="flex items-center gap-1 text-xs font-semibold text-[#4DB8FF]">
                      <span>Ð</span>
                      <span>Dash</span>
                    </span>
                    <span className="text-[11px] font-bold text-[#4DB8FF] leading-none">{cryptoDisplayPrice}</span>
                  </button>
                )}
                <button
                    onClick={(e) => { e.stopPropagation(); setMeruPanelPlanId(meruPanelPlanId === plan.id ? null : plan.id); }}
                    className={`flex-1 min-w-[80px] flex flex-col items-center justify-center gap-0.5 py-2 rounded-lg border transition-colors ${meruPanelPlanId === plan.id ? "border-pink-400/60 bg-pink-500/20" : "border-pink-500/40 bg-pink-500/10 hover:bg-pink-500/20"}`}
                  >
                    <span className="flex items-center gap-1 text-xs font-semibold text-pink-300">
                      <span>💳</span>
                      <span>{t.lang === "es" ? "Tarjeta" : "Card"}</span>
                    </span>
                    <span className="text-[11px] font-bold text-pink-400 leading-none">{displayPrice}</span>
                  </button>
                {cryptoPickerPlanId === plan.id && (
                  <div className="w-full mt-1 p-2 rounded-lg bg-white/5 border border-white/10 animate-in fade-in slide-in-from-top-1 duration-200" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-between mb-1.5 flex-wrap gap-1">
                      <p className="text-[9px] text-pnp-textSecondary/60">{t.lang === "es" ? "Elige tu moneda:" : "Choose your coin:"}</p>
                      <p className="text-[9px] text-emerald-400/80 font-medium">
                        {t.lang === "es" ? "USDT = la opción más fácil para principiantes" : "USDT is the easiest option for first-timers"}
                      </p>
                    </div>
                    <div className="flex gap-1.5 flex-wrap">
                      {NP_COINS.map((coin) => {
                        const isUsdt = coin.code === "usdtbsc" || coin.code === "usdttrc20";
                        return (
                          <button
                            key={coin.code}
                            disabled={submitting}
                            onClick={(e) => {
                              e.stopPropagation();
                              setCryptoPickerPlanId(null);
                              handleQuickCheckout(plan.id, coin.code);
                            }}
                            className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition-colors disabled:opacity-50 ${
                              isUsdt
                                ? "border-emerald-500/40 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300"
                                : "border-white/15 bg-white/5 hover:bg-white/10 text-pnp-textPrimary"
                            }`}
                          >
                            <span style={{ color: coin.color }}>{coin.icon}</span>
                            <span>{coin.label}</span>
                            {isUsdt && <span className="text-[8px] font-bold text-emerald-400/80 leading-none">★</span>}
                          </button>
                        );
                      })}
                      <button
                        onClick={(e) => { e.stopPropagation(); setCryptoPickerPlanId(null); }}
                        className="px-2 py-1.5 rounded-lg border border-white/10 text-[10px] text-pnp-textSecondary/50 hover:text-pnp-textSecondary transition-colors"
                      >✕</button>
                    </div>
                  </div>
                )}
                {meruPanelPlanId === plan.id && (
                  <div className="w-full mt-1 p-3 rounded-xl bg-pink-500/8 border border-pink-500/30 animate-in fade-in slide-in-from-top-1 duration-200" onClick={(e) => e.stopPropagation()}>
                    <p className="text-[11px] font-bold text-pink-300 mb-1">💳 {t.lang === "es" ? "Pago con tarjeta vía Meru" : "Card payment via Meru"}</p>
                    <p className="text-[10px] text-pnp-textSecondary mb-2 leading-relaxed">
                      {t.lang === "es"
                        ? `1. Haz clic en el enlace y paga exactamente ${displayPrice} con tu tarjeta, Nequi o PSE.\n2. Envía tu comprobante de pago a support@pnptv.app — aceptamos: factura, captura del comprobante de pago, o captura del estado de cuenta bancario.\n3. Tu membresía se activa en las próximas 12 horas.`
                        : `1. Click the link and pay exactly ${displayPrice} with your card.\n2. Email your proof of payment to support@pnptv.app — we accept: invoice, payment confirmation screenshot, or bank statement screenshot.\n3. Your membership activates within 12 hours.`}
                    </p>
                    <a
                      href="https://pay.getmeru.com/p/lifetime100-pnptv"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-center gap-2 w-full py-2.5 rounded-lg bg-pink-500 hover:bg-pink-400 text-white text-xs font-bold transition-colors"
                    >
                      <span>💳</span>
                      <span>{t.lang === "es" ? `Pagar ${displayPrice} con tarjeta →` : `Pay ${displayPrice} with card →`}</span>
                    </a>
                    <p className="text-[9px] text-pnp-textSecondary/50 mt-1.5 text-center">
                      {t.lang === "es" ? "No automático · Activación manual en ≤12h" : "Not automatic · Manual activation ≤12h"}
                    </p>
                  </div>
                )}
              </div>
            </button>
            {usdcOrder && selectedPlan === plan.id && (
              <div ref={orderPanelRef}>
                <NowPaymentsWaitingPanel
                  order={usdcOrder!}
                  isSuccess={usdcPaymentSuccess}
                  isConfirming={usdcConfirming}
                  onCancel={cancelNowPayments}
                  lang={t.lang}
                  wrapperClassName="rounded-t-none border-t-0"
                  payCurrency={usdcOrder?.payCurrency}
                />
              </div>
            )}
            {btcOrder && selectedPlan === plan.id && !btcSuccess && (
              <div className="mt-0 rounded-t-none rounded-b-xl border border-t-0 border-orange-500/30 bg-orange-500/5 p-4">
                <p className="text-sm font-semibold text-orange-400 mb-2">
                  {btcPolling ? "Waiting for Bitcoin payment..." : "Bitcoin Invoice"}
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => { btcPopupRef.current = window.open(assertPaymentUrl(btcOrder.checkoutUrl), "btcpay_btc", "width=560,height=780"); }}
                    className="flex-1 text-xs bg-orange-500/20 text-orange-300 rounded-lg py-2 px-3 hover:bg-orange-500/30"
                  >
                    Open BTCPay
                  </button>
                  <button
                    onClick={() => { setBtcOrder(null); setBtcPolling(false); sessionStorage.removeItem("pnp_pending_btc_order"); if (btcPollRef.current) clearInterval(btcPollRef.current); }}
                    className="text-xs text-gray-500 px-2"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
            {btcOrder && selectedPlan === plan.id && btcSuccess && (
              <div className="mt-0 rounded-t-none rounded-b-xl border border-t-0 border-green-500/30 bg-green-500/5 p-4 text-center">
                <p className="text-green-400 font-semibold">Bitcoin payment confirmed!</p>
              </div>
            )}
            {dashOrder && selectedPlan === plan.id && !dashSuccess && (
              <div className="mt-0 rounded-t-none rounded-b-xl border border-t-0 p-4" style={{ borderColor: "rgba(0,141,228,0.3)", background: "rgba(0,141,228,0.05)" }}>
                <p className="text-sm font-semibold mb-2" style={{ color: "#4DB8FF" }}>
                  {dashPolling ? (t.lang === "es" ? "Esperando pago en Dash..." : "Waiting for Dash payment...") : "Dash Invoice"}
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => { dashPopupRef.current = window.open(assertPaymentUrl(dashOrder.checkoutUrl), "btcpay_dash", "width=560,height=780"); }}
                    className="flex-1 text-xs rounded-lg py-2 px-3 transition-colors"
                    style={{ background: "rgba(0,141,228,0.2)", color: "#4DB8FF" }}
                  >
                    Open BTCPay
                  </button>
                  <button
                    onClick={() => { setDashOrder(null); setDashPolling(false); sessionStorage.removeItem("pnp_pending_dash_order"); if (dashPollRef.current) clearInterval(dashPollRef.current); }}
                    className="text-xs text-gray-500 px-2"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
            {dashOrder && selectedPlan === plan.id && dashSuccess && (
              <div className="mt-0 rounded-t-none rounded-b-xl border border-t-0 border-green-500/30 bg-green-500/5 p-4 text-center">
                <p className="text-green-400 font-semibold">Dash payment confirmed!</p>
              </div>
            )}
            </div>
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
          const displayPrice = formatPrice(plan.price, "USD");
          const planLabel = getPlanLabel(plan, false);
          const hasAddOns = plan.addOns && plan.addOns.length > 0;
          const planDays = plan.duration_days || plan.duration || 30;
          const cryptoDisplayPrice = formatPrice(plan.price, "USD");

          const isBtcPanelActive = !!(btcOrder && selectedPlan === plan.id);
          const isDashPanelActive = !!(dashOrder && selectedPlan === plan.id);
          const isPanelActive = !!(usdcOrder && selectedPlan === plan.id) || isBtcPanelActive || isDashPanelActive;
          const isDimmed = (!!(usdcOrder && !usdcPaymentSuccess) || !!(btcOrder && !btcSuccess) || !!(dashOrder && !dashSuccess)) && selectedPlan !== plan.id;
          const primeBtnClass = [
            "w-full text-left p-4 border-2 transition-all duration-200",
            isPanelActive ? "rounded-t-xl rounded-b-none" : "rounded-xl",
            isSelected
              ? "border-[#D4007A] bg-[#D4007A]/10" + (isPanelActive ? " border-b-transparent" : "")
              : "border-white/10 bg-white/5 hover:border-white/20",
            isRecommended ? "ring-1 ring-[#FFB454]/40" : "",
          ].join(" ");
          return (
            <div key={plan.id} className={`transition-all duration-200 ${isDimmed ? "opacity-50 pointer-events-none" : ""}`}>
            <button
              onClick={() => setSelectedPlan(plan.id)}
              className={primeBtnClass}
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
                    <span className="text-[10px] font-medium tracking-wide bg-white/5 text-pnp-textSecondary border border-white/10 px-2 py-0.5 rounded-full">
                      {s.launchRate}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    <span className="text-xs text-pnp-textSecondary">{durationLabel(planDays)}</span>
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20">{s.oneTimePayment}</span>
                  </div>
                </div>
                <div className="text-right">
                  <div className="flex flex-col items-end">
                    <PriceDisplay amount={plan.price} className="text-pnp-textPrimary" />
                  </div>
                  {planDays >= 30 && planDays < 36500 && (
                    <div className="text-[10px] text-pnp-textSecondary">
                      {formatPrice(plan.price / Math.max(1, Math.round(planDays / 30)), "USD")}{s.perMonth}
                    </div>
                  )}
                </div>
              </div>

              <span
                role="button"
                tabIndex={0}
                onClick={(e) => { e.stopPropagation(); togglePlanBenefits(plan.id); }}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); e.preventDefault(); togglePlanBenefits(plan.id); } }}
                className="inline-flex items-center gap-1 mt-1 text-xs font-semibold text-[#D4007A] hover:text-[#E69138] transition-colors cursor-pointer"
                aria-expanded={expandedPlans.has(plan.id)}
              >
                {expandedPlans.has(plan.id) ? s.hideBenefits : s.showBenefits}
                <svg
                  className={`w-3 h-3 transition-transform ${expandedPlans.has(plan.id) ? "rotate-180" : ""}`}
                  fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </span>
              {expandedPlans.has(plan.id) && (
                <>
                  {/* "Everything in Member plus:" header for PRIME plans */}
                  <p className="text-[10px] text-pnp-textSecondary/70 mt-2 mb-1.5">{s.everythingInMemberPlus}</p>

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
                </>
              )}

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

              {/* Quick-pay buttons */}
              <div className="mt-3 pt-3 border-t border-white/5 flex gap-2 flex-wrap" onClick={(e) => e.stopPropagation()}>
                {usdcAvailable !== false && (
                  <button
                    disabled={submitting}
                    onClick={(e) => { e.stopPropagation(); setCryptoPickerPlanId(cryptoPickerPlanId === plan.id ? null : plan.id); }}
                    className={`flex-1 min-w-[80px] flex flex-col items-center justify-center gap-0.5 py-2 rounded-lg border transition-colors disabled:opacity-50 ${cryptoPickerPlanId === plan.id ? "border-green-400/60 bg-green-500/20" : "border-green-500/40 bg-green-500/10 hover:bg-green-500/20"}`}
                  >
                    <span className="flex items-center gap-1 text-xs font-semibold text-green-300">
                      <span>{RECURRING_PLANS.has(plan.id) ? "🔄" : "🪙"}</span>
                      <span>Crypto</span>
                      <span className="text-[9px] text-green-400/70">▾</span>
                    </span>
                    <span className="text-[11px] font-bold text-green-400 leading-none">{cryptoDisplayPrice}</span>
                  </button>
                )}
                {usdcAvailable !== false && (
                  <button
                    disabled={submitting}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (RECURRING_PLANS.has(plan.id)) {
                        handleCryptoSubscribe(plan.id, "usdtbsc");
                      } else {
                        handleQuickCheckout(plan.id, "usdtbsc");
                      }
                    }}
                    className="flex-1 min-w-[80px] flex flex-col items-center justify-center gap-0.5 py-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 hover:bg-emerald-500/20 disabled:opacity-50 transition-colors"
                    title="Tether (USDT) on BNB Smart Chain — works with MetaMask, Trust Wallet, Binance"
                  >
                    <span className="flex items-center gap-1 text-xs font-semibold text-emerald-300">
                      <span>₮</span>
                      <span>USDT</span>
                    </span>
                    <span className="text-[11px] font-bold text-emerald-300 leading-none">{cryptoDisplayPrice}</span>
                  </button>
                )}
                {btcAvailable && (
                  <button
                    disabled={submitting}
                    onClick={(e) => { e.stopPropagation(); handleBitcoinCheckout(plan.id); }}
                    className="flex-1 min-w-[80px] flex flex-col items-center justify-center gap-0.5 py-2 rounded-lg border border-orange-500/40 bg-orange-500/10 hover:bg-orange-500/20 disabled:opacity-50 transition-colors"
                  >
                    <span className="flex items-center gap-1 text-xs font-semibold text-orange-300">
                      <span>₿</span>
                      <span>Bitcoin</span>
                    </span>
                    <span className="text-[11px] font-bold text-orange-400 leading-none">{cryptoDisplayPrice}</span>
                  </button>
                )}
                {dashAvailable && (
                  <button
                    disabled={submitting}
                    onClick={(e) => { e.stopPropagation(); handleDashCheckout(plan.id); }}
                    className="flex-1 min-w-[80px] flex flex-col items-center justify-center gap-0.5 py-2 rounded-lg border border-[#008DE4]/40 bg-[#008DE4]/10 hover:bg-[#008DE4]/20 disabled:opacity-50 transition-colors"
                  >
                    <span className="flex items-center gap-1 text-xs font-semibold text-[#4DB8FF]">
                      <span>Ð</span>
                      <span>Dash</span>
                    </span>
                    <span className="text-[11px] font-bold text-[#4DB8FF] leading-none">{cryptoDisplayPrice}</span>
                  </button>
                )}
                <button
                    onClick={(e) => { e.stopPropagation(); setMeruPanelPlanId(meruPanelPlanId === plan.id ? null : plan.id); }}
                    className={`flex-1 min-w-[80px] flex flex-col items-center justify-center gap-0.5 py-2 rounded-lg border transition-colors ${meruPanelPlanId === plan.id ? "border-pink-400/60 bg-pink-500/20" : "border-pink-500/40 bg-pink-500/10 hover:bg-pink-500/20"}`}
                  >
                    <span className="flex items-center gap-1 text-xs font-semibold text-pink-300">
                      <span>💳</span>
                      <span>{t.lang === "es" ? "Tarjeta" : "Card"}</span>
                    </span>
                    <span className="text-[11px] font-bold text-pink-400 leading-none">{displayPrice}</span>
                  </button>
                {cryptoPickerPlanId === plan.id && (
                  <div className="w-full mt-1 p-2 rounded-lg bg-white/5 border border-white/10 animate-in fade-in slide-in-from-top-1 duration-200" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-between mb-1.5 flex-wrap gap-1">
                      <p className="text-[9px] text-pnp-textSecondary/60">{t.lang === "es" ? "Elige tu moneda:" : "Choose your coin:"}</p>
                      <p className="text-[9px] text-emerald-400/80 font-medium">
                        {t.lang === "es" ? "USDT = la opción más fácil para principiantes" : "USDT is the easiest option for first-timers"}
                      </p>
                    </div>
                    <div className="flex gap-1.5 flex-wrap">
                      {NP_COINS.map((coin) => {
                        const isUsdt = coin.code === "usdtbsc" || coin.code === "usdttrc20";
                        return (
                          <button
                            key={coin.code}
                            disabled={submitting}
                            onClick={(e) => {
                              e.stopPropagation();
                              setCryptoPickerPlanId(null);
                              if (RECURRING_PLANS.has(plan.id)) handleCryptoSubscribe(plan.id, coin.code);
                              else handleQuickCheckout(plan.id, coin.code);
                            }}
                            className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition-colors disabled:opacity-50 ${
                              isUsdt
                                ? "border-emerald-500/40 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300"
                                : "border-white/15 bg-white/5 hover:bg-white/10 text-pnp-textPrimary"
                            }`}
                          >
                            <span style={{ color: coin.color }}>{coin.icon}</span>
                            <span>{coin.label}</span>
                            {isUsdt && <span className="text-[8px] font-bold text-emerald-400/80 leading-none">★</span>}
                          </button>
                        );
                      })}
                      <button
                        onClick={(e) => { e.stopPropagation(); setCryptoPickerPlanId(null); }}
                        className="px-2 py-1.5 rounded-lg border border-white/10 text-[10px] text-pnp-textSecondary/50 hover:text-pnp-textSecondary transition-colors"
                      >✕</button>
                    </div>
                  </div>
                )}
                {meruPanelPlanId === plan.id && (
                  <div className="w-full mt-1 p-3 rounded-xl bg-pink-500/8 border border-pink-500/30 animate-in fade-in slide-in-from-top-1 duration-200" onClick={(e) => e.stopPropagation()}>
                    <p className="text-[11px] font-bold text-pink-300 mb-1">💳 {t.lang === "es" ? "Pago con tarjeta vía Meru" : "Card payment via Meru"}</p>
                    <p className="text-[10px] text-pnp-textSecondary mb-2 leading-relaxed">
                      {t.lang === "es"
                        ? `1. Haz clic en el enlace y paga exactamente ${displayPrice} con tu tarjeta, Nequi o PSE.\n2. Envía tu comprobante de pago a support@pnptv.app — aceptamos: factura, captura del comprobante de pago, o captura del estado de cuenta bancario.\n3. Tu membresía se activa en las próximas 12 horas.`
                        : `1. Click the link and pay exactly ${displayPrice} with your card.\n2. Email your proof of payment to support@pnptv.app — we accept: invoice, payment confirmation screenshot, or bank statement screenshot.\n3. Your membership activates within 12 hours.`}
                    </p>
                    <a
                      href="https://pay.getmeru.com/p/lifetime100-pnptv"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-center gap-2 w-full py-2.5 rounded-lg bg-pink-500 hover:bg-pink-400 text-white text-xs font-bold transition-colors"
                    >
                      <span>💳</span>
                      <span>{t.lang === "es" ? `Pagar ${displayPrice} con tarjeta →` : `Pay ${displayPrice} with card →`}</span>
                    </a>
                    <p className="text-[9px] text-pnp-textSecondary/50 mt-1.5 text-center">
                      {t.lang === "es" ? "No automático · Activación manual en ≤12h" : "Not automatic · Manual activation ≤12h"}
                    </p>
                  </div>
                )}
              </div>
            </button>
            {usdcOrder && selectedPlan === plan.id && (
              <div ref={orderPanelRef}>
                <NowPaymentsWaitingPanel
                  order={usdcOrder!}
                  isSuccess={usdcPaymentSuccess}
                  isConfirming={usdcConfirming}
                  onCancel={cancelNowPayments}
                  lang={t.lang}
                  wrapperClassName="rounded-t-none border-t-0"
                  payCurrency={usdcOrder?.payCurrency}
                />
              </div>
            )}
            {btcOrder && selectedPlan === plan.id && !btcSuccess && (
              <div className="mt-0 rounded-t-none rounded-b-xl border border-t-0 border-orange-500/30 bg-orange-500/5 p-4">
                <p className="text-sm font-semibold text-orange-400 mb-2">
                  {btcPolling ? "Waiting for Bitcoin payment..." : "Bitcoin Invoice"}
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => { btcPopupRef.current = window.open(assertPaymentUrl(btcOrder.checkoutUrl), "btcpay_btc", "width=560,height=780"); }}
                    className="flex-1 text-xs bg-orange-500/20 text-orange-300 rounded-lg py-2 px-3 hover:bg-orange-500/30"
                  >
                    Open BTCPay
                  </button>
                  <button
                    onClick={() => { setBtcOrder(null); setBtcPolling(false); sessionStorage.removeItem("pnp_pending_btc_order"); if (btcPollRef.current) clearInterval(btcPollRef.current); }}
                    className="text-xs text-gray-500 px-2"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
            {btcOrder && selectedPlan === plan.id && btcSuccess && (
              <div className="mt-0 rounded-t-none rounded-b-xl border border-t-0 border-green-500/30 bg-green-500/5 p-4 text-center">
                <p className="text-green-400 font-semibold">Bitcoin payment confirmed!</p>
              </div>
            )}
            {dashOrder && selectedPlan === plan.id && !dashSuccess && (
              <div className="mt-0 rounded-t-none rounded-b-xl border border-t-0 p-4" style={{ borderColor: "rgba(0,141,228,0.3)", background: "rgba(0,141,228,0.05)" }}>
                <p className="text-sm font-semibold mb-2" style={{ color: "#4DB8FF" }}>
                  {dashPolling ? (t.lang === "es" ? "Esperando pago en Dash..." : "Waiting for Dash payment...") : "Dash Invoice"}
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => { dashPopupRef.current = window.open(assertPaymentUrl(dashOrder.checkoutUrl), "btcpay_dash", "width=560,height=780"); }}
                    className="flex-1 text-xs rounded-lg py-2 px-3 transition-colors"
                    style={{ background: "rgba(0,141,228,0.2)", color: "#4DB8FF" }}
                  >
                    Open BTCPay
                  </button>
                  <button
                    onClick={() => { setDashOrder(null); setDashPolling(false); sessionStorage.removeItem("pnp_pending_dash_order"); if (dashPollRef.current) clearInterval(dashPollRef.current); }}
                    className="text-xs text-gray-500 px-2"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
            {dashOrder && selectedPlan === plan.id && dashSuccess && (
              <div className="mt-0 rounded-t-none rounded-b-xl border border-t-0 border-green-500/30 bg-green-500/5 p-4 text-center">
                <p className="text-green-400 font-semibold">Dash payment confirmed!</p>
              </div>
            )}
            </div>
          );
        })}
      </div>

      {/* Crypto guide link */}
      {usdcAvailable !== false && (
        <div className="mb-5 text-center">
          <a href="/crypto-guide" className="text-xs text-pnp-textSecondary hover:text-pnp-textPrimary transition-colors underline decoration-dotted">
            {t.lang === "es" ? "¿No sabes cómo pagar con cripto? Aprende aquí →" : "New to crypto? Learn how to pay →"}
          </a>
        </div>
      )}

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

      {/* Crypto nudge — shown after payment failure */}
      {showCryptoNudge && usdcAvailable && selectedPlan && !usdcOrder && (
        <div className="mb-3 rounded-xl border border-green-500/40 bg-green-500/10 p-4">
          <p className="text-sm font-bold text-green-300 mb-0.5">
            {t.lang === "es" ? "¿Problema con tu tarjeta? Paga con cripto" : "Card not working? Pay with crypto"}
          </p>
          <p className="text-xs text-pnp-textSecondary mb-3">
            {t.lang === "es"
              ? "BTC, ETH, USDT y +100 monedas vía NowPayments."
              : "BTC, ETH, USDT + 100 coins via NowPayments."}
          </p>
          <button
            disabled={submitting}
            onClick={() => handleQuickCheckout(selectedPlan, "usdc")}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-bold text-white disabled:opacity-50 transition-colors"
            style={{ background: "linear-gradient(90deg, #16a34a, #15803d)" }}
          >
            <span>🪙</span>
            {t.lang === "es" ? "Pagar con Cripto" : "Pay with Crypto"}
          </button>
        </div>
      )}

      {/* Error banner */}
      {(error || nowpaymentsError) && (
        <div className="mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-sm text-red-400 text-center whitespace-pre-line">
          {error || nowpaymentsError}
        </div>
      )}

      {/* Activation code */}
      <div className="mt-4">
        <button
          onClick={() => { setActivationExpanded(v => !v); setActivationError(null); }}
          className="w-full text-center text-xs text-pnp-textSecondary/60 hover:text-pnp-textSecondary transition-colors py-1"
        >
          {t.lang === "es" ? "¿Tienes un código de activación?" : "Have an activation code?"}
          <span className="ml-1 inline-block transition-transform" style={{ transform: activationExpanded ? "rotate(180deg)" : "rotate(0deg)" }}>▾</span>
        </button>

        {activationExpanded && (
          <div className="mt-2 p-4 rounded-xl border border-white/10" style={{ background: "rgba(255,255,255,0.04)" }}>
            {activationSuccess ? (
              <div className="text-center">
                <p className="text-sm text-green-400 mb-3">
                  {t.lang === "es"
                    ? "✅ ¡Acceso activado! Recarga para ver tu nuevo plan."
                    : "✅ Access activated! Refresh to see your new plan."}
                </p>
                <button
                  onClick={() => window.location.reload()}
                  className="px-4 py-1.5 rounded-lg text-xs font-semibold text-white transition-colors"
                  style={{ background: "rgba(255,255,255,0.12)" }}
                >
                  {t.lang === "es" ? "Recargar" : "Refresh"}
                </button>
              </div>
            ) : (
              <>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={activationCode}
                    onChange={(e) => {
                      setActivationCode(e.target.value.toUpperCase());
                      setActivationError(null);
                    }}
                    placeholder={t.lang === "es" ? "CÓDIGO-AQUÍ" : "CODE-HERE"}
                    maxLength={50}
                    disabled={activationSubmitting}
                    className="flex-1 px-3 py-2 rounded-lg text-sm bg-white/5 border border-white/10 text-pnp-textPrimary placeholder:text-pnp-textSecondary/40 focus:outline-none focus:border-white/25 disabled:opacity-50 font-mono tracking-wider"
                  />
                  <button
                    disabled={activationSubmitting || !activationCode.trim()}
                    onClick={async () => {
                      setActivationSubmitting(true);
                      setActivationError(null);
                      try {
                        await redeemActivationCode(activationCode.trim());
                        setActivationSuccess(true);
                      } catch (err: any) {
                        const errCode = err?.code || err?.message || "";
                        if (errCode === "already_used") {
                          setActivationError(t.lang === "es" ? "Este código ya fue usado." : "This code has already been used.");
                        } else if (errCode === "expired") {
                          setActivationError(t.lang === "es" ? "Este código ha vencido. Contacta soporte." : "This code has expired. Contact support.");
                        } else if (errCode === "use_lifetime100") {
                          setActivationError(t.lang === "es" ? "Este es un código Lifetime100 — úsalo en la página Lifetime100." : "This is a Lifetime100 code — use the Lifetime100 page to redeem it.");
                        } else if (errCode === "not_found" || errCode === "invalid_format") {
                          setActivationError(t.lang === "es" ? "Código inválido." : "Invalid code.");
                        } else {
                          setActivationError(err?.message || (t.lang === "es" ? "Error al activar. Intenta de nuevo." : "Activation failed. Try again."));
                        }
                      } finally {
                        setActivationSubmitting(false);
                      }
                    }}
                    className="px-4 py-2 rounded-lg text-sm font-bold text-white disabled:opacity-40 transition-colors whitespace-nowrap"
                    style={{ background: "linear-gradient(90deg, #7c3aed, #6d28d9)" }}
                  >
                    {activationSubmitting
                      ? (t.lang === "es" ? "Activando..." : "Activating...")
                      : (t.lang === "es" ? "Canjear" : "Redeem")}
                  </button>
                </div>
                {activationError && (
                  <p className="mt-2 text-xs text-red-400">{activationError}</p>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* Legal footer */}
      <p className="mt-4 text-center text-[11px] text-pnp-textSecondary/50 leading-relaxed">
        {t.lang === "es"
          ? <>Al comprar aceptas nuestros <a href="/terms" className="underline decoration-dotted hover:text-pnp-textSecondary">Términos y Condiciones</a>. Reembolsos disponibles dentro de las 24h de pago — incluyendo cripto. <a href="/contact" className="underline decoration-dotted hover:text-pnp-textSecondary">Contáctanos</a> si tu solicitud cumple los requisitos.</>
          : <>By purchasing you agree to our <a href="/terms" className="underline decoration-dotted hover:text-pnp-textSecondary">Terms & Conditions</a>. Refunds available within 24h of payment — crypto included. <a href="/contact" className="underline decoration-dotted hover:text-pnp-textSecondary">Contact us</a> if your request meets our policy.</>
        }
      </p>

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
