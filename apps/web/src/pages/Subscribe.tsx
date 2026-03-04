import React, { useState, useEffect } from "react";
import { Helmet } from "react-helmet-async";
import { useNavigate } from "react-router-dom";
import { Card, Skeleton } from "@pnptv/ui-kit";
import {
  getSubscriptionPlans,
  createPayment,
  activateMeruCode,
  type SubscriptionPlan,
} from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";

type Provider = "epayco" | "daimo";

const MEMBER_PLAN_IDS = new Set(["member_monthly"]);

const PLAN_FEATURES: Record<string, string[]> = {
  "member_monthly": [
    "Hangout group rooms",
    "Social feed access",
    "Nearby users discovery",
  ],
  "week-trial-pass": [
    "7 days of full PRIME access",
    "Videorama exclusive content",
    "Nearby Premium features",
    "Community hangouts",
  ],
  "monthly-pass": [
    "30 days of full PRIME access",
    "Unlimited Videorama library",
    "Nearby Premium features",
    "Full community hangouts",
    "Priority support",
  ],
  "crystal-pass": [
    "6 months of full PRIME access",
    "Unlimited Videorama + early releases",
    "Nearby Premium features",
    "VIP community status",
    "Priority support",
  ],
  "diamond-pass": [
    "1 year of full PRIME access",
    "Unlimited Videorama + exclusives",
    "Nearby Premium features",
    "VIP badge + priority support",
    "Access to exclusive events",
  ],
  "lifetime-pass": [
    "Lifetime PRIME access — pay once",
    "Everything in Diamond, forever",
    "Founder badge",
    "Priority feature requests",
    "Never pay again",
  ],
};

const MEMBER_EXCLUDED = [
  "No Videorama access",
  "No exclusive video content",
  "No Telegram PRIME channel access",
  "No VIP badge or priority support",
];

const RECOMMENDED_PLAN = "diamond-pass";

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
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedPlan, setSelectedPlan] = useState<string | null>(null);
  const [provider, setProvider] = useState<Provider>("epayco");
  const [submitting, setSubmitting] = useState(false);
  const [showCOP, setShowCOP] = useState(false);

  // Email for credentials
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);

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
          setError("No plans available");
        }
      })
      .catch((err) => setError(err.message || "Failed to load plans"))
      .finally(() => setLoading(false));
  }, []);

  function validateEmail(): boolean {
    const trimmed = email.trim();
    if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed) || trimmed.length > 254) {
      setEmailError("Please enter a valid email address");
      return false;
    }
    setEmailError(null);
    return true;
  }

  async function handleSubscribe() {
    if (!selectedPlan || submitting) return;
    if (!validateEmail()) return;

    setSubmitting(true);
    setError(null);

    try {
      const result = await createPayment(selectedPlan, provider, email.trim());

      if (result.success && result.paymentUrl) {
        window.open(result.paymentUrl, "_blank", "noopener,noreferrer");
      } else {
        setError(result.error || "Failed to create payment");
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Payment error";
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleMeruActivate() {
    if (!meruCode.trim() || meruSubmitting) return;
    if (!validateEmail()) return;

    setMeruSubmitting(true);
    setMeruError(null);

    try {
      const result = await activateMeruCode(meruCode.trim(), email.trim());

      if (result.success) {
        await refreshUser();
        navigate("/welcome");
      } else {
        setMeruError(result.error || "Activation failed");
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Activation error";
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
            Retry
          </button>
        </Card>
      </div>
    );
  }

  return (
    <div className="page-container py-6 px-4 max-w-2xl mx-auto">
      <Helmet>
        <title>Subscribe — PNPtv!</title>
        <meta name="description" content="Choose your PNPtv plan. Unlock exclusive content, PRIME video access, nearby discovery, and more." />
      </Helmet>
      {/* Header */}
      <div className="text-center mb-6">
        <h1 className="text-2xl font-bold text-pnp-textPrimary mb-1">Choose Your Plan</h1>
        <p className="text-sm text-pnp-textSecondary">
          Unlock exclusive content and features with PNPTV PRIME
        </p>
      </div>

      {/* Currency toggle */}
      <div className="flex justify-center mb-4">
        <button
          onClick={() => setShowCOP(!showCOP)}
          className="text-xs text-pnp-textSecondary hover:text-pnp-accent transition-colors"
        >
          Show prices in {showCOP ? "USD" : "COP"}
        </button>
      </div>

      {/* Plan cards */}
      <div className="space-y-3 mb-6">
        {/* Member tier plans */}
        {plans.some((p) => MEMBER_PLAN_IDS.has(p.id)) && (
          <div className="mb-1">
            <div className="text-xs font-semibold uppercase tracking-wider text-pnp-textSecondary">
              Community Member
            </div>
            <p className="text-[10px] text-pnp-textSecondary/70 mt-0.5">
              Social features only — does not include Videorama or exclusive content
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
                  <div className="text-xs text-pnp-textSecondary">Monthly</div>
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
              PRIME
            </div>
            <p className="text-[10px] text-pnp-textSecondary/70 mt-0.5">
              Full access — Videorama, Nearby Premium, hangouts, exclusive content & more
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
                        Best Value
                      </span>
                    )}
                  </div>
                  <span className="text-xs text-pnp-textSecondary">
                    {durationLabel(plan.duration_days || plan.duration || 30)}
                  </span>
                </div>
                <div className="text-right">
                  <span className="text-lg font-bold text-pnp-textPrimary">{displayPrice}</span>
                  {(plan.duration_days || plan.duration || 0) > 0 && (plan.duration_days || plan.duration || 0) < 36500 && (
                    <div className="text-[10px] text-pnp-textSecondary">
                      {showCOP
                        ? formatPrice(plan.priceCOP / Math.max(1, Math.round((plan.duration_days || plan.duration || 30) / 30)), "COP")
                        : formatPrice(plan.priceUSD / Math.max(1, Math.round((plan.duration_days || plan.duration || 30) / 30)), "USD")
                      }/mo
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

      {/* Email address */}
      <div className="mb-6">
        <label htmlFor="subscribe-email" className="text-sm font-medium text-pnp-textPrimary mb-1 block">
          Email address
        </label>
        <p className="text-xs text-pnp-textSecondary mb-2">
          We'll send your login credentials and membership info
        </p>
        <input
          id="subscribe-email"
          type="email"
          value={email}
          onChange={(e) => { setEmail(e.target.value); setEmailError(null); }}
          placeholder="you@example.com"
          className="w-full rounded-xl px-4 py-2.5 bg-white/5 border border-white/10 text-sm text-pnp-textPrimary placeholder-pnp-textSecondary focus:outline-none focus:border-[#D4007A] transition-colors"
        />
        {emailError && (
          <p className="mt-1.5 text-xs text-red-400">{emailError}</p>
        )}
      </div>

      {/* Payment method */}
      <div className="mb-6">
        <h3 className="text-sm font-medium text-pnp-textPrimary mb-3">Payment Method</h3>
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => setProvider("epayco")}
            className={`rounded-xl p-3 border-2 transition-all text-center ${
              provider === "epayco"
                ? "border-[#D4007A] bg-[#D4007A]/10"
                : "border-white/10 bg-white/5 hover:border-white/20"
            }`}
          >
            <div className="text-lg mb-1">💳</div>
            <div className="text-xs font-medium text-pnp-textPrimary">Card / PSE</div>
            <div className="text-[10px] text-pnp-textSecondary">Credit, Debit, Bank</div>
          </button>
          <button
            onClick={() => setProvider("daimo")}
            className={`rounded-xl p-3 border-2 transition-all text-center ${
              provider === "daimo"
                ? "border-[#D4007A] bg-[#D4007A]/10"
                : "border-white/10 bg-white/5 hover:border-white/20"
            }`}
          >
            <div className="text-lg mb-1">🪙</div>
            <div className="text-xs font-medium text-pnp-textPrimary">Crypto / USDC</div>
            <div className="text-[10px] text-pnp-textSecondary">Coinbase, MetaMask, Binance</div>
          </button>
        </div>
      </div>

      {/* Lifetime100 promo + Meru code */}
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-3">
          <div className="flex-1 h-px bg-white/10" />
          <span className="text-xs text-pnp-textSecondary">or</span>
          <div className="flex-1 h-px bg-white/10" />
        </div>

        {/* Lifetime100 promo */}
        <div className="rounded-xl p-4 border border-[#FFB454]/30 bg-[#FFB454]/5 mb-4">
          <p className="text-sm text-pnp-textPrimary font-medium mb-1">
            Want the best deal?
          </p>
          <p className="text-xs text-pnp-textSecondary mb-3">
            Get our Lifetime100 promo — one single payment of $100 for lifetime PRIME access. No subscriptions, no renewals, forever yours.
          </p>
          <a
            href="/lifetime100"
            className="inline-block text-xs font-semibold text-[#FFB454] hover:text-[#ffcc80] transition-colors border-b border-[#FFB454]/50"
          >
            Check out the Lifetime100 deal
          </a>
        </div>

        {/* Meru code */}
        <label className="text-sm font-medium text-pnp-textPrimary mb-2 block">
          Have a Meru code?
        </label>
        <div className="flex gap-2">
          <input
            type="text"
            value={meruCode}
            onChange={(e) => { setMeruCode(e.target.value); setMeruError(null); }}
            placeholder="Enter your Meru code"
            disabled={meruSubmitting}
            className="flex-1 rounded-xl px-4 py-2.5 bg-white/5 border border-white/10 text-sm text-pnp-textPrimary placeholder-pnp-textSecondary focus:outline-none focus:border-[#D4007A] transition-colors disabled:opacity-50"
          />
          <button
            onClick={handleMeruActivate}
            disabled={!meruCode.trim() || meruSubmitting}
            className="btn-gradient px-5 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
          >
            {meruSubmitting ? "Verifying..." : "Activate"}
          </button>
        </div>
        {meruSubmitting && (
          <p className="mt-2 text-xs text-pnp-textSecondary">
            Verifying payment... this may take a few seconds
          </p>
        )}
        {meruError && (
          <p className="mt-2 text-xs text-red-400">{meruError}</p>
        )}
      </div>

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
            Processing...
          </span>
        ) : (
          "Subscribe Now"
        )}
      </button>

      {/* Back link */}
      <button
        onClick={() => navigate(-1)}
        className="w-full mt-3 py-2 text-sm text-pnp-textSecondary hover:text-pnp-textPrimary transition-colors"
      >
        Go Back
      </button>
    </div>
  );
}
