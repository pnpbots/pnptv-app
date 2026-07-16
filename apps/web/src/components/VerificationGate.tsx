import React, { useEffect, useRef, useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { acceptTerms, verifyAgeSelf, verifyAgePhoto } from "@/lib/api";
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
  // "choose" → show method picker; "photo" → photo upload flow; "dob" → DOB form
  const [ageMethod, setAgeMethod] = useState<"choose" | "photo" | "dob">("choose");
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Revoke stale blob URL whenever photoPreview changes or the gate unmounts.
  useEffect(() => {
    return () => { if (photoPreview) URL.revokeObjectURL(photoPreview); };
  }, [photoPreview]);

  const [dob, setDob] = useState("");
  const [dobError, setDobError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Local confirmed flags: gate dismisses even if refreshUser() fails silently.
  const [verifiedAge, setVerifiedAge] = useState(false);
  const [acceptedTerms, setAcceptedTerms] = useState(false);

  // Still loading: show spinner (don't leak children)
  if (isLoading) {
    return <div className="flex items-center justify-center min-h-dvh"><div className="animate-spin w-8 h-8 border-2 border-white/20 border-t-white rounded-full" /></div>;
  }

  // Not authenticated: redirect to login — never expose gated content
  if (!isAuthenticated || !user) {
    return <Navigate to="/login" replace />;
  }

  // Onboarding not complete: send to wizard.
  // Excludes /onboarding itself plus public doc pages linked from within the wizard.
  if (
    user.onboardingComplete === false &&
    !window.location.pathname.startsWith("/onboarding") &&
    !window.location.pathname.startsWith("/terms") &&
    !window.location.pathname.startsWith("/privacy") &&
    !window.location.pathname.startsWith("/community-guidelines") &&
    !window.location.pathname.startsWith("/crypto-guide")
  ) {
    return <Navigate to="/onboarding" replace />;
  }

  // Both verified: show content (context OR local confirmed flags)
  if ((user.ageVerified || verifiedAge) && (user.termsAccepted || acceptedTerms)) {
    return <>{children}</>;
  }

  // Determine which step to show (use local flags as fallback)
  const needsAge = !user.ageVerified && !verifiedAge;
  const needsTerms = !user.termsAccepted && !acceptedTerms;

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

  const _n = new Date();
  const dobMax = `${_n.getFullYear() - 18}-${String(_n.getMonth() + 1).padStart(2, "0")}-${String(_n.getDate()).padStart(2, "0")}`;

  const handlePhotoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoFile(file);
    setPhotoError(null);
    const url = URL.createObjectURL(file);
    setPhotoPreview(url);
  };

  const handlePhotoSubmit = async () => {
    if (!photoFile) return;
    setSubmitting(true);
    setPhotoError(null);
    try {
      const result = await verifyAgePhoto(photoFile);
      if (result.ageVerified) {
        setVerifiedAge(true);
        await refreshUser().catch(() => {});
        if (!user.termsAccepted && !acceptedTerms) setStep("terms");
      } else if (result.error === "NO_FACE_DETECTED" || result.message?.includes("No se detectó") || result.message?.includes("No face")) {
        setPhotoError(v.photoNoFace);
      } else if (!result.ageVerified && result.success) {
        setPhotoError(v.photoUnderage);
      } else {
        setPhotoError(v.photoError);
      }
    } catch {
      setPhotoError(v.photoError);
    } finally {
      setSubmitting(false);
    }
  };

  const handleAgeConfirm = async () => {
    setDobError(null);
    if (!dob) { setDobError("Please enter your date of birth."); return; }
    if (dob > dobMax) { setDobError("You must be at least 18 years old."); return; }
    setSubmitting(true);
    setError(null);
    try {
      await verifyAgeSelf(dob);
      setVerifiedAge(true);
      await refreshUser().catch(() => {});
      if (!user.termsAccepted && !acceptedTerms) setStep("terms");
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
      setAcceptedTerms(true);
      await refreshUser().catch(() => {});
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
            <div className="text-center mb-5">
              <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4" style={{ background: "linear-gradient(135deg, rgba(212,0,122,0.2), rgba(230,145,56,0.2))" }}>
                <svg className="w-8 h-8" style={{ color: "#D4007A" }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
              </div>
              <h2 className="text-xl font-bold text-pnp-textPrimary mb-2">{v.ageTitle}</h2>
              <p className="text-sm text-pnp-textSecondary">{v.ageSubtitle}</p>
            </div>

            {/* Method picker */}
            {ageMethod === "choose" && (
              <div className="space-y-3">
                <p className="text-xs font-medium text-pnp-textSecondary text-center mb-1">{v.photoMethodTitle}</p>
                <button
                  onClick={() => setAgeMethod("photo")}
                  className="w-full flex items-start gap-3 rounded-xl border border-pnp-border bg-pnp-surface hover:border-pnp-accent px-4 py-3 text-left transition-colors"
                >
                  <span className="text-2xl mt-0.5">📸</span>
                  <div>
                    <p className="text-sm font-medium text-pnp-textPrimary">{v.photoMethodSelfie}</p>
                    <p className="text-xs text-pnp-textSecondary mt-0.5">{v.photoMethodSelfieSub}</p>
                  </div>
                </button>
                <button
                  onClick={() => setAgeMethod("dob")}
                  className="w-full flex items-start gap-3 rounded-xl border border-pnp-border bg-pnp-surface hover:border-pnp-accent px-4 py-3 text-left transition-colors"
                >
                  <span className="text-2xl mt-0.5">📅</span>
                  <div>
                    <p className="text-sm font-medium text-pnp-textPrimary">{v.photoMethodDob}</p>
                    <p className="text-xs text-pnp-textSecondary mt-0.5">{v.photoMethodDobSub}</p>
                  </div>
                </button>
              </div>
            )}

            {/* Photo upload flow */}
            {ageMethod === "photo" && (
              <div className="space-y-3">
                <p className="text-xs text-pnp-textSecondary text-center">{v.photoInstructions}</p>

                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  capture="user"
                  className="hidden"
                  onChange={handlePhotoSelect}
                />

                {photoPreview ? (
                  <div className="relative rounded-xl overflow-hidden aspect-square max-h-48 mx-auto">
                    <img src={photoPreview} alt="selfie preview" className="w-full h-full object-cover" />
                  </div>
                ) : null}

                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full rounded-xl border border-dashed border-pnp-border bg-pnp-surface hover:border-pnp-accent px-4 py-3 text-sm text-pnp-textSecondary hover:text-pnp-textPrimary transition-colors text-center"
                >
                  {photoFile ? v.photoChangeButton : v.photoUploadButton}
                </button>

                <p className="text-[11px] text-pnp-textSecondary/60 text-center">{v.photoPrivacyNote}</p>

                {photoError && (
                  <div className="space-y-1">
                    <p className="text-xs text-pnp-error text-center">{photoError}</p>
                    <button
                      type="button"
                      onClick={() => { setAgeMethod("dob"); setPhotoFile(null); setPhotoPreview(null); setPhotoError(null); }}
                      className="w-full text-xs text-pnp-accent hover:underline text-center"
                    >
                      {v.photoFallbackLink}
                    </button>
                  </div>
                )}

                <Button
                  onClick={handlePhotoSubmit}
                  disabled={!photoFile || submitting}
                  className="w-full"
                >
                  {submitting ? v.photoSubmitting : v.photoSubmitButton}
                </Button>

                <button
                  type="button"
                  onClick={() => { setAgeMethod("choose"); setPhotoFile(null); setPhotoPreview(null); setPhotoError(null); }}
                  className="w-full text-xs text-pnp-textSecondary hover:text-pnp-textPrimary text-center"
                >
                  ← {v.photoBack}
                </button>
              </div>
            )}

            {/* DOB form */}
            {ageMethod === "dob" && (
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-pnp-textSecondary mb-1.5">
                    Date of birth
                  </label>
                  <input
                    type="date"
                    value={dob}
                    onChange={(e) => { setDob(e.target.value); setDobError(null); }}
                    max={dobMax}
                    className="w-full rounded-xl bg-pnp-surface border border-pnp-border px-3 py-2.5 text-pnp-textPrimary focus:outline-none focus:border-pnp-accent"
                    style={{ fontSize: "16px", colorScheme: "dark" }}
                    aria-label="Date of birth"
                  />
                  {dobError && <p className="text-xs text-pnp-error mt-1">{dobError}</p>}
                </div>
                <p className="text-[11px] text-pnp-textSecondary/60 text-center">
                  You must be 18 or older to access this platform. Your date of birth is stored securely.
                </p>

                {error && <p className="text-sm text-pnp-error">{error}</p>}

                <Button
                  onClick={handleAgeConfirm}
                  disabled={!dob || submitting}
                  className="w-full"
                >
                  {submitting ? v.verifying : v.confirmAgeButton}
                </Button>

                <button
                  type="button"
                  onClick={() => { setAgeMethod("choose"); setError(null); setDobError(null); }}
                  className="w-full text-xs text-pnp-textSecondary hover:text-pnp-textPrimary text-center"
                >
                  ← {v.photoBack}
                </button>
              </div>
            )}
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
