import React, { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { acceptTerms, verifyAgeSelf } from "@/lib/api";
import { Button, Card } from "@pnptv/ui-kit";

interface VerificationGateProps {
  children: React.ReactNode;
}

export function VerificationGate({ children }: VerificationGateProps) {
  const { user, isAuthenticated, isLoading, refreshUser } = useAuth();
  const [step, setStep] = useState<"age" | "terms">("age");
  const [ageChecked, setAgeChecked] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Not authenticated or still loading: show children (Layout handles login)
  if (isLoading || !isAuthenticated || !user) {
    return <>{children}</>;
  }

  // Both verified: show content
  if (user.ageVerified && user.termsAccepted) {
    return <>{children}</>;
  }

  // Determine which step to show
  const needsAge = !user.ageVerified;
  const needsTerms = !user.termsAccepted;
  const currentStep = needsAge && step === "age" ? "age" : "terms";

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

  const handleTermsAccept = async () => {
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
        {currentStep === "age" && needsAge ? (
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
        ) : (
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
              disabled={submitting}
              className="w-full"
            >
              {submitting ? "Accepting..." : "Accept Terms & Continue"}
            </Button>
          </>
        )}

        <p className="text-xs text-pnp-textSecondary text-center mt-4">
          {currentStep === "age" && needsTerms
            ? "Step 1 of 2"
            : needsAge
            ? "Step 2 of 2"
            : ""}
        </p>
      </Card>
    </div>
  );
}
