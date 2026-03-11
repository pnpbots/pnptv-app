import React, { useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { acceptTerms, verifyAgeSelf } from "@/lib/api";
import { Button, Card } from "@pnptv/ui-kit";
import { useI18n } from "@/lib/i18n";

interface VerificationGateProps {
  children: React.ReactNode;
}

export function VerificationGate({ children }: VerificationGateProps) {
  const { user, isAuthenticated, isLoading, refreshUser } = useAuth();
  const t = useI18n();
  const v = t.gates.verification;
  const [step, setStep] = useState<"age" | "terms" | "guidelines">("age");
  const [ageChecked, setAgeChecked] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Still loading: show spinner (don't leak children)
  if (isLoading) {
    return <div className="flex items-center justify-center min-h-screen"><div className="animate-spin w-8 h-8 border-2 border-white/20 border-t-white rounded-full" /></div>;
  }

  // Not authenticated: redirect to login — never expose gated content
  if (!isAuthenticated || !user) {
    return <Navigate to="/login" replace />;
  }

  // Both verified: show content
  if (user.ageVerified && user.termsAccepted) {
    return <>{children}</>;
  }

  // Determine which step to show
  const needsAge = !user.ageVerified;
  const needsTerms = !user.termsAccepted;

  let currentStep: "age" | "terms" | "guidelines";
  if (needsAge && step === "age") {
    currentStep = "age";
  } else if (step === "guidelines") {
    currentStep = "guidelines";
  } else {
    currentStep = "terms";
  }

  const totalSteps = needsAge ? 3 : 2;
  const currentStepNumber = currentStep === "age" ? 1 : currentStep === "terms" ? (needsAge ? 2 : 1) : (needsAge ? 3 : 2);

  const handleAgeConfirm = async () => {
    if (!ageChecked) return;
    setSubmitting(true);
    setError(null);
    try {
      await verifyAgeSelf();
      await refreshUser();
      if (needsTerms) {
        setStep("terms");
      }
    } catch (err: any) {
      setError(err.message || v.failedToVerify);
    } finally {
      setSubmitting(false);
    }
  };

  const handleTermsAccept = () => {
    setStep("guidelines");
  };

  const handleGuidelinesAccept = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await acceptTerms();
      await refreshUser();
    } catch (err: any) {
      setError(err.message || v.failedToAcceptTerms);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="page-container flex items-center justify-center min-h-[60vh]">
      <Card className="max-w-md w-full p-6">
        {currentStep === "age" ? (
          <>
            <div className="text-center mb-6">
              <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4" style={{ background: "linear-gradient(135deg, rgba(212,0,122,0.2), rgba(230,145,56,0.2))" }}>
                <svg className="w-8 h-8" style={{ color: "#D4007A" }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
              </div>
              <h2 className="text-xl font-bold text-pnp-textPrimary mb-2">{v.ageTitle}</h2>
              <p className="text-sm text-pnp-textSecondary">
                {v.ageSubtitle}
              </p>
            </div>

            <label className="flex items-start gap-3 p-3 rounded-lg bg-pnp-surface border border-pnp-border cursor-pointer hover:border-pnp-accent/50 transition-colors">
              <input
                type="checkbox"
                checked={ageChecked}
                onChange={(e) => setAgeChecked(e.target.checked)}
                className="mt-0.5 w-5 h-5 rounded border-pnp-border text-pnp-accent focus:ring-pnp-accent"
              />
              <span className="text-sm text-pnp-textPrimary">
                {v.confirmAge}
              </span>
            </label>

            {error && (
              <p className="text-sm text-pnp-error mt-3">{error}</p>
            )}

            <Button
              onClick={handleAgeConfirm}
              disabled={!ageChecked || submitting}
              className="w-full mt-4"
            >
              {submitting ? v.verifying : v.confirmAgeButton}
            </Button>
          </>
        ) : currentStep === "terms" ? (
          <>
            <div className="text-center mb-6">
              <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4" style={{ background: "linear-gradient(135deg, rgba(212,0,122,0.2), rgba(230,145,56,0.2))" }}>
                <svg className="w-8 h-8" style={{ color: "#D4007A" }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <h2 className="text-xl font-bold text-pnp-textPrimary mb-2">{v.termsTitle}</h2>
              <p className="text-sm text-pnp-textSecondary">
                {v.termsSubtitle}
              </p>
            </div>

            <div className="max-h-48 overflow-y-auto p-3 rounded-lg bg-pnp-surface border border-pnp-border text-xs text-pnp-textSecondary space-y-2 mb-4">
              <p className="font-medium text-pnp-textPrimary">{v.termsHeading}</p>
              <p>{v.termsIntro}</p>
              <ul className="list-disc pl-4 space-y-1">
                <li><span className="text-pnp-textPrimary font-medium">{v.termsItem1.split('.')[0]}.</span> {v.termsItem1.split('.').slice(1).join('.').trim()}</li>
                <li>{v.termsItem2}</li>
                <li>{v.termsItem3}</li>
                <li>{v.termsItem4}</li>
                <li>{v.termsItem5}</li>
                <li>{v.termsItem6}</li>
                <li>{v.termsItem7}</li>
              </ul>
              <p>
                {v.termsLinkPrefix}{" "}
                <a href="https://pnptv.app/terms" target="_blank" rel="noopener noreferrer" className="text-pnp-accent hover:underline">
                  pnptv.app/terms
                </a>
                . {v.privacyLinkPrefix}{" "}
                <a href="https://pnptv.app/privacy" target="_blank" rel="noopener noreferrer" className="text-pnp-accent hover:underline">
                  pnptv.app/privacy
                </a>
                .
              </p>
            </div>

            {error && (
              <p className="text-sm text-pnp-error mt-3">{error}</p>
            )}

            <Button
              onClick={handleTermsAccept}
              className="w-full"
            >
              {v.acceptAndContinue}
            </Button>
          </>
        ) : (
          <>
            <div className="text-center mb-6">
              <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4" style={{ background: "linear-gradient(135deg, rgba(212,0,122,0.2), rgba(230,145,56,0.2))" }}>
                <svg className="w-8 h-8" style={{ color: "#D4007A" }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
                </svg>
              </div>
              <h2 className="text-xl font-bold text-pnp-textPrimary mb-2">{v.guidelinesTitle}</h2>
              <p className="text-sm text-pnp-textSecondary">
                {v.guidelinesSubtitle}
              </p>
            </div>

            <div className="max-h-56 overflow-y-auto p-3 rounded-lg bg-pnp-surface border border-pnp-border text-xs text-pnp-textSecondary space-y-3 mb-4">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-sm font-bold text-red-400">18+</span>
                <p className="font-medium text-pnp-textPrimary">{v.adultsOnlyLabel}</p>
              </div>
              <p>{v.adultsOnlyBody}</p>

              <p className="font-medium text-pnp-textPrimary mt-2">{v.prohibitedHeading}</p>
              <p>{v.prohibitedIntro}</p>
              <ul className="list-disc pl-4 space-y-1">
                <li>{v.prohibitedItem1}</li>
                <li>{v.prohibitedItem2}</li>
                <li>{v.prohibitedItem3}</li>
                <li>{v.prohibitedItem4}</li>
                <li>{v.prohibitedItem5}</li>
                <li>{v.prohibitedItem6}</li>
                <li>{v.prohibitedItem7}</li>
                <li>{v.prohibitedItem8}</li>
              </ul>

              <p className="font-medium text-pnp-textPrimary mt-2">{v.enforcementHeading}</p>
              <p>{v.enforcementBody1}</p>
              <p>{v.enforcementBody2}</p>
              <p>{v.enforcementBody3}</p>
            </div>

            {error && (
              <p className="text-sm text-pnp-error mt-3">{error}</p>
            )}

            <Button
              onClick={handleGuidelinesAccept}
              disabled={submitting}
              className="w-full"
            >
              {submitting ? v.settingUp : v.iUnderstand}
            </Button>
          </>
        )}

        <p className="text-xs text-pnp-textSecondary text-center mt-4">
          {v.stepOf
            .replace("{current}", String(currentStepNumber))
            .replace("{total}", String(totalSteps))}
        </p>
      </Card>
    </div>
  );
}
