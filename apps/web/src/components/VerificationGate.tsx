import React, { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { acceptTerms, verifyAgeSelf } from "@/lib/api";
import { Button, Card } from "@pnptv/ui-kit";

interface VerificationGateProps {
  children: React.ReactNode;
}

export function VerificationGate({ children }: VerificationGateProps) {
  const { user, isAuthenticated, isLoading, refreshUser } = useAuth();
  const [step, setStep] = useState<"age" | "terms" | "guidelines">("age");
  const [ageChecked, setAgeChecked] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Still loading: show spinner (don't leak children)
  if (isLoading) {
    return <div className="flex items-center justify-center min-h-screen"><div className="animate-spin w-8 h-8 border-2 border-white/20 border-t-white rounded-full" /></div>;
  }

  // Not authenticated: show children (Layout handles login)
  if (!isAuthenticated || !user) {
    return <>{children}</>;
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
      setError(err.message || "Failed to verify age");
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
      setError(err.message || "Failed to accept terms");
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
              <h2 className="text-xl font-bold text-pnp-textPrimary mb-2">Age Verification</h2>
              <p className="text-sm text-pnp-textSecondary">
                This platform contains content intended for adults. Please confirm your age to continue.
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
                I confirm that I am 18 years of age or older
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
              {submitting ? "Verifying..." : "Confirm Age"}
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
              <h2 className="text-xl font-bold text-pnp-textPrimary mb-2">Terms of Service</h2>
              <p className="text-sm text-pnp-textSecondary">
                Please review and accept our terms to continue using the platform.
              </p>
            </div>

            <div className="max-h-48 overflow-y-auto p-3 rounded-lg bg-pnp-surface border border-pnp-border text-xs text-pnp-textSecondary space-y-2 mb-4">
              <p className="font-medium text-pnp-textPrimary">PNPTV Terms of Service</p>
              <p>By using PNPTV, you agree to the following:</p>
              <ul className="list-disc pl-4 space-y-1">
                <li>You are at least 18 years old.</li>
                <li>You will not share, redistribute, or record any content without explicit permission.</li>
                <li>You accept that all streaming content is provided as-is.</li>
                <li>You agree to our community guidelines and respect other users.</li>
                <li>Payments are non-refundable unless required by applicable law.</li>
                <li>We may suspend accounts that violate these terms.</li>
              </ul>
              <p>
                For the full terms, visit{" "}
                <a href="https://pnptv.app/terms" target="_blank" rel="noopener noreferrer" className="text-pnp-accent hover:underline">
                  pnptv.app/terms
                </a>
                . For privacy policy, visit{" "}
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
              Accept & Continue
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
              <h2 className="text-xl font-bold text-pnp-textPrimary mb-2">Community Guidelines</h2>
              <p className="text-sm text-pnp-textSecondary">
                PNPtv is committed to maintaining a safe, lawful, and responsible environment for all members.
              </p>
            </div>

            <div className="max-h-56 overflow-y-auto p-3 rounded-lg bg-pnp-surface border border-pnp-border text-xs text-pnp-textSecondary space-y-3 mb-4">
              <p className="font-medium text-pnp-textPrimary">Prohibited Activities</p>
              <p>
                The use, promotion, distribution, sale, solicitation, or discussion of illegal drugs,
                controlled substances, or any unlawful materials is <span className="text-pnp-textPrimary font-medium">strictly prohibited</span> on this platform.
              </p>
              <p>This includes, but is not limited to:</p>
              <ul className="list-disc pl-4 space-y-1">
                <li>The sale, purchase, or exchange of illegal substances</li>
                <li>Requests for drugs or controlled substances</li>
                <li>Instructions, advice, or facilitation regarding the acquisition, preparation, or use of illegal substances</li>
                <li>Content depicting illegal drug use in a manner that promotes, encourages, or glorifies such behavior</li>
                <li>Coordination of in-person or virtual activities involving unlawful substances</li>
                <li>Advertising, selling, or distributing drug-related paraphernalia or materials intended for unlawful purposes</li>
              </ul>
              <p className="font-medium text-pnp-textPrimary mt-2">Enforcement</p>
              <p>
                PNPtv does not condone or facilitate illegal activity of any kind. Any user found engaging in
                activities that violate local, national, or international laws may have their account
                <span className="text-pnp-textPrimary font-medium"> suspended or permanently terminated without prior notice</span>.
              </p>
              <p>
                All members are solely responsible for their actions and for complying with the laws applicable in their jurisdiction.
              </p>
              <p>
                PNPtv reserves the right to report illegal activity to the appropriate authorities when required by law.
              </p>
            </div>

            <div className="p-3 rounded-lg bg-pnp-accent/10 border border-pnp-accent/20 mb-4">
              <p className="text-xs text-pnp-textPrimary">
                You have a <span className="font-semibold text-pnp-accent">24-hour free PRIME trial</span> to explore all features. After that, subscribe to keep your access.
              </p>
            </div>

            {error && (
              <p className="text-sm text-pnp-error mt-3">{error}</p>
            )}

            <Button
              onClick={handleGuidelinesAccept}
              disabled={submitting}
              className="w-full"
            >
              {submitting ? "Setting up..." : "I Understand & Agree"}
            </Button>
          </>
        )}

        <p className="text-xs text-pnp-textSecondary text-center mt-4">
          Step {currentStepNumber} of {totalSteps}
        </p>
      </Card>
    </div>
  );
}
