import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Card, Skeleton } from "@pnptv/ui-kit";
import {
  getSubscriptionPlans,
  createPayment,
  type SubscriptionPlan,
} from "@/lib/api";

type Provider = "epayco" | "daimo";

const PLAN_FEATURES: Record<string, string[]> = {
  week_pass: ["7 days of PRIME access", "Exclusive video content", "Cancel anytime"],
  three_months: ["90 days of PRIME access", "Exclusive video content", "Hangout groups", "Save 25%"],
  crystal: ["Premium 90-day plan", "All PRIME features", "Priority support", "Nearby discovery"],
  yearly: ["365 days of PRIME access", "All PRIME features", "Priority support", "Best value"],
  lifetime: ["Lifetime PRIME access", "All features forever", "Priority support", "One-time payment"],
};

const RECOMMENDED_PLAN = "yearly";

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
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedPlan, setSelectedPlan] = useState<string | null>(null);
  const [provider, setProvider] = useState<Provider>("epayco");
  const [submitting, setSubmitting] = useState(false);
  const [showCOP, setShowCOP] = useState(false);

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

  async function handleSubscribe() {
    if (!selectedPlan || submitting) return;

    setSubmitting(true);
    setError(null);

    try {
      const result = await createPayment(selectedPlan, provider);

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
        {plans.map((plan) => {
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
                    {durationLabel(plan.duration_days)}
                  </span>
                </div>
                <div className="text-right">
                  <span className="text-lg font-bold text-pnp-textPrimary">{displayPrice}</span>
                  {plan.duration_days > 0 && plan.duration_days < 36500 && (
                    <div className="text-[10px] text-pnp-textSecondary">
                      {showCOP
                        ? formatPrice(plan.priceCOP / Math.max(1, Math.round(plan.duration_days / 30)), "COP")
                        : formatPrice(plan.priceUSD / Math.max(1, Math.round(plan.duration_days / 30)), "USD")
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
            <div className="text-xs font-medium text-pnp-textPrimary">Crypto / Apps</div>
            <div className="text-[10px] text-pnp-textSecondary">CashApp, Venmo, Zelle</div>
          </button>
        </div>
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
