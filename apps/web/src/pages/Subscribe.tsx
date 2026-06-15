import React, { useState, useEffect, useCallback, useRef } from "react";
import { Helmet } from "react-helmet-async";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Card, Skeleton } from "@pnptv/ui-kit";
import { QRCodeSVG } from "qrcode.react";
import {
  getSubscriptionPlans,
  getPaymentStatus,
  createPayment,
  prepareUsdcSubscription,
  getUsdcAvailable,
  getUsdcSubscriptionStatus,
  getLabelColor,
  validatePromoCode,
  ApiError,
  type SubscriptionPlan,
} from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { useTutorial } from "@/hooks/useTutorial";
import { TutorialOverlay } from "@/components/tutorial/TutorialOverlay";
import { useI18n } from "@/lib/i18n";
import { isTelegramContext } from "@/lib/telegram";

type Provider = "epayco" | "usdc";

const EPAYCO_ERROR_MESSAGES: Record<string, string> = {
  "Error validando datos": "Los datos de tu tarjeta son incorrectos. Verifica el número, fecha y CVV, e intenta con otra tarjeta.\n\nThe card details you entered are incorrect. Please check the number, expiry date and CVV, and try a different card.",
  "Payment was rejected or failed": "Tu banco rechazó el pago. Intenta con otra tarjeta o pídele a tu banco que autorice pagos internacionales.\n\nYour bank declined the payment. Try a different card or contact your bank to authorize international transactions.",
  "BANK_URL_MISSING": "Tu banco no soporta pagos 3D Secure. Prueba con otra tarjeta Visa o Mastercard.\n\nYour bank does not support 3D Secure payments. Please try a different Visa or Mastercard.",
  "Rechazada eControl": "Superaste el límite de tarjetas por documento por hoy. Intenta mañana o usa otra tarjeta.\n\nYou have reached the card limit per ID for today. Try again tomorrow or use a different card.",
  "3DS timeout": "La verificación del banco expiró. Por favor intenta de nuevo y completa la verificación rápidamente.\n\nThe 3D Secure verification timed out. Please try again and complete the bank verification promptly.",
};

function mapEpaycoError(epaycoError?: string | null): string | null {
  if (!epaycoError) return null;
  for (const [key, msg] of Object.entries(EPAYCO_ERROR_MESSAGES)) {
    if (epaycoError.includes(key)) return msg;
  }
  return null;
}

const MEMBER_PLAN_IDS = new Set(["member_monthly"]);

const RECURRING_PLANS = new Set(["prime-week-pass-7d", "monthly-pass", "prime-diamond-pass-365d"]);

const RECOMMENDED_PLAN = "prime-diamond-pass-365d";

function SubscribeUsdcCopyLink({ url, lang }: { url: string; lang: string }) {
  const [copied, setCopied] = React.useState(false);
  const es = lang === "es";
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(url).catch(() => {}); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
      className={`w-full py-2 rounded-lg text-xs font-medium transition-colors border ${copied ? "text-green-400 border-green-500/30 bg-green-500/5" : "text-pnp-textSecondary border-white/10 bg-white/5 hover:text-pnp-textPrimary"}`}
    >
      {copied ? (es ? "¡Link copiado!" : "Link copied!") : (es ? "Copiar link de pago" : "Copy payment link")}
    </button>
  );
}

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

  // Payment polling state
  const [pollingPaymentId, setPollingPaymentId] = useState<string | null>(null);
  const [paymentSuccess, setPaymentSuccess] = useState(false);

  // USDC / USDT stablecoin state (NOWPayments widget)
  const [usdcAvailable, setUsdcAvailable] = useState<boolean | null>(null);
  const [usdcOrder, setUsdcOrder] = useState<{
    orderId: string;
    planName: string;
    usdAmount: number;
    invoiceUrl: string;
    createdAt: number;
    partiallyPaid?: boolean;
  } | null>(null);
  const [usdcPolling, setUsdcPolling] = useState(false);
  const [usdcPaymentSuccess, setUsdcPaymentSuccess] = useState(false);

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

    // Load NOWPayments widget script. Always-rendered .nowpayments-button
    // in the DOM ensures the script binds its click handler on init.
    // Resume USDC polling after page reload or return from hosted checkout
    try {
      const stored = sessionStorage.getItem("pnp_pending_usdc_order");
      if (stored) {
        const parsed = JSON.parse(stored);
        // Only resume if order is < 24h old (NOWPayments invoice TTL)
        if (parsed?.orderId && Date.now() - (parsed.createdAt || 0) < 86400000) {
          setUsdcOrder(parsed);
          setUsdcPolling(true);
        } else {
          sessionStorage.removeItem("pnp_pending_usdc_order");
        }
      }
    } catch {}

    // Handle ?nowpayments=success&order=<id> from hosted checkout return
    const nowpResult = searchParams.get("nowpayments");
    const nowpOrderId = searchParams.get("order");
    if (nowpResult === "success" && nowpOrderId && /^pnptv-nowp-[A-Za-z0-9_-]+-\d+$/.test(nowpOrderId)) {
      window.history.replaceState({}, "", window.location.pathname);
      if (!sessionStorage.getItem("pnp_pending_usdc_order")) {
        setUsdcOrder({ orderId: nowpOrderId, planName: "subscription", usdAmount: 0, invoiceUrl: "", createdAt: Date.now() });
        setUsdcPolling(true);
      }
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
          try { sessionStorage.removeItem("pnp_pending_payment"); } catch {}
          setPaymentSuccess(true);
          await refreshUser();
          return;
        }
        if (data.status === "failed" || data.status === "refunded") {
          setPollingPaymentId(null);
          try { sessionStorage.removeItem("pnp_pending_payment"); } catch {}
          setError(mapEpaycoError(data.epaycoError) || data.message || s.paymentNotSuccessful);
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

  // Poll USDC invoice status (NOWPayments). Cap at 60 minutes — NOWPayments invoices have a 24h TTL
  // but we stop polling after 60 min and show a re-open link. User can still complete payment.
  useEffect(() => {
    if (!usdcOrder || !usdcPolling) return;
    let cancelled = false;
    const maxDurationMs = 60 * 60 * 1000; // 60 min
    const startedAt = Date.now();
    let timerId: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      if (cancelled) return;
      if (Date.now() - startedAt >= maxDurationMs) {
        setUsdcPolling(false);
        return;
      }
      try {
        const data = await getUsdcSubscriptionStatus(usdcOrder.orderId);
        if (cancelled) return;
        if (data.completed) {
          setUsdcPolling(false);
          setUsdcPaymentSuccess(true);
          try { sessionStorage.removeItem("pnp_pending_usdc_order"); } catch {}
          await refreshUser();
          timerId = setTimeout(() => {
            setUsdcOrder(null);
            setUsdcPaymentSuccess(false);
            setPaymentSuccess(true);
          }, 2000);
          return;
        }
        if (data.failed) {
          setUsdcPolling(false);
          try { sessionStorage.removeItem("pnp_pending_usdc_order"); } catch {}
          setError(s.usdcExpired);
          return;
        }
        if (data.partiallyPaid) {
          // Keep polling — NOWPayments keeps partially-paid invoices open for top-up
          // but surface a clear UI signal
          setUsdcOrder((prev) => prev ? { ...prev, partiallyPaid: true } : prev);
          if (!cancelled) timerId = setTimeout(poll, 10000);
          return;
        }
        if (!cancelled) timerId = setTimeout(poll, 5000);
      } catch (pollErr: unknown) {
        const status = (pollErr as { status?: number })?.status ?? (pollErr as { response?: { status?: number } })?.response?.status;
        if (status === 401) {
          setUsdcPolling(false);
          return;
        }
        if (!cancelled) timerId = setTimeout(poll, 5000);
      }
    };
    poll();
    return () => {
      cancelled = true;
      if (timerId) clearTimeout(timerId);
    };
  }, [usdcOrder, usdcPolling, refreshUser]);

  async function handleQuickCheckout(planId: string, chosenProvider: Provider) {
    if (submitting) return;
    setSelectedPlan(planId);
    setProvider(chosenProvider);
    setError(null);
    setSubmitting(true);
    try {
      if (chosenProvider === "epayco") {
        const result = await createPayment(planId, "epayco", undefined, appliedPromo?.code || undefined);
        if (result.success && result.paymentUrl) {
          window.location.href = result.paymentUrl;
        } else {
          setError(result.error || result.message || s.paymentErrorGeneric);
        }
      } else if (chosenProvider === "usdc") {
        const result = await prepareUsdcSubscription(planId, user?.email || undefined);
        if (result.success && result.orderId && result.invoiceUrl) {
          const order = {
            orderId: result.orderId,
            planName: result.planName || "subscription",
            usdAmount: result.usdAmount,
            invoiceUrl: result.invoiceUrl,
            createdAt: Date.now(),
          };
          setUsdcOrder(order);
          setUsdcPolling(true);
          try { sessionStorage.setItem("pnp_pending_usdc_order", JSON.stringify(order)); } catch {}
          if (isTelegramContext()) {
            window.Telegram!.WebApp.openLink(result.invoiceUrl);
          } else {
            window.open(result.invoiceUrl, "_blank", "noopener,noreferrer");
          }
        } else {
          setError(s.failedToCreateUsdcInvoice);
        }
      }
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        if (err.code === "NOWPAYMENTS_NOT_CONFIGURED") setError(s.usdcNotConfigured);
        else if (err.code === "NOWPAYMENTS_UNREACHABLE" || err.code === "NOWPAYMENTS_ERROR") setError(s.failedToCreateUsdcInvoice);
        else setError(err.message || s.paymentErrorGeneric);
      } else {
        setError(err instanceof Error ? err.message : s.paymentErrorGeneric);
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCryptoSubscribe(planId: string) {
    if (submitting) return;
    setSelectedPlan(planId);
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/webapp/payments/usdc/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ planId, email: user?.email || undefined }),
      });
      const data = await res.json();
      if (data.success && data.orderId && data.invoiceUrl) {
        const order = {
          orderId: data.orderId,
          planName: data.planName || planId,
          usdAmount: data.usdAmount,
          invoiceUrl: data.invoiceUrl,
          createdAt: Date.now(),
        };
        setUsdcOrder(order);
        setUsdcPolling(true);
        try { sessionStorage.setItem("pnp_pending_usdc_order", JSON.stringify(order)); } catch {}
        if (isTelegramContext()) {
          window.Telegram!.WebApp.openLink(data.invoiceUrl);
        } else {
          window.open(data.invoiceUrl, "_blank", "noopener,noreferrer");
        }
      } else {
        setError(data.error || (t.lang === "es" ? "No se pudo crear la suscripción. Intenta de nuevo." : "Failed to create subscription. Please try again."));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : (t.lang === "es" ? "No se pudo crear la suscripción. Intenta de nuevo." : "Failed to create subscription. Please try again."));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSubscribe() {
    if (!selectedPlan || submitting) return;

    setSubmitting(true);
    setError(null);

    try {
      if (provider === "epayco") {
        const result = await createPayment(selectedPlan, "epayco", undefined, appliedPromo?.code || undefined);
        if (result.success && result.paymentUrl) {
          window.location.href = result.paymentUrl;
        } else {
          setError(result.error || result.message || s.paymentErrorGeneric);
        }
        return;
      } else if (provider === "usdc") {
        const result = await prepareUsdcSubscription(selectedPlan, user?.email || undefined);
        if (result.success && result.orderId && result.invoiceUrl) {
          const order = {
            orderId: result.orderId,
            planName: result.planName || "subscription",
            usdAmount: result.usdAmount,
            invoiceUrl: result.invoiceUrl,
            createdAt: Date.now(),
          };
          setUsdcOrder(order);
          setUsdcPolling(true);
          try { sessionStorage.setItem("pnp_pending_usdc_order", JSON.stringify(order)); } catch {}
          if (isTelegramContext()) {
            window.Telegram!.WebApp.openLink(result.invoiceUrl);
          } else {
            window.open(result.invoiceUrl, "_blank", "noopener,noreferrer");
          }
        } else {
          setError(s.failedToCreateUsdcInvoice);
        }
      } else {
        setError("Unsupported payment provider. Please select Card (ePayco) or Crypto (NowPayments).");
      }
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        if (err.code === "NOWPAYMENTS_NOT_CONFIGURED") {
          setError(s.usdcNotConfigured);
        } else if (err.code === "NOWPAYMENTS_UNREACHABLE" || err.code === "NOWPAYMENTS_ERROR") {
          setError(s.failedToCreateUsdcInvoice);
        } else {
          setError(err.message || s.paymentErrorGeneric);
        }
      } else {
        const message = err instanceof Error ? err.message : s.paymentErrorGeneric;
        setError(message);
      }
    } finally {
      setSubmitting(false);
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

  const selectedPlanData = plans.find((p) => p.id === selectedPlan);
  const cryptoDiscountPct = selectedPlanData ? 20 : 0;
  const cryptoSavingsUSD = cryptoDiscountPct > 0 && selectedPlanData ? Math.round(selectedPlanData.priceUSD * cryptoDiscountPct / 100 * 100) / 100 : 0;
  const isCrypto = provider === "usdc";

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
          const planDiscountPct = 20;
          const cryptoPriceUSD = Math.round(plan.priceUSD * 0.80 * 100) / 100;
          const cryptoPriceCOP = Math.round(plan.priceCOP * 0.80);
          const cryptoDisplayPrice = showCOP ? formatPrice(cryptoPriceCOP, "COP") : formatPrice(cryptoPriceUSD, "USD");

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
                    <span className="text-[10px] font-medium tracking-wide bg-white/5 text-pnp-textSecondary border border-white/10 px-2 py-0.5 rounded-full">
                      {s.launchRate}
                    </span>
                  </div>
                  <div className="text-xs text-pnp-textSecondary">{s.monthly}</div>
                </div>
                {isCrypto ? (
                  <span className="flex flex-col items-end">
                    {planDiscountPct > 0 && <del className="text-xs text-pnp-textSecondary/50 leading-none">{displayPrice}</del>}
                    <span className="text-lg font-bold text-green-400 leading-tight">{cryptoDisplayPrice}</span>
                    <span className="text-[10px] text-pnp-textSecondary leading-none mt-0.5">{showCOP ? formatPrice(cryptoPriceUSD, "USD") : formatPrice(cryptoPriceCOP, "COP")}</span>
                  </span>
                ) : (
                  <span className="flex flex-col items-end">
                    <span className="text-lg font-bold text-pnp-textPrimary leading-tight">{displayPrice}</span>
                    <span className="text-[10px] text-pnp-textSecondary leading-none mt-0.5">{showCOP ? formatPrice(plan.priceUSD, "USD") : formatPrice(plan.priceCOP, "COP")}</span>
                  </span>
                )}
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
              <div className="mt-3 pt-3 border-t border-white/5 flex gap-2" onClick={(e) => e.stopPropagation()}>
                <button
                  disabled={submitting}
                  onClick={(e) => { e.stopPropagation(); handleQuickCheckout(plan.id, "epayco"); }}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold text-white bg-[#D4007A] hover:bg-[#B8006A] disabled:opacity-50 transition-colors"
                >
                  <span>💳</span> {t.lang === "es" ? "Pagar con Tarjeta" : "Pay with Card"}
                </button>
                {usdcAvailable !== false && (
                  <button
                    disabled={submitting}
                    onClick={(e) => { e.stopPropagation(); handleQuickCheckout(plan.id, "usdc"); }}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold text-green-300 border border-green-500/40 bg-green-500/10 hover:bg-green-500/20 disabled:opacity-50 transition-colors"
                  >
                    <span>🪙</span> {t.lang === "es" ? "Cripto −20%" : "Crypto −20%"}
                  </button>
                )}
              </div>
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
          const planDiscountPct = 20;
          const cryptoPriceUSD = Math.round(plan.priceUSD * 0.80 * 100) / 100;
          const cryptoPriceCOP = Math.round(plan.priceCOP * 0.80);
          const cryptoDisplayPrice = showCOP ? formatPrice(cryptoPriceCOP, "COP") : formatPrice(cryptoPriceUSD, "USD");

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
                    <span className="text-[10px] font-medium tracking-wide bg-white/5 text-pnp-textSecondary border border-white/10 px-2 py-0.5 rounded-full">
                      {s.launchRate}
                    </span>
                  </div>
                  <span className="text-xs text-pnp-textSecondary">
                    {durationLabel(planDays)}
                  </span>
                </div>
                <div className="text-right">
                  {isCrypto ? (
                    <div className="flex flex-col items-end">
                      {planDiscountPct > 0 && <del className="text-xs text-pnp-textSecondary/50 leading-none">{displayPrice}</del>}
                      <span className="text-lg font-bold text-green-400 leading-tight">{cryptoDisplayPrice}</span>
                      <span className="text-[10px] text-pnp-textSecondary leading-none mt-0.5">{showCOP ? formatPrice(cryptoPriceUSD, "USD") : formatPrice(cryptoPriceCOP, "COP")}</span>
                    </div>
                  ) : (
                    <div className="flex flex-col items-end">
                      <span className="text-lg font-bold text-pnp-textPrimary leading-tight">{displayPrice}</span>
                      <span className="text-[10px] text-pnp-textSecondary leading-none mt-0.5">{showCOP ? formatPrice(plan.priceUSD, "USD") : formatPrice(plan.priceCOP, "COP")}</span>
                    </div>
                  )}
                  {planDays >= 30 && planDays < 36500 && (
                    <div className="text-[10px] text-pnp-textSecondary">
                      {formatPrice((isCrypto ? cryptoPriceUSD : plan.priceUSD) / Math.max(1, Math.round(planDays / 30)), "USD")}{s.perMonth}
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
              <div className="mt-3 pt-3 border-t border-white/5 flex gap-2" onClick={(e) => e.stopPropagation()}>
                <button
                  disabled={submitting}
                  onClick={(e) => { e.stopPropagation(); handleQuickCheckout(plan.id, "epayco"); }}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold text-white bg-[#D4007A] hover:bg-[#B8006A] disabled:opacity-50 transition-colors"
                >
                  <span>💳</span> {t.lang === "es" ? "Pagar con Tarjeta" : "Pay with Card"}
                </button>
                {usdcAvailable !== false && (
                  RECURRING_PLANS.has(plan.id) ? (
                    <button
                      disabled={submitting}
                      onClick={(e) => { e.stopPropagation(); handleCryptoSubscribe(plan.id); }}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold text-green-300 border border-green-500/40 bg-green-500/10 hover:bg-green-500/20 disabled:opacity-50 transition-colors"
                    >
                      <span>🔄</span> {t.lang === "es" ? "Cripto (Recurrente)" : "Crypto (Recurring)"}
                    </button>
                  ) : (
                    <button
                      disabled={submitting}
                      onClick={(e) => { e.stopPropagation(); handleQuickCheckout(plan.id, "usdc"); }}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold text-green-300 border border-green-500/40 bg-green-500/10 hover:bg-green-500/20 disabled:opacity-50 transition-colors"
                    >
                      <span>🪙</span> {t.lang === "es" ? "Cripto −20%" : "Crypto −20%"}
                    </button>
                  )
                )}
              </div>
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
            className={`rounded-xl p-3 border-2 transition-all text-center relative ${
              provider === "epayco"
                ? "border-[#D4007A] bg-[#D4007A]/10"
                : "border-white/10 bg-white/5 hover:border-white/20"
            }`}
          >
            <div className="text-lg mb-1">💳</div>
            <div className="text-xs font-medium text-pnp-textPrimary">{s.cardPse}</div>
            <div className="text-[10px] text-pnp-textSecondary">{"Visa & Mastercard · ePayco"}</div>
          </button>
          <button
            onClick={() => usdcAvailable !== false && setProvider("usdc")}
            disabled={usdcAvailable === false}
            className={`rounded-xl p-3 border-2 transition-all text-center relative ${
              usdcAvailable === false
                ? "border-white/5 bg-white/3 opacity-50 cursor-not-allowed"
                : provider === "usdc"
                ? "border-green-500 bg-green-500/10"
                : "border-white/10 bg-white/5 hover:border-white/20"
            }`}
          >
            <div className="text-lg mb-1">🪙</div>
            <div className="text-xs font-medium text-pnp-textPrimary">
              {t.lang === "es" ? "Cripto" : "Crypto"}
            </div>
            <div className="text-[10px] text-pnp-textSecondary">
              {usdcAvailable === false ? s.usdcComingSoon : "BTC · ETH · USDC +100"}
            </div>
            {usdcAvailable !== false && cryptoDiscountPct > 0 && (
              <span className="absolute -top-1.5 -right-1.5 text-[9px] font-bold bg-green-500 text-white px-1.5 py-0.5 rounded-full leading-none">
                Save {cryptoDiscountPct}%
              </span>
            )}
          </button>
        </div>

        {/* Crypto (NowPayments) info panel */}
        {provider === "usdc" && (
          <div className="mt-3 rounded-xl p-3 border border-green-500/30 bg-green-500/5 space-y-2">
            {cryptoSavingsUSD > 0 && (
              <div className="text-xs font-semibold text-green-400 text-center py-1 px-2 rounded-lg bg-green-500/10">
                Save ${cryptoSavingsUSD.toFixed(2)} vs card on this plan
              </div>
            )}
            <p className="text-xs text-pnp-textSecondary">{s.usdcInfoText}</p>
            <div className="flex flex-wrap gap-2 text-[10px]">
              <span className="text-green-400">USDC · USDT · Base · Solana · Polygon · TRON · ETH</span>
            </div>
            <div className="flex flex-wrap gap-2 text-[10px]">
              <a href="https://www.moonpay.com/buy/usdc" target="_blank" rel="noopener noreferrer"
                className="text-green-400 hover:underline font-semibold">MoonPay ↗</a>
              <a href="https://www.coinbase.com/price/usd-coin" target="_blank" rel="noopener noreferrer"
                className="text-green-400 hover:underline font-semibold">Coinbase ↗</a>
              <a href="https://global.transak.com/?defaultCryptoCurrency=USDC" target="_blank" rel="noopener noreferrer"
                className="text-green-400 hover:underline font-semibold">Transak ↗</a>
            </div>
          </div>
        )}

        {/* Crypto guide nudge — shown when crypto method is selected */}
        {provider === "usdc" && (
          <div className="mt-3 text-center">
            <a href="/crypto-guide" className="text-xs text-pnp-textSecondary hover:text-pnp-textPrimary transition-colors underline decoration-dotted">
              {t.lang === "es" ? "¿No sabes cómo pagar con cripto? Aprende aquí →" : "Don't know how to pay with crypto? Learn how →"}
            </a>
          </div>
        )}
      </div>

      {/* USDC waiting panel — checkout opened in new tab */}
      {usdcOrder && !usdcPaymentSuccess && (
        <div className="mb-6 rounded-xl border border-green-500/40 bg-green-500/5 p-4">
          <div className="flex items-center gap-2 mb-3">
            <div className={`w-2 h-2 rounded-full animate-pulse ${usdcOrder.partiallyPaid ? "bg-yellow-400" : "bg-green-500"}`} />
            <span className="text-sm font-medium text-pnp-textPrimary">
              {s.usdcWaitingTitle} — {usdcOrder.planName}
            </span>
          </div>

          {usdcOrder.partiallyPaid && (
            <div className="mb-3 p-2 rounded-lg bg-yellow-500/10 border border-yellow-500/30">
              <p className="text-xs text-yellow-400 font-medium">
                {t.lang === "es" ? "Pago parcial detectado — envía el monto restante a la misma dirección." : "Partial payment detected — please send the remaining amount to the same address."}
              </p>
            </div>
          )}

          {/* Coin chips */}
          <div className="flex flex-wrap gap-1.5 mb-4">
            {["USDC", "BTC", "ETH", "LTC", "SOL", "XRP", "+100"].map((coin) => (
              <span key={coin} className="px-2 py-0.5 rounded-full bg-green-500/10 border border-green-500/30 text-[11px] font-semibold text-green-400">{coin}</span>
            ))}
          </div>

          {usdcOrder.invoiceUrl && (
            <>
              {/* QR code */}
              <div className="flex flex-col items-center gap-2 mb-4">
                <div className="bg-white p-3 rounded-xl">
                  <QRCodeSVG value={usdcOrder.invoiceUrl} size={160} level="M" />
                </div>
                <p className="text-[11px] text-pnp-textSecondary">
                  {t.lang === "es" ? "Escanea con tu wallet o abre el link" : "Scan with your wallet or open the link"}
                </p>
              </div>

              {/* Open checkout button */}
              <a
                href={usdcOrder.invoiceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="block w-full text-center py-3 rounded-xl font-bold text-sm text-white mb-2"
                style={{ background: "linear-gradient(90deg, #26a17b, #00c896)" }}
              >
                {s.usdcOpenCheckout} →
              </a>

              {/* Copy link */}
              <SubscribeUsdcCopyLink url={usdcOrder.invoiceUrl} lang={t.lang} />
            </>
          )}

          <button
            onClick={() => {
              setUsdcOrder(null);
              setUsdcPolling(false);
              setUsdcPaymentSuccess(false);
              try { sessionStorage.removeItem("pnp_pending_usdc_order"); } catch {}
            }}
            className="w-full text-xs text-pnp-textSecondary hover:text-pnp-textPrimary transition-colors py-1 mt-3"
          >
            {s.cancel}
          </button>
        </div>
      )}

      {/* USDC payment confirmed state */}
      {usdcPaymentSuccess && (
        <div className="mb-6 flex flex-col items-center gap-3 py-6">
          <div className="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center">
            <svg className="w-8 h-8 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <p className="text-base font-semibold text-green-400">{s.usdcPaymentConfirmed}</p>
          <p className="text-xs text-pnp-textSecondary">{s.subscriptionNowActive}</p>
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

      {/* Error banner */}
      {error && (
        <div className="mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-sm text-red-400 text-center whitespace-pre-line">
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
