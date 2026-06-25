import React, { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/lib/i18n";
import {
  submitOnboardingStep,
  completeOnboarding,
  type OnboardingStepKey,
} from "@/lib/api";

// ── Types ─────────────────────────────────────────────────────────────────────

type StepId = OnboardingStepKey;

interface StepState {
  isSubmitting: boolean;
  error: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function computeAge(year: number, month: number, day: number): number {
  const today = new Date();
  const birth = new Date(year, month - 1, day);
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return age;
}

function isoDate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// ── Progress Bar ──────────────────────────────────────────────────────────────

function ProgressBar({ current, total }: { current: number; total: number }) {
  const pct = Math.round(((current - 1) / (total - 1)) * 100);
  return (
    <div className="w-full h-1 bg-pnp-surfaceHover rounded-full overflow-hidden">
      <div
        className="h-full rounded-full transition-all duration-500"
        style={{ width: `${pct}%`, background: "linear-gradient(90deg,#D4007A,#E69138)" }}
      />
    </div>
  );
}

// ── Step wrapper ──────────────────────────────────────────────────────────────

interface StepWrapperProps {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}

function StepWrapper({ title, subtitle, children }: StepWrapperProps) {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-xl font-bold text-pnp-textPrimary">{title}</h2>
        {subtitle && (
          <p className="mt-1 text-sm text-pnp-textSecondary leading-relaxed">{subtitle}</p>
        )}
      </div>
      {children}
    </div>
  );
}

// ── Scroll-to-agree card ──────────────────────────────────────────────────────

interface ScrollAgreementCardProps {
  children: React.ReactNode;
  onScrolledToBottom: () => void;
  hasScrolled: boolean;
}

function ScrollAgreementCard({
  children,
  onScrolledToBottom,
  hasScrolled,
}: ScrollAgreementCardProps) {
  const ref = useRef<HTMLDivElement>(null);

  const handleScroll = useCallback(() => {
    const el = ref.current;
    if (!el || hasScrolled) return;
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 20;
    if (atBottom) onScrolledToBottom();
  }, [hasScrolled, onScrolledToBottom]);

  return (
    <div
      ref={ref}
      onScroll={handleScroll}
      className="max-h-72 overflow-y-auto rounded-xl bg-pnp-surface border border-pnp-border p-4 text-sm text-pnp-textSecondary space-y-3"
    >
      {children}
    </div>
  );
}

// ── Step 1: Tiers ─────────────────────────────────────────────────────────────

function StepTiers({
  onNext,
  state,
}: {
  onNext: () => void;
  state: StepState;
}) {
  const t = useI18n();
  const o = t.onboarding;
  const j = t.join;

  const tiers = [
    {
      name: j.freePlanName,
      price: j.freePlanPrice,
      period: j.freePlanPeriod,
      features: j.freePlanFeatures as readonly string[],
      accent: "rgba(255,255,255,0.15)",
    },
    {
      name: j.memberPlanName,
      price: j.memberPlanPrice,
      period: j.memberPlanPriceSuffix,
      features: j.memberPlanFeatures as readonly string[],
      accent: "rgba(212,0,122,0.25)",
    },
    {
      name: j.primePlanName,
      price: j.primePlanPrice,
      period: j.primePlanPriceSuffix,
      features: j.primePlanFeatures as readonly string[],
      accent: "rgba(230,145,56,0.25)",
      badge: j.primePlanBestValue,
    },
  ] as const;

  return (
    <StepWrapper title={o.tiersTitle} subtitle={o.tiersBody}>
      <div className="grid gap-3 sm:grid-cols-3">
        {tiers.map((tier) => (
          <div
            key={tier.name}
            className="relative rounded-xl border border-pnp-border p-4 flex flex-col gap-2"
            style={{ background: tier.accent }}
          >
            {("badge" in tier) && tier.badge && (
              <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 text-[10px] font-bold px-2 py-0.5 rounded-full text-white"
                    style={{ background: "linear-gradient(90deg,#D4007A,#E69138)" }}>
                {tier.badge}
              </span>
            )}
            <div className="flex items-baseline gap-1">
              <span className="text-lg font-bold text-pnp-textPrimary">{tier.price}</span>
              <span className="text-xs text-pnp-textSecondary">{tier.period}</span>
            </div>
            <p className="text-sm font-semibold text-pnp-textPrimary">{tier.name}</p>
            <ul className="space-y-1 mt-1">
              {(tier.features as readonly string[]).map((f) => (
                <li key={f} className="flex items-start gap-2 text-xs text-pnp-textSecondary">
                  <span className="mt-0.5 text-pnp-accent flex-shrink-0" aria-hidden="true">
                    <svg className="w-3 h-3" viewBox="0 0 12 12" fill="none">
                      <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </span>
                  <span className="min-w-0">{f}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={onNext}
        disabled={state.isSubmitting}
        className="w-full min-h-[44px] rounded-xl font-semibold text-white transition-all duration-150 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent focus-visible:ring-offset-2 focus-visible:ring-offset-pnp-background"
        style={{ background: "linear-gradient(135deg,#D4007A,#E69138)" }}
      >
        {state.isSubmitting ? "…" : o.continueBtn}
      </button>
    </StepWrapper>
  );
}

// ── Step 2: Age ───────────────────────────────────────────────────────────────

const MONTHS = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];

function StepAge({
  onNext,
  state,
}: {
  onNext: (dob: string) => Promise<void>;
  state: StepState;
}) {
  const o = useI18n().onboarding;
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState("");
  const [month, setMonth] = useState("");
  const [day, setDay] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [clientError, setClientError] = useState<string | null>(null);

  const years = Array.from({ length: 100 }, (_, i) => currentYear - 18 - i);
  const daysInMonth = year && month
    ? new Date(Number(year), Number(month), 0).getDate()
    : 31;
  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);

  const canSubmit = !!year && !!month && !!day && confirmed && !state.isSubmitting;

  const handleSubmit = async () => {
    setClientError(null);
    if (!year || !month || !day) {
      setClientError(o.ageErrorInvalidDate);
      return;
    }
    const age = computeAge(Number(year), Number(month), Number(day));
    if (age < 18) {
      setClientError(o.ageErrorUnderage);
      return;
    }
    await onNext(isoDate(Number(year), Number(month), Number(day)));
  };

  const displayError = clientError || state.error;

  return (
    <StepWrapper title={o.ageTitle} subtitle={o.ageSubtitle}>
      <div className="grid grid-cols-3 gap-2">
        {[
          {
            id: "dob-month",
            label: o.ageSelectMonth,
            value: month,
            onChange: (v: string) => { setMonth(v); setClientError(null); },
            options: MONTHS.map((m, i) => ({ value: String(i + 1), label: m })),
          },
          {
            id: "dob-day",
            label: o.ageSelectDay,
            value: day,
            onChange: (v: string) => { setDay(v); setClientError(null); },
            options: days.map((d) => ({ value: String(d), label: String(d) })),
          },
          {
            id: "dob-year",
            label: o.ageSelectYear,
            value: year,
            onChange: (v: string) => { setYear(v); setClientError(null); },
            options: years.map((y) => ({ value: String(y), label: String(y) })),
          },
        ].map((sel) => (
          <div key={sel.id} className="flex flex-col gap-1">
            <label htmlFor={sel.id} className="text-xs text-pnp-textSecondary">
              {sel.label}
            </label>
            <select
              id={sel.id}
              value={sel.value}
              onChange={(e) => sel.onChange(e.target.value)}
              className="min-h-[44px] w-full rounded-xl border border-pnp-border bg-pnp-surface text-pnp-textPrimary text-sm px-3 focus:outline-none focus:ring-2 focus:ring-pnp-accent"
              aria-label={sel.label}
            >
              <option value="">{sel.label}</option>
              {sel.options.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
        ))}
      </div>

      <label className="flex items-start gap-3 p-3 rounded-xl bg-pnp-surface border border-pnp-border cursor-pointer hover:border-pnp-accent/50 transition-colors">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
          className="mt-0.5 w-5 h-5 rounded border-pnp-border accent-pnp-accent focus:ring-pnp-accent"
          aria-label={o.ageCheckLabel}
        />
        <span className="text-sm text-pnp-textPrimary leading-relaxed">{o.ageCheckLabel}</span>
      </label>

      {displayError && (
        <p role="alert" className="text-sm text-pnp-error">{displayError}</p>
      )}

      <button
        type="button"
        onClick={handleSubmit}
        disabled={!canSubmit}
        className="w-full min-h-[44px] rounded-xl font-semibold text-white transition-all duration-150 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent focus-visible:ring-offset-2 focus-visible:ring-offset-pnp-background"
        style={{ background: "linear-gradient(135deg,#D4007A,#E69138)" }}
      >
        {state.isSubmitting ? "…" : o.continueBtn}
      </button>
    </StepWrapper>
  );
}

// ── Step 3: Terms ─────────────────────────────────────────────────────────────

function StepTerms({
  onNext,
  state,
}: {
  onNext: () => Promise<void>;
  state: StepState;
}) {
  const o = useI18n().onboarding;
  const [scrolled, setScrolled] = useState(false);

  return (
    <StepWrapper title={o.termsTitle} subtitle={o.termsSubtitle}>
      {!scrolled && (
        <p className="text-xs text-pnp-textSecondary italic">{o.termsScrollHint}</p>
      )}
      <ScrollAgreementCard onScrolledToBottom={() => setScrolled(true)} hasScrolled={scrolled}>
        <p className="font-semibold text-pnp-textPrimary">{o.termsExcerptHeading}</p>
        <p>{o.termsP1}</p>
        <p>{o.termsP2}</p>
        <p>{o.termsP3}</p>
        <p>{o.termsP4}</p>
        <p>
          <a
            href="/terms"
            target="_blank"
            rel="noopener noreferrer"
            className="text-pnp-accent hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-pnp-accent rounded"
          >
            {o.termsFullLink} &#8599;
          </a>
        </p>
      </ScrollAgreementCard>

      {state.error && (
        <p role="alert" className="text-sm text-pnp-error">{state.error}</p>
      )}

      <button
        type="button"
        onClick={onNext}
        disabled={!scrolled || state.isSubmitting}
        className="w-full min-h-[44px] rounded-xl font-semibold text-white transition-all duration-150 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent focus-visible:ring-offset-2 focus-visible:ring-offset-pnp-background"
        style={{ background: "linear-gradient(135deg,#D4007A,#E69138)" }}
      >
        {state.isSubmitting ? "…" : o.agreeBtn}
      </button>
    </StepWrapper>
  );
}

// ── Step 4: Privacy ───────────────────────────────────────────────────────────

function StepPrivacy({
  onNext,
  state,
}: {
  onNext: () => Promise<void>;
  state: StepState;
}) {
  const o = useI18n().onboarding;
  const [scrolled, setScrolled] = useState(false);

  return (
    <StepWrapper title={o.privacyTitle} subtitle={o.privacySubtitle}>
      {!scrolled && (
        <p className="text-xs text-pnp-textSecondary italic">{o.termsScrollHint}</p>
      )}
      <ScrollAgreementCard onScrolledToBottom={() => setScrolled(true)} hasScrolled={scrolled}>
        <p className="font-semibold text-pnp-textPrimary">{o.privacyExcerptHeading}</p>
        <p>{o.privacyP1}</p>
        <p>{o.privacyP2}</p>
        <p>{o.privacyP3}</p>
        <p>{o.privacyP4}</p>
        <p>
          <a
            href="/privacy"
            target="_blank"
            rel="noopener noreferrer"
            className="text-pnp-accent hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-pnp-accent rounded"
          >
            {o.privacyFullLink} &#8599;
          </a>
        </p>
      </ScrollAgreementCard>

      {state.error && (
        <p role="alert" className="text-sm text-pnp-error">{state.error}</p>
      )}

      <button
        type="button"
        onClick={onNext}
        disabled={!scrolled || state.isSubmitting}
        className="w-full min-h-[44px] rounded-xl font-semibold text-white transition-all duration-150 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent focus-visible:ring-offset-2 focus-visible:ring-offset-pnp-background"
        style={{ background: "linear-gradient(135deg,#D4007A,#E69138)" }}
      >
        {state.isSubmitting ? "…" : o.agreeBtn}
      </button>
    </StepWrapper>
  );
}

// ── Step 5: Rules ─────────────────────────────────────────────────────────────

function StepRules({
  onNext,
  state,
}: {
  onNext: () => Promise<void>;
  state: StepState;
}) {
  const o = useI18n().onboarding;
  const [accepted, setAccepted] = useState(false);

  return (
    <StepWrapper title={o.rulesTitle} subtitle={o.rulesSubtitle}>
      <div className="rounded-xl bg-pnp-surface border border-pnp-border p-4">
        <ul className="space-y-3">
          {(o.rulesItems as readonly string[]).map((rule, i) => (
            <li key={i} className="flex items-start gap-3 text-sm text-pnp-textSecondary">
              <span
                className="mt-0.5 flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold text-pnp-accent border border-pnp-accent/40"
                aria-hidden="true"
              >
                {i + 1}
              </span>
              <span className="min-w-0">{rule}</span>
            </li>
          ))}
        </ul>
      </div>

      <label className="flex items-start gap-3 p-3 rounded-xl bg-pnp-surface border border-pnp-border cursor-pointer hover:border-pnp-accent/50 transition-colors">
        <input
          type="checkbox"
          checked={accepted}
          onChange={(e) => setAccepted(e.target.checked)}
          className="mt-0.5 w-5 h-5 rounded border-pnp-border accent-pnp-accent focus:ring-pnp-accent"
          aria-label={o.rulesCheckLabel}
        />
        <span className="text-sm text-pnp-textPrimary leading-relaxed">{o.rulesCheckLabel}</span>
      </label>

      {state.error && (
        <p role="alert" className="text-sm text-pnp-error">{state.error}</p>
      )}

      <button
        type="button"
        onClick={onNext}
        disabled={!accepted || state.isSubmitting}
        className="w-full min-h-[44px] rounded-xl font-semibold text-white transition-all duration-150 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent focus-visible:ring-offset-2 focus-visible:ring-offset-pnp-background"
        style={{ background: "linear-gradient(135deg,#D4007A,#E69138)" }}
      >
        {state.isSubmitting ? "…" : o.continueBtn}
      </button>
    </StepWrapper>
  );
}

// ── Step 6: Values ────────────────────────────────────────────────────────────

function StepValues({
  onNext,
  state,
}: {
  onNext: () => Promise<void>;
  state: StepState;
}) {
  const o = useI18n().onboarding;

  return (
    <StepWrapper title={o.valuesTitle} subtitle={o.valuesSubtitle}>
      <div className="rounded-xl bg-pnp-surface border border-pnp-border p-4">
        <ul className="space-y-3">
          {(o.valuesItems as readonly string[]).map((value, i) => (
            <li key={i} className="flex items-start gap-3 text-sm text-pnp-textSecondary">
              <span
                className="mt-0.5 flex-shrink-0 w-2 h-2 rounded-full mt-1.5"
                style={{ background: "linear-gradient(135deg,#D4007A,#E69138)" }}
                aria-hidden="true"
              />
              <span className="min-w-0">{value}</span>
            </li>
          ))}
        </ul>
      </div>

      {state.error && (
        <p role="alert" className="text-sm text-pnp-error">{state.error}</p>
      )}

      <button
        type="button"
        onClick={onNext}
        disabled={state.isSubmitting}
        className="w-full min-h-[44px] rounded-xl font-semibold text-white transition-all duration-150 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent focus-visible:ring-offset-2 focus-visible:ring-offset-pnp-background"
        style={{ background: "linear-gradient(135deg,#D4007A,#E69138)" }}
      >
        {state.isSubmitting ? "…" : o.continueBtn}
      </button>
    </StepWrapper>
  );
}

// ── Step 7: Crypto ────────────────────────────────────────────────────────────

function StepCrypto({
  onFinish,
  state,
}: {
  onFinish: () => Promise<void>;
  state: StepState;
}) {
  const o = useI18n().onboarding;

  const wallets = [
    {
      emoji: "⚡",
      title: o.cryptoDashTitle,
      desc: o.cryptoDashDesc,
      homepage: o.cryptoDashHomepage,
      appStore: o.cryptoDashAppStore,
      playStore: o.cryptoDashPlayStore,
    },
    {
      emoji: "🛡️",
      title: o.cryptoTrustTitle,
      desc: o.cryptoTrustDesc,
      homepage: o.cryptoTrustHomepage,
      appStore: o.cryptoTrustAppStore,
      playStore: o.cryptoTrustPlayStore,
    },
  ] as const;

  return (
    <StepWrapper title={o.cryptoTitle} subtitle={o.cryptoSubtitle}>
      <div className="space-y-3 text-sm text-pnp-textSecondary">
        <p>{o.cryptoP1}</p>
        <p>{o.cryptoP2}</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {wallets.map((wallet) => (
          <div
            key={wallet.title}
            className="rounded-xl bg-pnp-surface border border-pnp-border p-4 flex flex-col gap-2"
          >
            <div className="flex items-center gap-2">
              <span className="text-2xl" aria-hidden="true">{wallet.emoji}</span>
              <div>
                <p className="font-semibold text-pnp-textPrimary text-sm">{wallet.title}</p>
                <p className="text-xs text-pnp-textSecondary">{wallet.desc}</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 mt-1">
              <a
                href={wallet.homepage}
                target="_blank"
                rel="noopener noreferrer"
                className="min-h-[36px] px-3 flex items-center rounded-lg text-xs font-medium text-pnp-textPrimary border border-pnp-border hover:border-pnp-accent/50 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-pnp-accent"
              >
                Website
              </a>
              <a
                href={wallet.appStore}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`${wallet.title} on App Store`}
                className="min-h-[36px] px-3 flex items-center rounded-lg text-xs font-medium text-pnp-textPrimary border border-pnp-border hover:border-pnp-accent/50 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-pnp-accent"
              >
                App Store
              </a>
              <a
                href={wallet.playStore}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`${wallet.title} on Google Play`}
                className="min-h-[36px] px-3 flex items-center rounded-lg text-xs font-medium text-pnp-textPrimary border border-pnp-border hover:border-pnp-accent/50 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-pnp-accent"
              >
                Google Play
              </a>
            </div>
          </div>
        ))}
      </div>

      <p className="text-xs text-pnp-textSecondary">
        {o.cryptoGuideLink.split(o.cryptoGuideLinkLabel)[0]}
        <a
          href="/crypto-guide"
          className="text-pnp-accent hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-pnp-accent rounded"
        >
          {o.cryptoGuideLinkLabel}
        </a>
        {o.cryptoGuideLink.split(o.cryptoGuideLinkLabel)[1] ?? ""}
      </p>

      {state.error && (
        <p role="alert" className="text-sm text-pnp-error">{state.error}</p>
      )}

      <button
        type="button"
        onClick={onFinish}
        disabled={state.isSubmitting}
        className="w-full min-h-[44px] rounded-xl font-semibold text-white transition-all duration-150 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent focus-visible:ring-offset-2 focus-visible:ring-offset-pnp-background"
        style={{ background: "linear-gradient(135deg,#D4007A,#E69138)" }}
      >
        {state.isSubmitting ? o.cryptoFinishLoading : o.cryptoFinishBtn}
      </button>
    </StepWrapper>
  );
}

// ── Ordered step list ─────────────────────────────────────────────────────────

const STEPS: StepId[] = ["tiers", "age", "terms", "privacy", "rules", "values", "crypto"];

// ── Main Wizard ───────────────────────────────────────────────────────────────

export default function Onboarding() {
  const navigate = useNavigate();
  const { isAuthenticated, isLoading, refreshUser } = useAuth();
  const o = useI18n().onboarding;

  const [stepIndex, setStepIndex] = useState(0);
  const [stepState, setStepState] = useState<StepState>({ isSubmitting: false, error: null });

  const totalSteps = STEPS.length;
  const currentStep = STEPS[stepIndex];
  const currentStepNumber = stepIndex + 1;

  // Redirect if not authenticated (after auth resolves)
  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      navigate("/login", { replace: true });
    }
  }, [isLoading, isAuthenticated, navigate]);

  const setError = (err: string | null) => setStepState((s) => ({ ...s, error: err }));
  const setSubmitting = (v: boolean) => setStepState((s) => ({ ...s, isSubmitting: v }));

  const submit = useCallback(
    async (step: StepId, payload: Record<string, unknown> = {}) => {
      setSubmitting(true);
      setError(null);
      try {
        const result = await submitOnboardingStep(step, payload);
        if ("error" in result && result.error) {
          if (result.error === "must_be_18") {
            setError(o.ageErrorUnderage);
          } else {
            setError(result.error);
          }
          return false;
        }
        return true;
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : o.ageErrorServer);
        return false;
      } finally {
        setSubmitting(false);
      }
    },
    [o],
  );

  const goNext = useCallback(() => {
    setStepState({ isSubmitting: false, error: null });
    setStepIndex((i) => Math.min(i + 1, totalSteps - 1));
  }, [totalSteps]);

  const goBack = useCallback(() => {
    setStepState({ isSubmitting: false, error: null });
    setStepIndex((i) => Math.max(i - 1, 0));
  }, []);

  // Step handlers
  const handleTiers = useCallback(async () => {
    const ok = await submit("tiers");
    if (ok) goNext();
  }, [submit, goNext]);

  const handleAge = useCallback(
    async (dob: string) => {
      const ok = await submit("age", { dob });
      if (ok) goNext();
    },
    [submit, goNext],
  );

  const handleTerms = useCallback(async () => {
    const ok = await submit("terms");
    if (ok) goNext();
  }, [submit, goNext]);

  const handlePrivacy = useCallback(async () => {
    const ok = await submit("privacy");
    if (ok) goNext();
  }, [submit, goNext]);

  const handleRules = useCallback(async () => {
    const ok = await submit("rules");
    if (ok) goNext();
  }, [submit, goNext]);

  const handleValues = useCallback(async () => {
    const ok = await submit("values");
    if (ok) goNext();
  }, [submit, goNext]);

  const handleCrypto = useCallback(async () => {
    const ok = await submit("crypto");
    if (!ok) return;
    setSubmitting(true);
    setError(null);
    try {
      await completeOnboarding();
      await refreshUser().catch(() => {});
      navigate("/", { replace: true });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not complete setup. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }, [submit, navigate, refreshUser]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-dvh bg-pnp-background">
        <div className="w-8 h-8 rounded-full border-2 border-white/20 border-t-white animate-spin" aria-label="Loading" />
      </div>
    );
  }

  if (!isAuthenticated) return null;

  const stepLabel = o.stepOf
    .replace("{current}", String(currentStepNumber))
    .replace("{total}", String(totalSteps));

  return (
    <div className="min-h-dvh bg-pnp-background flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-pnp-background/90 backdrop-blur-sm border-b border-pnp-border px-4 py-3">
        <div className="max-w-lg mx-auto flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span
              className="text-base font-bold text-pnp-textPrimary tracking-tight"
              style={{ background: "linear-gradient(90deg,#D4007A,#E69138)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}
            >
              PNPtv!
            </span>
            <span className="text-xs text-pnp-textSecondary tabular-nums">{stepLabel}</span>
          </div>
          <ProgressBar current={currentStepNumber} total={totalSteps} />
        </div>
      </header>

      {/* Body */}
      <main className="flex-1 flex flex-col">
        <div className="max-w-lg mx-auto w-full px-4 py-6 flex-1 flex flex-col">
          {/* Back button */}
          {stepIndex > 0 && (
            <button
              type="button"
              onClick={goBack}
              disabled={stepState.isSubmitting}
              aria-label={o.backBtn}
              className="self-start mb-4 flex items-center gap-1 text-sm text-pnp-textSecondary hover:text-pnp-textPrimary transition-colors min-h-[44px] px-1 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-pnp-accent rounded disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {o.backBtn}
            </button>
          )}

          {/* Step content */}
          <div className="animate-fade-in-up flex-1">
            {currentStep === "tiers" && (
              <StepTiers onNext={handleTiers} state={stepState} />
            )}
            {currentStep === "age" && (
              <StepAge onNext={handleAge} state={stepState} />
            )}
            {currentStep === "terms" && (
              <StepTerms onNext={handleTerms} state={stepState} />
            )}
            {currentStep === "privacy" && (
              <StepPrivacy onNext={handlePrivacy} state={stepState} />
            )}
            {currentStep === "rules" && (
              <StepRules onNext={handleRules} state={stepState} />
            )}
            {currentStep === "values" && (
              <StepValues onNext={handleValues} state={stepState} />
            )}
            {currentStep === "crypto" && (
              <StepCrypto onFinish={handleCrypto} state={stepState} />
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
