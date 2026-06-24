import React, { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/lib/i18n";
import {
  getProfile,
  getBlockedUsers,
  unblockUser,
  acceptTerms,
  type BlockedUser,
} from "@/lib/api";

// ── PrivacySettings ───────────────────────────────────────────────────────────

export default function PrivacySettings() {
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();
  const t = useI18n();
  const p = t.profile;

  const [blockedUsers, setBlockedUsers] = useState<BlockedUser[]>([]);
  const [blockedLoading, setBlockedLoading] = useState(true);
  const [unblockingId, setUnblockingId] = useState<string | null>(null);
  const [creatorStatus, setCreatorStatus] = useState<string>("");
  const [expandedAgreement, setExpandedAgreement] = useState<string | null>(null);
  const [termsAccepted, setTermsAccepted] = useState<boolean | null>(null);
  const [reconfirming, setReconfirming] = useState(false);
  const [reconfirmed, setReconfirmed] = useState(false);

  useEffect(() => {
    if (!isAuthenticated) return;
    let cancelled = false;
    setBlockedLoading(true);

    Promise.all([
      getBlockedUsers().catch(() => null),
      getProfile().catch(() => null),
    ]).then(([blockedRes, profileRes]) => {
      if (cancelled) return;
      if (blockedRes?.success) setBlockedUsers(blockedRes.blockedUsers);
      if (profileRes?.profile) {
        setCreatorStatus(profileRes.profile.creatorStatus ?? "");
        setTermsAccepted(profileRes.profile.acceptedTerms ?? null);
      }
      setBlockedLoading(false);
    });

    return () => { cancelled = true; };
  }, [isAuthenticated]);

  const handleReconfirm = useCallback(async () => {
    if (reconfirming || reconfirmed) return;
    setReconfirming(true);
    try {
      await acceptTerms();
      setTermsAccepted(true);
      setReconfirmed(true);
    } catch { /* silent */ }
    setReconfirming(false);
  }, [reconfirming, reconfirmed]);

  const handleUnblock = useCallback(async (userId: string) => {
    if (unblockingId) return;
    setUnblockingId(userId);
    try {
      await unblockUser(userId);
      setBlockedUsers((prev) => prev.filter((u) => u.id !== userId));
    } catch { /* silent */ }
    setUnblockingId(null);
  }, [unblockingId]);

  return (
    <div className="space-y-4">
      {/* ── Data & Privacy statement ── */}
      <div className="glass-card-sm p-5">
        <h2 className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-4">
          {p.dataPrivacySection}
        </h2>
        <div
          className="rounded-xl p-4"
          style={{ background: "rgba(94,209,196,0.05)", border: "1px solid rgba(94,209,196,0.15)" }}
        >
          <div className="flex items-start gap-3">
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
              style={{ background: "rgba(94,209,196,0.15)" }}
            >
              <svg className="w-4 h-4" style={{ color: "#5ED1C4" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-semibold text-white mb-1">{p.dataPrivacyTitle}</p>
              <p className="text-xs leading-relaxed" style={{ color: "rgba(255,255,255,0.6)" }}>
                {p.dataPrivacyBody}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* ── Blocked Users ── */}
      <div className="glass-card-sm p-5">
        <h2 className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-4">
          Blocked Users
        </h2>
        {blockedLoading ? (
          <div className="space-y-3">
            <div className="h-12 rounded-lg animate-pulse" style={{ background: "rgba(255,255,255,0.05)" }} />
            <div className="h-12 rounded-lg animate-pulse" style={{ background: "rgba(255,255,255,0.05)" }} />
          </div>
        ) : blockedUsers.length === 0 ? (
          <div className="text-center py-4">
            <svg className="w-8 h-8 mx-auto mb-2" style={{ color: "var(--pnp-text-secondary)" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
            </svg>
            <p className="text-sm" style={{ color: "var(--pnp-text-secondary)" }}>No blocked users</p>
          </div>
        ) : (
          <div className="space-y-2">
            {blockedUsers.map((u) => {
              const photo = u.photoUrl && (u.photoUrl.startsWith("/") || u.photoUrl.startsWith("http")) ? u.photoUrl : null;
              const initial = (u.firstName || u.username || "?")[0].toUpperCase();
              return (
                <div
                  key={u.id}
                  className="flex items-center gap-3 rounded-lg px-3 py-2.5"
                  style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
                >
                  <button onClick={() => navigate(`/profile/${u.id}`)} className="flex-shrink-0" aria-label={`View ${u.firstName || u.username}'s profile`}>
                    {photo ? (
                      <img src={photo} alt={u.firstName} className="w-9 h-9 rounded-full object-cover" />
                    ) : (
                      <div
                        className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold"
                        style={{ background: "linear-gradient(135deg, #D4007A, #E69138)", color: "#fff" }}
                      >
                        {initial}
                      </div>
                    )}
                  </button>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-white truncate">{u.firstName || u.username}</p>
                    {u.username && (
                      <p className="text-xs truncate" style={{ color: "var(--pnp-text-secondary)" }}>@{u.username}</p>
                    )}
                  </div>
                  <button
                    onClick={() => handleUnblock(u.id)}
                    disabled={unblockingId === u.id}
                    className="text-xs px-3 py-1.5 rounded-lg flex-shrink-0 disabled:opacity-50 transition-colors"
                    style={{ background: "rgba(255,59,48,0.12)", color: "#FF453A", border: "1px solid rgba(255,59,48,0.25)" }}
                  >
                    {unblockingId === u.id ? "..." : "Unblock"}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Consents & Agreements ── */}
      <div className="glass-card-sm p-5">
        <h2 className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-4">
          {p.consentsSection}
        </h2>

        {/* Platform TOS */}
        <a
          href="/terms"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-between rounded-lg px-3 py-3 mb-3 group"
          style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", textDecoration: "none" }}
        >
          <div className="flex items-center gap-2 min-w-0">
            <p className="text-sm font-medium text-white">{p.platformTOS}</p>
            {termsAccepted === true && (
              <span className="text-xs font-medium px-1.5 py-0.5 rounded-full flex-shrink-0" style={{ background: "rgba(74,222,128,0.12)", color: "#4ADE80" }}>Accepted</span>
            )}
            {termsAccepted === false && (
              <span className="text-xs font-medium px-1.5 py-0.5 rounded-full flex-shrink-0" style={{ background: "rgba(251,191,36,0.12)", color: "#FBBF24" }}>Pending</span>
            )}
          </div>
          <svg className="w-4 h-4 flex-shrink-0 opacity-50 group-hover:opacity-100 transition-opacity ml-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} style={{ color: "var(--pnp-text-secondary)" }} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
          </svg>
        </a>

        {/* Privacy Policy */}
        <a
          href="/privacy"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-between rounded-lg px-3 py-3 mb-3 group"
          style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", textDecoration: "none" }}
        >
          <div className="flex items-center gap-2 min-w-0">
            <p className="text-sm font-medium text-white">{p.privacyPolicy}</p>
            {termsAccepted === true && (
              <span className="text-xs font-medium px-1.5 py-0.5 rounded-full flex-shrink-0" style={{ background: "rgba(74,222,128,0.12)", color: "#4ADE80" }}>Accepted</span>
            )}
            {termsAccepted === false && (
              <span className="text-xs font-medium px-1.5 py-0.5 rounded-full flex-shrink-0" style={{ background: "rgba(251,191,36,0.12)", color: "#FBBF24" }}>Pending</span>
            )}
          </div>
          <svg className="w-4 h-4 flex-shrink-0 opacity-50 group-hover:opacity-100 transition-opacity ml-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} style={{ color: "var(--pnp-text-secondary)" }} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
          </svg>
        </a>

        {/* Re-confirm agreements */}
        {reconfirmed ? (
          <div className="flex items-center justify-center gap-2 rounded-lg px-3 py-2.5 mb-3" style={{ background: "rgba(74,222,128,0.08)", border: "1px solid rgba(74,222,128,0.2)" }}>
            <svg className="w-4 h-4 flex-shrink-0" style={{ color: "#4ADE80" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
            <span className="text-sm font-medium" style={{ color: "#4ADE80" }}>Agreements re-confirmed</span>
          </div>
        ) : (
          <button
            onClick={handleReconfirm}
            disabled={reconfirming}
            className="w-full flex items-center justify-center gap-2 rounded-lg px-3 py-2.5 mb-3 text-sm font-medium disabled:opacity-50 transition-opacity hover:opacity-80"
            style={{ background: "rgba(212,0,122,0.08)", border: "1px solid rgba(212,0,122,0.2)", color: "#D4007A" }}
          >
            {reconfirming ? (
              <span>Confirming…</span>
            ) : (
              <>
                <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
                </svg>
                <span>Re-confirm all agreements</span>
              </>
            )}
          </button>
        )}

        {/* Creator Program Terms */}
        {(() => {
          const isEnrolled = creatorStatus === "active" || creatorStatus === "pending_review";
          const isExpanded = expandedAgreement === "creator-program";
          return (
            <div className="rounded-lg mb-3 overflow-hidden" style={{ border: "1px solid rgba(212,0,122,0.2)", background: "rgba(212,0,122,0.04)" }}>
              <button
                onClick={() => isEnrolled ? setExpandedAgreement(isExpanded ? null : "creator-program") : undefined}
                className={`w-full flex items-center justify-between px-3 py-3 ${isEnrolled ? "cursor-pointer" : "cursor-default"}`}
              >
                <p className="text-sm font-medium text-white text-left">{p.creatorProgramAgreement}</p>
                <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                  {creatorStatus === "active" && (
                    <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ background: "rgba(74,222,128,0.15)", color: "#4ADE80" }}>{p.agreementAccepted}</span>
                  )}
                  {creatorStatus === "pending_review" && (
                    <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ background: "rgba(251,191,36,0.15)", color: "#FBBF24" }}>{p.agreementUnderReview}</span>
                  )}
                  {!isEnrolled && (
                    <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ background: "rgba(255,255,255,0.06)", color: "var(--pnp-text-secondary)" }}>{p.agreementNotEnrolled}</span>
                  )}
                  {isEnrolled && (
                    <svg className={`w-4 h-4 transition-transform duration-200 ${isExpanded ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} style={{ color: "var(--pnp-text-secondary)" }} aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  )}
                </div>
              </button>
              {isEnrolled && isExpanded && (
                <div className="px-3 pb-3 text-xs space-y-2" style={{ color: "var(--pnp-text-secondary)", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                  <p className="pt-2">{p.programTermsBody}</p>
                  <p>{p.programTermsBody2}</p>
                  <p>{p.programTermsBody3}</p>
                </div>
              )}
              {!isEnrolled && (
                <div className="px-3 pb-3">
                  <button
                    onClick={() => {
                      try { localStorage.setItem("pnp:creator-interest", "1"); } catch { /* ignore */ }
                      navigate("/profile");
                    }}
                    className="w-full py-2 rounded-lg text-xs font-semibold text-white transition-opacity hover:opacity-90"
                    style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
                  >
                    {p.startEnrollmentCTA}
                  </button>
                </div>
              )}
            </div>
          );
        })()}

        {/* Payout Terms */}
        {(() => {
          const isExpanded = expandedAgreement === "payout-terms";
          return (
            <div className="rounded-lg mb-3 overflow-hidden" style={{ border: "1px solid rgba(94,209,196,0.2)", background: "rgba(94,209,196,0.04)" }}>
              <button
                onClick={() => setExpandedAgreement(isExpanded ? null : "payout-terms")}
                className="w-full flex items-center justify-between px-3 py-3 cursor-pointer"
              >
                <p className="text-sm font-medium text-white text-left">{p.payoutTermsAgreement}</p>
                <svg className={`w-4 h-4 transition-transform duration-200 flex-shrink-0 ml-2 ${isExpanded ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} style={{ color: "var(--pnp-text-secondary)" }} aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {isExpanded && (
                <div className="px-3 pb-3 text-xs space-y-1.5" style={{ color: "var(--pnp-text-secondary)", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                  <p className="pt-2">{p.youReceive70}</p>
                  <p>{p.payoutsEveryTuesday}</p>
                  <p>{p.minimumPayout}</p>
                </div>
              )}
            </div>
          );
        })()}

        {/* Content Requirements */}
        {(() => {
          const isExpanded = expandedAgreement === "content-req";
          return (
            <div className="rounded-lg overflow-hidden" style={{ border: "1px solid rgba(255,180,84,0.2)", background: "rgba(255,180,84,0.04)" }}>
              <button
                onClick={() => setExpandedAgreement(isExpanded ? null : "content-req")}
                className="w-full flex items-center justify-between px-3 py-3 cursor-pointer"
              >
                <p className="text-sm font-medium text-white text-left">{p.contentRequirementsAgreement}</p>
                <svg className={`w-4 h-4 transition-transform duration-200 flex-shrink-0 ml-2 ${isExpanded ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} style={{ color: "var(--pnp-text-secondary)" }} aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {isExpanded && (
                <div className="px-3 pb-3 text-xs space-y-1.5" style={{ color: "var(--pnp-text-secondary)", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                  <p className="pt-2">{p.contentReqBody}</p>
                  <ul className="list-disc list-inside space-y-0.5 mt-1">
                    <li>{p.contentReqItem1}</li>
                    <li>{p.contentReqItem2}</li>
                    <li>{p.contentReqItem3}</li>
                    <li>{p.contentReqItem4}</li>
                  </ul>
                  <p className="mt-1">{p.contentReqDisclaimer}</p>
                </div>
              )}
            </div>
          );
        })()}
      </div>

      {/* ── Back to settings ── */}
      <button
        onClick={() => navigate("/settings")}
        className="w-full py-3 rounded-xl text-sm font-medium transition-colors hover:text-white"
        style={{ color: "var(--pnp-text-secondary)", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}
      >
        {p.back}
      </button>
    </div>
  );
}
