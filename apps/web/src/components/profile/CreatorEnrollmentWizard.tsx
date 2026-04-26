import React, { useState } from "react";
import { useI18n } from "@/lib/i18n";
import { submitCreatorEnrollment } from "@/lib/api";
import { SignaturePad } from "@/components/SignaturePad";

// ── Tier constants (shared with MonetizeContentCard) ──────────────────────────

export const CREATOR_TIERS = [
  { id: "ice" as const, label: "Ice", price: 5, color: "#5ED1C4", gradient: "linear-gradient(135deg, #5ED1C4, #00D4E8)", emoji: "❄️" },
  { id: "crystal" as const, label: "Crystal", price: 10, color: "#D4007A", gradient: "linear-gradient(135deg, #D4007A, #E69138)", emoji: "🔮" },
  { id: "diamond" as const, label: "Diamond", price: 15, color: "#FFB454", gradient: "linear-gradient(135deg, #FFB454, #FF8C00)", emoji: "💎" },
] as const;

export type TierId = typeof CREATOR_TIERS[number]["id"];

export const TIER_CONFIG = {
  ice:     { color: "#5ED1C4", gradient: "linear-gradient(135deg, #5ED1C4, #00D4E8)",  rgb: "94,209,196",  name: "Ice Profile",     emoji: "❄️", price: 5 },
  crystal: { color: "#D4007A", gradient: "linear-gradient(135deg, #D4007A, #E69138)",  rgb: "212,0,122",   name: "Crystal Profile", emoji: "🔮", price: 10 },
  diamond: { color: "#FFB454", gradient: "linear-gradient(135deg, #FFB454, #FF8C00)",  rgb: "255,180,84",  name: "Diamond Profile", emoji: "💎", price: 15 },
} as const;

// ── Props ─────────────────────────────────────────────────────────────────────

export interface CreatorEnrollmentWizardProps {
  tier: TierId;
  onClose: () => void;
  onSubmitted: () => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function CreatorEnrollmentWizard({
  tier,
  onClose,
  onSubmitted,
}: CreatorEnrollmentWizardProps) {
  const i18n = useI18n();
  const pr = i18n.profile;
  const t = TIER_CONFIG[tier];
  const [step, setStep] = useState(1);
  const TOTAL_STEPS = 5;

  // Step 1 state
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [commitmentAccepted, setCommitmentAccepted] = useState(false);

  // Step 2 state (payment)
  // Dash via BTCPay is the canonical crypto payout path post-Daimo retirement
  // (2026-04-21). Meru is the fiat off-ramp. usdc/usdt remain UI options for
  // creators who already set them up before the migration; new creators are
  // nudged to Dash by ordering it first.
  const [paymentMethod, setPaymentMethod] = useState<"dash" | "meru" | "usdc" | "usdt">("dash");
  const [paymentAddress, setPaymentAddress] = useState("");
  const [paymentNetwork, setPaymentNetwork] = useState("dash");

  // Step 3 state (ID + signature)
  const [idFile, setIdFile] = useState<File | null>(null);
  const [idPreview, setIdPreview] = useState<string | null>(null);
  const [signatureData, setSignatureData] = useState("");

  // Submit state
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const handleIdUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIdFile(file);
    const reader = new FileReader();
    reader.onload = (ev) => setIdPreview(ev.target?.result as string);
    reader.readAsDataURL(file);
  };

  const handleSubmit = async () => {
    if (!idFile) { setSubmitError(pr.idDocumentRequired); return; }
    if (!signatureData) { setSubmitError(pr.signatureRequired); return; }
    if (!paymentAddress.trim()) { setSubmitError(pr.paymentAddressRequired); return; }
    setSubmitting(true);
    setSubmitError(null);
    try {
      await submitCreatorEnrollment({
        tier,
        paymentMethod,
        paymentAddress,
        paymentNetwork,
        signatureData,
        idDocument: idFile,
      });
      onSubmitted();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : pr.submissionFailed);
    } finally {
      setSubmitting(false);
    }
  };

  const canProceedStep1 = termsAccepted && commitmentAccepted;
  const canProceedStep2 = paymentAddress.trim().length >= 3;
  const canProceedStep3 = !!idFile;
  const canProceedStep4 = !!signatureData;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.8)", backdropFilter: "blur(6px)" }}
    >
      <div
        className="w-full max-w-sm rounded-2xl flex flex-col"
        style={{ background: "var(--pnp-surface, #1C1C1E)", border: `1px solid rgba(${t.rgb},0.25)`, maxHeight: "90vh" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3 flex-shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-lg">{t.emoji}</span>
            <div>
              <p className="text-sm font-semibold text-white">{t.name} {pr.enrollment}</p>
              <p className="text-xs" style={{ color: t.color }}>{pr.stepOf} {step} {pr.of} {TOTAL_STEPS}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-full flex items-center justify-center text-white/40 hover:text-white hover:bg-white/10 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Progress bar */}
        <div className="px-5 pb-3 flex-shrink-0">
          <div className="h-1 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.08)" }}>
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{ width: `${(step / TOTAL_STEPS) * 100}%`, background: t.gradient }}
            />
          </div>
        </div>

        {/* Body — scrollable */}
        <div className="overflow-y-auto flex-1 px-5 pb-4 space-y-4">

          {/* Step 1: Terms & Commitment */}
          {step === 1 && (
            <>
              <p className="text-xs font-semibold text-white/60 uppercase tracking-wide">{pr.termsAndConditions}</p>

              <div className="space-y-3 text-xs" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>
                <div className="rounded-xl p-3 space-y-2" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
                  <p className="font-semibold text-white">{pr.programTerms}</p>
                  <p>{pr.programTermsBody}</p>
                  <p>{pr.programTermsBody2}</p>
                  <p>{pr.programTermsBody3}</p>
                </div>

                <div className="rounded-xl p-3 space-y-2" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
                  <p className="font-semibold text-white">{pr.contentRequirements}</p>
                  <p>{pr.contentReqBody}</p>
                  <ul className="list-disc list-inside space-y-0.5 mt-1">
                    <li>{pr.contentReqItem1}</li>
                    <li>{pr.contentReqItem2}</li>
                    <li>{pr.contentReqItem3}</li>
                    <li>{pr.contentReqItem4}</li>
                  </ul>
                  <p className="mt-1">{pr.contentReqDisclaimer}</p>
                </div>
              </div>

              <label className="flex items-start gap-3 cursor-pointer">
                <div
                  className="mt-0.5 w-5 h-5 rounded flex items-center justify-center flex-shrink-0 transition-colors"
                  style={{ background: termsAccepted ? t.gradient : "rgba(255,255,255,0.08)", border: `1px solid rgba(${t.rgb},0.4)` }}
                  onClick={() => setTermsAccepted((v) => !v)}
                >
                  {termsAccepted && (
                    <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </div>
                <span className="text-xs" style={{ color: termsAccepted ? "#fff" : "#8E8E93" }}>
                  {pr.agreeToTerms} <strong>{pr.creatorProgramTerms}</strong> {pr.and} <strong>{pr.payoutTerms}</strong>
                </span>
              </label>

              <label className="flex items-start gap-3 cursor-pointer">
                <div
                  className="mt-0.5 w-5 h-5 rounded flex items-center justify-center flex-shrink-0 transition-colors"
                  style={{ background: commitmentAccepted ? t.gradient : "rgba(255,255,255,0.08)", border: `1px solid rgba(${t.rgb},0.4)` }}
                  onClick={() => setCommitmentAccepted((v) => !v)}
                >
                  {commitmentAccepted && (
                    <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </div>
                <span className="text-xs" style={{ color: commitmentAccepted ? "#fff" : "#8E8E93" }}>
                  {pr.understandCommitment} <strong>{pr.contentRequirementsLabel}</strong>
                </span>
              </label>
            </>
          )}

          {/* Step 2: Payment Setup */}
          {step === 2 && (
            <>
              <p className="text-xs font-semibold text-white/60 uppercase tracking-wide">{pr.paymentSetup}</p>

              <div className="rounded-xl p-3 text-xs space-y-1.5" style={{ background: `rgba(${t.rgb},0.08)`, border: `1px solid rgba(${t.rgb},0.2)` }}>
                <p className="font-semibold text-white">{pr.payoutTermsTitle}</p>
                <p style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>{pr.youReceive70}</p>
                <p style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>{pr.payoutsEveryTuesday}</p>
                <p style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>{pr.minimumPayout}</p>
              </div>

              <div>
                <p className="text-xs font-medium mb-2" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>{pr.selectPaymentMethod}</p>
                <div className="grid grid-cols-2 gap-2">
                  {([
                    { id: "dash" as const, label: "Dash", icon: "💎" },
                    { id: "meru" as const, label: pr.meruApp, icon: "💳" },
                    { id: "usdc" as const, label: "USDC", icon: "🔵" },
                    { id: "usdt" as const, label: "USDT", icon: "🟢" },
                  ]).map((m) => (
                    <button
                      key={m.id}
                      onClick={() => {
                        setPaymentMethod(m.id);
                        setPaymentAddress("");
                        if (m.id === "dash") setPaymentNetwork("dash");
                        else if (m.id === "usdt") setPaymentNetwork("tron");
                        else if (m.id === "usdc") setPaymentNetwork("base");
                        else setPaymentNetwork("");
                      }}
                      className="py-3 rounded-xl text-center transition-all"
                      style={paymentMethod === m.id
                        ? { background: `rgba(${t.rgb},0.15)`, border: `2px solid rgba(${t.rgb},0.5)` }
                        : { background: "rgba(255,255,255,0.04)", border: "2px solid rgba(255,255,255,0.08)" }
                      }
                    >
                      <p className="text-lg mb-0.5">{m.icon}</p>
                      <p className="text-xs font-semibold" style={{ color: paymentMethod === m.id ? t.color : "var(--pnp-text-secondary, #8E8E93)" }}>{m.label}</p>
                    </button>
                  ))}
                </div>
              </div>

              {(paymentMethod === "usdc" || paymentMethod === "usdt") && (
                <div>
                  <p className="text-xs font-medium mb-1.5" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>{pr.network}</p>
                  <div className="grid grid-cols-2 gap-2">
                    {(paymentMethod === "usdc"
                      ? [{ id: "base", label: "Base" }, { id: "ethereum", label: "Ethereum" }]
                      : [{ id: "tron", label: "Tron (TRC-20)" }, { id: "ethereum", label: "Ethereum (ERC-20)" }]
                    ).map((n) => (
                      <button
                        key={n.id}
                        onClick={() => setPaymentNetwork(n.id)}
                        className="py-2 rounded-lg text-xs font-medium transition-colors border"
                        style={paymentNetwork === n.id
                          ? { background: `rgba(${t.rgb},0.12)`, color: t.color, borderColor: `rgba(${t.rgb},0.3)` }
                          : { background: "rgba(255,255,255,0.04)", color: "var(--pnp-text-secondary, #8E8E93)", borderColor: "rgba(255,255,255,0.08)" }
                        }
                      >
                        {n.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <label className="text-xs font-medium block mb-1.5" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>
                  {paymentMethod === "meru" ? pr.meruAccountOrPhone : pr.walletAddress}
                </label>
                <input
                  type="text"
                  value={paymentAddress}
                  onChange={(e) => setPaymentAddress(e.target.value)}
                  placeholder={paymentMethod === "meru" ? pr.meruPlaceholder : pr.walletPlaceholder}
                  className="w-full rounded-lg px-3 py-2.5 text-white outline-none"
                  style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", fontSize: "16px" }}
                  autoComplete="off"
                />
              </div>
            </>
          )}

          {/* Step 3: Identity Verification */}
          {step === 3 && (
            <>
              <p className="text-xs font-semibold text-white/60 uppercase tracking-wide">{pr.identityVerification}</p>

              <div className="rounded-xl p-3 text-xs" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
                <p className="font-semibold text-white mb-1">{pr.whyWeNeedThis}</p>
                <p style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>
                  {pr.idVerificationExplanation}
                </p>
              </div>

              <div>
                <p className="text-xs font-medium mb-1.5" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>
                  {pr.governmentIdFront} <span className="text-red-400">*</span>
                </p>
                {idPreview ? (
                  <div className="relative">
                    <img
                      src={idPreview}
                      alt="ID preview"
                      className="w-full rounded-xl object-cover"
                      style={{ maxHeight: 140, border: `1px solid rgba(${t.rgb},0.3)` }}
                    />
                    <button
                      onClick={() => { setIdFile(null); setIdPreview(null); }}
                      className="absolute top-2 right-2 w-6 h-6 rounded-full flex items-center justify-center text-white text-xs"
                      style={{ background: "rgba(0,0,0,0.6)" }}
                    >
                      ✕
                    </button>
                  </div>
                ) : (
                  <label
                    className="flex flex-col items-center justify-center gap-2 rounded-xl py-6 cursor-pointer transition-colors"
                    style={{ border: `1px dashed rgba(${t.rgb},0.35)`, background: `rgba(${t.rgb},0.04)` }}
                  >
                    <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} style={{ color: t.color }}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5a1.5 1.5 0 001.5-1.5V5.25a1.5 1.5 0 00-1.5-1.5H3.75a1.5 1.5 0 00-1.5 1.5v14.25c0 .828.672 1.5 1.5 1.5z" />
                    </svg>
                    <p className="text-xs" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>{pr.tapToUploadId}</p>
                    <input type="file" accept="image/*" className="hidden" onChange={handleIdUpload} />
                  </label>
                )}
              </div>

            </>
          )}

          {/* Step 4: Digital Signature */}
          {step === 4 && (
            <>
              <p className="text-xs font-semibold text-white/60 uppercase tracking-wide">
                {pr.digitalSignature}
              </p>

              <div className="rounded-xl p-3 text-xs" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
                <p style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>
                  {pr.idVerificationExplanation}
                </p>
              </div>

              <div>
                <p className="text-xs font-medium mb-2" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>
                  {pr.digitalSignature} <span className="text-red-400">*</span>
                </p>
                <SignaturePad
                  onSave={setSignatureData}
                  width={320}
                  height={180}
                />
              </div>
            </>
          )}

          {/* Step 5: Review & Submit */}
          {step === 5 && (
            <>
              <p className="text-xs font-semibold text-white/60 uppercase tracking-wide">{pr.reviewAndSubmit}</p>

              <div className="space-y-2 text-xs">
                <div className="rounded-xl p-3" style={{ background: `rgba(${t.rgb},0.08)`, border: `1px solid rgba(${t.rgb},0.2)` }}>
                  <p className="font-semibold text-white mb-2">{t.emoji} {t.name}</p>
                  <div className="space-y-1.5" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>
                    <div className="flex justify-between">
                      <span>{pr.subscriptionPrice}</span>
                      <span className="text-white font-medium">${t.price}/mo</span>
                    </div>
                    <div className="flex justify-between">
                      <span>{pr.yourEarnings}</span>
                      <span className="text-white font-medium">70% · ~${(t.price * 0.7).toFixed(2)}/subscriber</span>
                    </div>
                    <div className="flex justify-between">
                      <span>{pr.payoutDay}</span>
                      <span className="text-white font-medium">{pr.payoutDayValue}</span>
                    </div>
                  </div>
                </div>

                <div className="rounded-xl p-3" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
                  <p className="font-semibold text-white mb-2">{pr.paymentDetails}</p>
                  <div className="space-y-1.5" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>
                    <div className="flex justify-between">
                      <span>{pr.method}</span>
                      <span className="text-white font-medium capitalize">{paymentMethod}</span>
                    </div>
                    {paymentNetwork && paymentMethod !== "meru" && (
                      <div className="flex justify-between">
                        <span>{pr.network}</span>
                        <span className="text-white font-medium capitalize">{paymentNetwork}</span>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <span>{pr.address}</span>
                      <span className="text-white font-medium truncate ml-4" style={{ maxWidth: 160 }}>{paymentAddress}</span>
                    </div>
                  </div>
                </div>

                <div className="rounded-xl p-3" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
                  <div className="flex items-center justify-between">
                    <p className="font-semibold text-white">{pr.idVerificationProvided}</p>
                    <span className="text-xs" style={{ color: "#4ADE80" }}>{pr.idProvided}</span>
                  </div>
                  <p className="text-xs mt-1" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>
                    {pr.idCapturedNote}
                  </p>
                </div>
              </div>

              <p className="text-xs text-center" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>
                {pr.reviewNote}
              </p>

              {submitError && (
                <p className="text-xs text-center" style={{ color: "#FF453A" }}>{submitError}</p>
              )}
            </>
          )}
        </div>

        {/* Footer actions */}
        <div className="px-5 pb-5 pt-3 flex-shrink-0 space-y-2" style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
          {step < TOTAL_STEPS ? (
            <button
              onClick={() => setStep((s) => s + 1)}
              disabled={
                (step === 1 && !canProceedStep1) ||
                (step === 2 && !canProceedStep2) ||
                (step === 3 && !canProceedStep3) ||
                (step === 4 && !canProceedStep4)
              }
              className="w-full py-3 rounded-xl text-sm font-semibold text-white transition-opacity disabled:opacity-40"
              style={{ background: t.gradient }}
            >
              {pr.continue}
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="w-full py-3 rounded-xl text-sm font-semibold text-white transition-opacity disabled:opacity-50"
              style={{ background: t.gradient }}
            >
              {submitting ? pr.submitting : pr.submitEnrollment}
            </button>
          )}
          {step > 1 && (
            <button
              onClick={() => setStep((s) => s - 1)}
              className="w-full py-2 text-xs text-center"
              style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}
            >
              {pr.backStep}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
