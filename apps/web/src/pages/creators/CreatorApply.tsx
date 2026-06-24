import React, { useState, useCallback, useEffect, useRef } from "react";
import { Helmet } from "react-helmet-async";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/lib/i18n";
import { useCreatorData } from "@/hooks/useCreatorData";
import CreatorEnrollmentWizard from "@/components/profile/CreatorEnrollmentWizard";
import {
  get2257Status,
  submit2257Identity,
  startPersonaInquiry,
  getPersonaStatus,
  getCreatorSetupStatus,
  type CreatorSetupStatus,
  type CreatorSetupItem,
} from "@/lib/api";

// ── Sub-components ────────────────────────────────────────────────────────────

function CriterionBar({
  label,
  current,
  required,
  met,
}: {
  label: string;
  current: number;
  required: number;
  met: boolean;
}) {
  const pct = Math.min((current / required) * 100, 100);
  return (
    <div className="mb-3">
      <div className="flex items-center justify-between text-xs mb-1">
        <span className="text-white/80">{label}</span>
        <span style={{ color: met ? "#5ED1C4" : "#8E8E93" }}>
          {current}/{required} {met ? "✓" : ""}
        </span>
      </div>
      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.08)" }}>
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: `${pct}%`,
            background: met ? "#5ED1C4" : "linear-gradient(to right, #D4007A, #E69138)",
          }}
        />
      </div>
    </div>
  );
}

// ── Types ─────────────────────────────────────────────────────────────────────

type IdentityStatus = {
  identity_verified: boolean;
  identity_verification_required_by: string | null;
  record: {
    verification_status: "pending" | "approved" | "rejected";
    submitted_at: string;
    admin_notes: string | null;
  } | null;
} | null;

const ID_TYPES = [
  { value: "passport", label: "Passport" },
  { value: "drivers_license", label: "Driver's License" },
  { value: "national_id", label: "National ID Card" },
  { value: "state_id", label: "State / Province ID" },
  { value: "other", label: "Other Government-Issued ID" },
] as const;

// ── Setup item metadata ───────────────────────────────────────────────────────

const SETUP_META: Record<string, { description: string; actionLabel?: string; href?: string; external?: boolean }> = {
  identity: {
    description: "Government ID required by federal law (18 U.S.C. § 2257) to verify you are 18+.",
  },
  creator_terms: {
    description: "Accept the PNPtv! Creator Program terms: 70/30 revenue split, content policy, payout schedule.",
    actionLabel: "Review & Accept",
    href: "/creators/consents",
  },
  payout: {
    description: "Choose how you receive earnings — fiat transfer or crypto wallet.",
    actionLabel: "Configure Payouts",
    href: "/creators/settings",
  },
  profile: {
    description: "Add your stage name and bio so subscribers know who you are.",
    actionLabel: "Edit Profile",
    href: "/creators/settings",
  },
  first_post: {
    description: "Publish your first exclusive post so new subscribers see content right away.",
    actionLabel: "Create Post",
    href: "/creators/content",
  },
};

// ── StatusIcon ────────────────────────────────────────────────────────────────

function StatusIcon({ done, required }: { done: boolean; required: boolean }) {
  if (done) {
    return (
      <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0" style={{ background: "rgba(94,209,196,0.15)", border: "1.5px solid rgba(94,209,196,0.4)" }}>
        <svg className="w-5 h-5" style={{ color: "#5ED1C4" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
        </svg>
      </div>
    );
  }
  if (required) {
    return (
      <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0" style={{ background: "rgba(212,0,122,0.12)", border: "1.5px solid rgba(212,0,122,0.4)" }}>
        <svg className="w-4 h-4" style={{ color: "#D4007A" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
        </svg>
      </div>
    );
  }
  return (
    <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0" style={{ background: "rgba(255,255,255,0.06)", border: "1.5px solid rgba(255,255,255,0.12)" }}>
      <div className="w-2.5 h-2.5 rounded-full" style={{ background: "rgba(255,255,255,0.25)" }} />
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function CreatorApply() {
  const { user, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const { creator: t } = useI18n();
  const { eligibility, dashboard, loading, reload } = useCreatorData();

  // 2257 identity verification
  const [identityStatus, setIdentityStatus] = useState<IdentityStatus>(null);
  const [identityLoading, setIdentityLoading] = useState(false);
  const [idLegalName, setIdLegalName] = useState("");
  const [idDob, setIdDob] = useState("");
  const [idType, setIdType] = useState("");
  const [idFile, setIdFile] = useState<File | null>(null);
  const [idSubmitting, setIdSubmitting] = useState(false);
  const [idSubmitError, setIdSubmitError] = useState<string | null>(null);
  const [idSubmitDone, setIdSubmitDone] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Persona
  const [personaConfigured, setPersonaConfigured] = useState(false);
  const [personaStatus, setPersonaStatus] = useState<string | null>(null);
  const [personaStarting, setPersonaStarting] = useState(false);
  const [personaStartError, setPersonaStartError] = useState<string | null>(null);
  const [personaProcessing, setPersonaProcessing] = useState(false);
  const [showManualUpload, setShowManualUpload] = useState(false);

  // Setup checklist (active creators)
  const [setupStatus, setSetupStatus] = useState<CreatorSetupStatus | null>(null);
  const [setupLoading, setSetupLoading] = useState(false);

  // Enrollment wizard (replaces activation modal)
  const [showWizard, setShowWizard] = useState(false);

  const isActive   = dashboard?.creatorStatus === "active";
  const isEligible = dashboard?.creatorStatus === "eligible";
  const isPending  = dashboard?.creatorStatus === "pending_review";

  // Ref so Persona polling effect can read the latest isActive without a stale closure
  const isActiveRef = useRef(isActive);
  useEffect(() => { isActiveRef.current = isActive; }, [isActive]);

  // Fetch 2257 + Persona on mount
  useEffect(() => {
    if (!isAuthenticated) return;
    setIdentityLoading(true);
    Promise.all([
      get2257Status().catch(() => null),
      getPersonaStatus().catch(() => null),
    ]).then(([idRes, pRes]) => {
      if (idRes) setIdentityStatus(idRes);
      if (pRes) {
        setPersonaConfigured(pRes.configured);
        setPersonaStatus(pRes.persona_status);
      }
    }).finally(() => setIdentityLoading(false));
  }, [isAuthenticated]);

  // Poll after Persona hosted-flow return
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("persona_status") !== "completed") return;
    setPersonaProcessing(true);
    let attempts = 0;
    const poll = setInterval(async () => {
      attempts++;
      try {
        const updated = await get2257Status();
        if (updated) setIdentityStatus(updated);
        const pUpdated = await getPersonaStatus().catch(() => null);
        if (pUpdated) setPersonaStatus(pUpdated.persona_status);
        if (updated?.identity_verified || attempts >= 10) {
          clearInterval(poll);
          setPersonaProcessing(false);
          if (isActiveRef.current) {
            const s = await getCreatorSetupStatus().catch(() => null);
            if (s) setSetupStatus(s);
          }
        }
      } catch {
        if (attempts >= 10) { clearInterval(poll); setPersonaProcessing(false); }
      }
    }, 3000);
    return () => clearInterval(poll);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch setup status for active creators
  useEffect(() => {
    if (!isActive) return;
    setSetupLoading(true);
    getCreatorSetupStatus()
      .then((res) => { if (res) setSetupStatus(res); })
      .catch(() => {})
      .finally(() => setSetupLoading(false));
  }, [isActive]);

  const refreshSetup = useCallback(async () => {
    if (!isActive) return;
    const res = await getCreatorSetupStatus().catch(() => null);
    if (res) setSetupStatus(res);
  }, [isActive]);

  const handleSubmitIdentity = useCallback(async () => {
    setIdSubmitError(null);
    if (!idLegalName.trim()) { setIdSubmitError("Legal full name is required."); return; }
    if (!idDob) { setIdSubmitError("Date of birth is required."); return; }
    if (!idType) { setIdSubmitError("Please select your ID type."); return; }
    if (!idFile) { setIdSubmitError("Please attach a photo of your ID document."); return; }

    const formData = new FormData();
    formData.append("legalName", idLegalName.trim());
    formData.append("dateOfBirth", idDob);
    formData.append("idType", idType);
    formData.append("idDocument", idFile);

    setIdSubmitting(true);
    try {
      await submit2257Identity(formData);
      setIdSubmitDone(true);
      const updated = await get2257Status();
      setIdentityStatus(updated);
      await refreshSetup();
    } catch (err) {
      setIdSubmitError(err instanceof Error ? err.message : "Submission failed. Please try again.");
    } finally {
      setIdSubmitting(false);
    }
  }, [idLegalName, idDob, idType, idFile, refreshSetup]);

  const handlePersonaStart = useCallback(async () => {
    setPersonaStartError(null);
    setPersonaStarting(true);
    try {
      const result = await startPersonaInquiry();
      window.location.href = result.hostedFlowUrl;
    } catch (err) {
      setPersonaStartError(err instanceof Error ? err.message : "Could not start verification. Please try again.");
      setPersonaStarting(false);
    }
  }, []);

  // Derived 2257 state
  const idVerified  = identityStatus?.identity_verified === true;
  const idRecord    = identityStatus?.record;
  const idPending   = !idVerified && idRecord?.verification_status === "pending";
  const idRejected  = !idVerified && idRecord?.verification_status === "rejected";
  const idApproved  = idVerified || idRecord?.verification_status === "approved";
  const graceDeadline = identityStatus?.identity_verification_required_by
    ? new Date(identityStatus.identity_verification_required_by) : null;
  const inGrace     = graceDeadline && graceDeadline > new Date();
  const is2257Compliant = idApproved || inGrace;
  const enrollBlocked   = !identityLoading && identityStatus !== null && !is2257Compliant;

  // ── 2257 form (shared between active checklist and non-active flow) ──────────
  const identity2257Form = (
    <div className="glass-card-sm p-5" style={{ borderColor: "rgba(212,0,122,0.35)" }}>
      <div className="flex items-center gap-2 mb-1">
        <svg className="w-5 h-5 flex-shrink-0" style={{ color: "#D4007A" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 9h3.75M15 12h3.75M15 15h3.75M4.5 19.5h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5zm6-10.125a1.875 1.875 0 11-3.75 0 1.875 1.875 0 013.75 0zm1.294 6.336a6.721 6.721 0 01-3.17.789 6.721 6.721 0 01-3.168-.789 3.376 3.376 0 016.338 0z" />
        </svg>
        <p className="text-base font-bold text-white">Identity Verification Required</p>
      </div>
      <p className="text-xs leading-relaxed mb-4" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>
        Federal law (18 U.S.C. § 2257) requires platforms hosting adult content to verify performers are 18+.
        Stored securely for compliance only.{" "}
        <a href="/2257" target="_blank" rel="noopener noreferrer" className="underline" style={{ color: "#D4007A" }}>Learn more</a>
      </p>

      {idRejected && idRecord?.admin_notes && (
        <div className="rounded-lg px-4 py-3 mb-4 text-xs" style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.3)", color: "#FCA5A5" }}>
          <p className="font-semibold mb-1">Previous submission rejected</p>
          <p>{idRecord.admin_notes}</p>
          <p className="mt-1 opacity-70">Please correct the issue and resubmit below.</p>
        </div>
      )}

      {idSubmitDone ? (
        <div className="rounded-lg px-4 py-3 text-sm text-center" style={{ background: "rgba(94,209,196,0.07)", border: "1px solid rgba(94,209,196,0.2)", color: "#5ED1C4" }}>
          <p className="font-semibold mb-1">Submitted for Review</p>
          <p className="text-xs" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>
            Our team will verify your identity within 24–48 hours.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {personaConfigured && (
            <div className="rounded-xl p-4" style={{ background: "rgba(94,209,196,0.05)", border: "1px solid rgba(94,209,196,0.2)" }}>
              <div className="flex items-center gap-2 mb-1">
                <svg className="w-4 h-4 flex-shrink-0" style={{ color: "#5ED1C4" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
                </svg>
                <p className="text-sm font-bold text-white">Instant Verification (Recommended)</p>
              </div>
              <p className="text-xs leading-relaxed mb-3" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>
                2–3 minutes via Persona — no data stored on our servers.
              </p>
              {personaStartError && <p className="text-xs text-red-400 font-medium mb-2">{personaStartError}</p>}
              <button
                onClick={handlePersonaStart}
                disabled={personaStarting}
                className="w-full py-3 rounded-xl text-sm font-bold text-white disabled:opacity-40 flex items-center justify-center gap-2"
                style={{ background: "linear-gradient(135deg, #5ED1C4, #3BA89E)" }}
              >
                {personaStarting ? (
                  <><svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>Starting…</>
                ) : (
                  <>Verify with Persona<svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" /></svg></>
                )}
              </button>
              <button type="button" onClick={() => setShowManualUpload(v => !v)} className="w-full mt-2 text-xs text-center underline" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>
                {showManualUpload ? "Hide manual upload" : "or verify manually — upload your ID below"}
              </button>
            </div>
          )}

          {(!personaConfigured || showManualUpload) && (
            <div className={personaConfigured ? "mt-1" : ""}>
              {personaConfigured && <p className="text-xs font-semibold text-white/60 mb-2 uppercase tracking-wide">Manual ID Upload</p>}
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-white/70 mb-1">Legal Full Name <span style={{ color: "#D4007A" }}>*</span></label>
                  <input type="text" value={idLegalName} onChange={e => setIdLegalName(e.target.value)} placeholder="As it appears on your ID" maxLength={255}
                    className="w-full rounded-lg px-3 py-2.5 text-sm text-white outline-none focus:ring-1"
                    style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)", caretColor: "#D4007A" }} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-white/70 mb-1">Date of Birth <span style={{ color: "#D4007A" }}>*</span></label>
                  <input type="date" value={idDob} onChange={e => setIdDob(e.target.value)}
                    max={new Date(Date.now() - 18 * 365.25 * 24 * 60 * 60 * 1000).toISOString().split("T")[0]}
                    className="w-full rounded-lg px-3 py-2.5 text-sm text-white outline-none focus:ring-1"
                    style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)", colorScheme: "dark" }} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-white/70 mb-1">ID Type <span style={{ color: "#D4007A" }}>*</span></label>
                  <select value={idType} onChange={e => setIdType(e.target.value)}
                    className="w-full rounded-lg px-3 py-2.5 text-sm text-white outline-none focus:ring-1"
                    style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)", colorScheme: "dark" }}>
                    <option value="">Select ID type…</option>
                    {ID_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-white/70 mb-1">ID Document Photo <span style={{ color: "#D4007A" }}>*</span></label>
                  <p className="text-xs mb-2" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>Clear photo of your ID. Max 10 MB. JPG, PNG, or WebP.</p>
                  <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp" onChange={e => setIdFile(e.target.files?.[0] || null)} className="hidden" />
                  <button type="button" onClick={() => fileInputRef.current?.click()}
                    className="w-full rounded-lg py-2.5 text-sm font-medium transition-colors"
                    style={{ background: "rgba(255,255,255,0.05)", border: "1px dashed rgba(255,255,255,0.2)", color: idFile ? "#5ED1C4" : "var(--pnp-text-secondary, #8E8E93)" }}>
                    {idFile ? idFile.name : "Tap to choose file"}
                  </button>
                </div>
                {idSubmitError && <p className="text-xs text-red-400 font-medium">{idSubmitError}</p>}
                <button onClick={handleSubmitIdentity} disabled={idSubmitting}
                  className="w-full py-3 rounded-xl text-sm font-bold text-white disabled:opacity-40"
                  style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}>
                  {idSubmitting ? "Submitting…" : "Submit for Verification"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <>
      <Helmet>
        <title>{isActive ? "Creator Setup" : "Become a Creator"} — Creator Studio — PNPtv!</title>
      </Helmet>

      <div className="p-4 lg:p-6 max-w-2xl mx-auto">

        {/* ════════════════════════════════════════════════════════════════════
            ACTIVE CREATOR — SETUP CHECKLIST HUB
            ════════════════════════════════════════════════════════════════ */}
        {isActive && (
          <>
            {/* Header */}
            <div className="flex items-start gap-3 mb-6">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 mt-0.5" style={{ background: "linear-gradient(135deg, rgba(212,0,122,0.2), rgba(230,145,56,0.2))", border: "1px solid rgba(212,0,122,0.3)" }}>
                <svg className="w-5 h-5" style={{ color: "#D4007A" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <h1 className="text-xl font-bold text-white">Creator Setup</h1>
                <p className="text-xs mt-0.5" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>
                  Complete these steps to unlock your full creator profile.
                </p>
              </div>
              {setupStatus && (
                <div className="text-right shrink-0">
                  <p className="text-2xl font-bold text-white leading-none">{setupStatus.completion_pct}%</p>
                  <p className="text-[10px] text-pnp-textSecondary mt-0.5">complete</p>
                </div>
              )}
            </div>

            {/* Progress bar */}
            {setupStatus && (
              <div className="mb-5">
                <div className="h-2 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.08)" }}>
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{
                      width: `${setupStatus.completion_pct}%`,
                      background: setupStatus.required_done
                        ? "linear-gradient(to right, #5ED1C4, #3BA89E)"
                        : "linear-gradient(to right, #D4007A, #E69138)",
                    }}
                  />
                </div>
                {setupStatus.required_done && !setupStatus.setup_complete && (
                  <p className="text-xs mt-2 font-medium" style={{ color: "#5ED1C4" }}>
                    All required steps complete! Finish the optional ones to make the most of your profile.
                  </p>
                )}
                {setupStatus.setup_complete && (
                  <p className="text-xs mt-2 font-medium" style={{ color: "#5ED1C4" }}>
                    Setup complete! Your creator profile is fully configured.
                  </p>
                )}
              </div>
            )}

            {/* Checklist */}
            {setupLoading && !setupStatus ? (
              <div className="animate-pulse space-y-3">
                {[1, 2, 3, 4, 5, 6].map(i => <div key={i} className="h-20 rounded-xl bg-white/5" />)}
              </div>
            ) : setupStatus ? (
              <div className="space-y-3">
                {setupStatus.items.map((item: CreatorSetupItem) => {
                  const meta = SETUP_META[item.key] || {};

                  return (
                    <div key={item.key} className="rounded-xl overflow-hidden" style={{ background: "rgba(255,255,255,0.04)", border: `1px solid ${item.done ? "rgba(94,209,196,0.2)" : item.required ? "rgba(212,0,122,0.2)" : "rgba(255,255,255,0.07)"}` }}>
                      {/* Item header */}
                      <div className="flex items-center gap-3 px-4 py-3.5">
                        <StatusIcon done={item.done} required={item.required} />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-white">{item.label}</p>
                          <p className="text-xs mt-0.5 leading-snug" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>{meta.description}</p>
                        </div>
                        <div className="shrink-0">
                          {item.done ? (
                            <span className="text-[10px] font-bold px-2 py-1 rounded-full" style={{ background: "rgba(94,209,196,0.15)", color: "#5ED1C4" }}>Done</span>
                          ) : item.status === "pending" ? (
                            <span className="text-[10px] font-bold px-2 py-1 rounded-full" style={{ background: "rgba(94,140,209,0.15)", color: "#5E8CD1" }}>In Review</span>
                          ) : item.required ? (
                            <span className="text-[10px] font-bold px-2 py-1 rounded-full" style={{ background: "rgba(212,0,122,0.12)", color: "#F472B6" }}>Required</span>
                          ) : (
                            <span className="text-[10px] font-bold px-2 py-1 rounded-full" style={{ background: "rgba(255,255,255,0.07)", color: "#8E8E93" }}>Optional</span>
                          )}
                        </div>
                      </div>

                      {/* Item action */}
                      {!item.done && item.status !== "pending" && (
                        <div className="px-4 pb-4">
                          {item.key === "identity" ? (
                            identityLoading ? (
                              <div className="h-10 rounded-xl bg-white/5 animate-pulse" />
                            ) : personaProcessing ? (
                              <div className="rounded-xl p-3 flex items-center gap-2" style={{ background: "rgba(94,140,209,0.08)", border: "1px solid rgba(94,140,209,0.3)" }}>
                                <svg className="w-4 h-4 animate-spin shrink-0" style={{ color: "#5E8CD1" }} fill="none" viewBox="0 0 24 24">
                                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                </svg>
                                <p className="text-xs" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>Verification submitted — confirming result…</p>
                              </div>
                            ) : inGrace ? (
                              <div className="rounded-xl p-3" style={{ background: "rgba(255,180,84,0.08)", border: "1px solid rgba(255,180,84,0.3)" }}>
                                <p className="text-xs font-semibold text-white mb-0.5">Grace period active</p>
                                <p className="text-xs" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>
                                  Verify before <strong className="text-white">{graceDeadline!.toLocaleDateString()}</strong> to stay active.
                                </p>
                                <div className="mt-3">{identity2257Form}</div>
                              </div>
                            ) : (
                              identity2257Form
                            )
                          ) : meta.href ? (
                            meta.external ? (
                              <a
                                href={meta.href}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl text-sm font-semibold text-white transition-all hover:opacity-90 btn-gradient"
                              >
                                {meta.actionLabel}
                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                                </svg>
                              </a>
                            ) : (
                              <button
                                onClick={() => navigate(meta.href!)}
                                className="w-full py-2.5 rounded-xl text-sm font-semibold text-white transition-all hover:opacity-90 btn-gradient"
                              >
                                {meta.actionLabel}
                              </button>
                            )
                          ) : null}
                        </div>
                      )}

                      {/* Pending in-review notice */}
                      {!item.done && item.status === "pending" && (
                        <div className="px-4 pb-4">
                          <p className="text-xs" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>
                            Under review by our team — typically 24–48 hours.
                          </p>
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* Back to dashboard link */}
                <div className="pt-2 text-center">
                  <button onClick={() => navigate("/creators")} className="text-xs underline" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>
                    ← Back to Dashboard
                  </button>
                </div>
              </div>
            ) : null}
          </>
        )}

        {/* ════════════════════════════════════════════════════════════════════
            NON-ACTIVE CREATOR — JOIN FLOW
            Gated on !loading to prevent flash of join flow for active creators.
            ════════════════════════════════════════════════════════════════ */}
        {loading && (
          <div className="animate-pulse space-y-4 mt-6">
            <div className="h-20 bg-white/5 rounded-xl" />
            <div className="h-32 bg-white/5 rounded-xl" />
            <div className="h-24 bg-white/5 rounded-xl" />
          </div>
        )}
        {!loading && !isActive && (
          <>
            {/* Hero */}
            <div className="text-center mb-8">
              <div className="w-20 h-20 rounded-full flex items-center justify-center text-4xl mx-auto mb-4" style={{ background: "linear-gradient(135deg, rgba(212,0,122,0.2), rgba(230,145,56,0.2))", border: "1px solid rgba(212,0,122,0.3)" }}>
                🎬
              </div>
              <h1 className="text-2xl font-bold text-white mb-2">Join the Creator Program</h1>
              <p className="text-sm leading-relaxed" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>
                Share exclusive content, build your subscriber base, and earn directly from your fans on PNPtv!
              </p>
            </div>

            {/* Perks */}
            <div className="glass-card-sm p-5 mb-4">
              <p className="text-sm font-semibold text-white mb-3">Why become a creator?</p>
              <ul className="space-y-2.5">
                {[
                  "Earn 70% of subscription revenue",
                  "Post exclusive content for subscribers",
                  "Go live and earn tips in real-time",
                  "Book private 1-on-1 video calls",
                  "Access detailed analytics and insights",
                  "Three creator tiers: Ice, Crystal, Diamond",
                ].map((perk) => (
                  <li key={perk} className="flex items-start gap-2.5 text-sm">
                    <span className="flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center mt-0.5" style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}>
                      <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                      </svg>
                    </span>
                    <span style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>{perk}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* 2257 section for non-active authenticated users */}
            {isAuthenticated && !identityLoading && (
              <>
                {idApproved && (
                  <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl mb-4 text-sm font-medium" style={{ background: "rgba(94,209,196,0.08)", border: "1px solid rgba(94,209,196,0.25)", color: "#5ED1C4" }}>
                    <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    Identity Verified (18 U.S.C. § 2257)
                  </div>
                )}

                {!idApproved && inGrace && (
                  <div className="rounded-xl p-4 mb-4 flex items-start gap-3" style={{ background: "rgba(255,180,84,0.08)", border: "1px solid rgba(255,180,84,0.3)" }}>
                    <svg className="w-5 h-5 flex-shrink-0 mt-0.5 shrink-0" style={{ color: "#FFB454" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                    </svg>
                    <div>
                      <p className="text-sm font-semibold text-white mb-1">Identity Verification Required</p>
                      <p className="text-xs leading-relaxed" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>
                        Complete 18 U.S.C. § 2257 verification by <strong className="text-white">{graceDeadline!.toLocaleDateString()}</strong>.
                      </p>
                    </div>
                  </div>
                )}

                {idPending && !idSubmitDone && (
                  <div className="rounded-xl p-4 mb-4 flex items-start gap-3" style={{ background: "rgba(94,140,209,0.08)", border: "1px solid rgba(94,140,209,0.3)" }}>
                    <svg className="w-5 h-5 flex-shrink-0 mt-0.5" style={{ color: "#5E8CD1" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <div>
                      <p className="text-sm font-semibold text-white mb-1">Identity Verification Under Review</p>
                      <p className="text-xs leading-relaxed" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>
                        Submitted and under review. Typically 24–48 hours.
                      </p>
                    </div>
                  </div>
                )}

                {personaProcessing && (
                  <div className="rounded-xl p-4 mb-4 flex items-start gap-3" style={{ background: "rgba(94,140,209,0.08)", border: "1px solid rgba(94,140,209,0.3)" }}>
                    <svg className="w-5 h-5 flex-shrink-0 mt-0.5 animate-spin" style={{ color: "#5E8CD1" }} fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    <div>
                      <p className="text-sm font-semibold text-white mb-1">Verification Submitted — Confirming</p>
                      <p className="text-xs leading-relaxed" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>
                        Waiting for result — usually under a minute.
                      </p>
                    </div>
                  </div>
                )}

                {!idApproved && !idPending && !inGrace && !personaProcessing && (
                  <div className="mb-4">{identity2257Form}</div>
                )}
              </>
            )}

            {/* Eligible — Activate */}
            {!loading && isEligible && (
              <div className="glass-card-sm p-5 mb-4" style={{ borderColor: "rgba(94,209,196,0.3)" }}>
                <p className="text-lg font-bold text-white mb-2">{t.eligibleTitle}</p>
                <p className="text-sm text-white/70 mb-4">{t.eligibleSubtitle}</p>
                {enrollBlocked && (
                  <div className="rounded-lg px-4 py-3 mb-4 text-xs" style={{ background: "rgba(212,0,122,0.08)", border: "1px solid rgba(212,0,122,0.25)", color: "#F9A8D4" }}>
                    Complete identity verification above before activating your creator account.
                  </div>
                )}
                <div className="space-y-3">
                  <div className="rounded-lg p-4" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-semibold text-white">❄ {t.iceCreatorLabel}</span>
                      <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: "rgba(94,209,196,0.15)", color: "#5ED1C4" }}>{t.iceStartingTier}</span>
                    </div>
                    <p className="text-xs mt-1 mb-3" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>{t.iceDesc}</p>
                    <button
                      onClick={() => { if (!enrollBlocked) setShowWizard(true); }}
                      disabled={enrollBlocked || idPending}
                      className="text-xs font-semibold px-4 py-2 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                      style={{ background: "linear-gradient(135deg, #D4007A, #E69138)", color: "#fff" }}
                    >
                      {t.activateAsCreatorBtn}
                    </button>
                  </div>
                  <div className="rounded-lg p-4" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}>
                    <p className="text-sm font-semibold text-white">{t.fullTimeCreatorLabel}</p>
                    <p className="text-xs mt-1 mb-3" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>{t.fullTimeDesc}</p>
                    <button
                      onClick={() => { if (!enrollBlocked) navigate("/apply"); }}
                      disabled={enrollBlocked || idPending}
                      className="text-xs font-semibold px-4 py-2 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                      style={{ background: "rgba(255,255,255,0.08)", color: "#fff", border: "1px solid rgba(255,255,255,0.2)" }}
                    >
                      {t.applyFullTimeBtn}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Pending Review */}
            {!loading && isPending && dashboard?.application && (
              <div className="glass-card-sm p-5 mb-4" style={{ borderColor: "rgba(255,180,84,0.3)" }}>
                <p className="text-lg font-bold text-white mb-2">{t.pendingTitle}</p>
                <div className="space-y-2 text-sm">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full" style={{ background: dashboard.application.call_scheduled ? "#5ED1C4" : "#FFB454" }} />
                    <span className="text-white/80">{dashboard.application.call_scheduled ? t.callScheduled : t.pendingReview}</span>
                  </div>
                  {!dashboard.application.call_scheduled && (
                    <a href="https://booking.pnptv.app/santino/model-interview" target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs font-semibold px-4 py-2 rounded-lg mt-2"
                      style={{ background: "linear-gradient(135deg, #D4007A, #E69138)", color: "#fff" }}>
                      {t.bookInterviewBtn}
                    </a>
                  )}
                </div>
              </div>
            )}

            {/* Not yet eligible */}
            {!loading && !isEligible && !isPending && isAuthenticated && eligibility && (() => {
              const criteria = [
                { label: t.criteriaMediaPosts, ...eligibility.criteria.mediaPosts },
                { label: t.criteriaTotalLikes, ...eligibility.criteria.totalLikes },
                { label: t.criteriaFollowers, ...eligibility.criteria.followers },
                { label: t.criteriaWeekly, ...eligibility.criteria.weeklyConsistency },
              ];
              const metCount = criteria.filter(c => c.met).length;
              const totalPct = Math.round(criteria.reduce((acc, c) => acc + Math.min(c.current / c.required, 1), 0) / criteria.length * 100);
              const closest = [...criteria].filter(c => !c.met).sort((a, b) => b.current / b.required - a.current / a.required)[0];
              return (
                <>
                  <div className="rounded-xl p-4 mb-4 flex items-start gap-3" style={{ background: "rgba(230,145,56,0.08)", border: "1px solid rgba(230,145,56,0.25)" }}>
                    <svg className="w-5 h-5 flex-shrink-0 mt-0.5" style={{ color: "#E69138" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
                    </svg>
                    <div>
                      <p className="text-sm font-semibold text-white mb-1">Share content to unlock the Creator Program</p>
                      <p className="text-xs leading-relaxed" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>
                        Post photos and videos, engage with others, and build your following. Meet all 4 criteria below.
                      </p>
                    </div>
                  </div>
                  <div className="glass-card-sm p-5 mb-4">
                    <div className="flex items-start justify-between mb-1">
                      <p className="text-lg font-bold text-white">{t.becomeCreatorTitle}</p>
                      <span className="text-sm font-bold" style={{ color: totalPct >= 75 ? "#5ED1C4" : "#E69138" }}>{totalPct}%</span>
                    </div>
                    <p className="text-sm mb-1" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>
                      {metCount === 0 ? t.noCriteriaMet : metCount < criteria.length ? t.someCriteriaMet(metCount, criteria.length) : ""}
                    </p>
                    {closest && !closest.met && (
                      <p className="text-xs mb-4 font-medium" style={{ color: "#E69138" }}>
                        {t.closestHint(closest.label, closest.required - closest.current)}
                      </p>
                    )}
                    <CriterionBar label={t.criteriaMediaPosts} {...eligibility.criteria.mediaPosts} />
                    <CriterionBar label={t.criteriaTotalLikes} {...eligibility.criteria.totalLikes} />
                    <CriterionBar label={t.criteriaFollowers} {...eligibility.criteria.followers} />
                    <CriterionBar label={t.criteriaWeekly} {...eligibility.criteria.weeklyConsistency} />
                    <p className="text-xs mt-4 text-center" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>{t.progressFootnote}</p>
                  </div>
                  <div className="text-center">
                    <button onClick={() => navigate("/social")} className="inline-flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-bold text-white" style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}>
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
                      Start Sharing Content
                    </button>
                  </div>
                </>
              );
            })()}

            {!isAuthenticated && (
              <div className="glass-card-sm p-6 text-center space-y-3">
                <p className="text-sm font-semibold text-white">Sign in to check your eligibility</p>
                <p className="text-xs" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>
                  Connect your account to see your progress toward becoming a creator.
                </p>
                <button onClick={() => navigate("/")} className="px-6 py-3 rounded-xl text-sm font-bold text-white" style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}>
                  Sign In
                </button>
              </div>
            )}
          </>
        )}

        {/* ── Enrollment Wizard ── */}
        {showWizard && (
          <CreatorEnrollmentWizard
            tier="ice"
            onClose={() => setShowWizard(false)}
            onSubmitted={async () => {
              setShowWizard(false);
              await reload();
              navigate("/creators", { replace: true });
            }}
          />
        )}
      </div>
    </>
  );
}
