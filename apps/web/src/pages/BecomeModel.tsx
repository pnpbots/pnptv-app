import React, { useEffect, useState } from "react";
import { Helmet } from "react-helmet-async";
import { useNavigate } from "react-router-dom";
import { Card } from "@pnptv/ui-kit";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/hooks/useAuth";
import { get2257Status } from "@/lib/api";

const STEPS = [
  { icon: "👤", key: "processStep1" },
  { icon: "🏅", key: "processStep2" },
  { icon: "❄️", key: "processStep3" },
  { icon: "📝", key: "processStep4" },
  { icon: "🎥", key: "processStep5" },
  { icon: "🔴", key: "processStep6" },
] as const;

export default function BecomeModel() {
  const { becomeModel: t } = useI18n();
  const { isAuthenticated, user } = useAuth();
  const navigate = useNavigate();

  const isCreator = user?.role === "model" || user?.role === "admin" || user?.role === "superadmin";
  const isActiveTierCreator = user?.creator_status === "active" && ["ice", "crystal", "diamond"].includes(user?.creator_type || "");

  const [idVerified, setIdVerified] = useState<boolean | null>(null);
  const [idRecordStatus, setIdRecordStatus] = useState<string | null>(null);

  useEffect(() => {
    if (!isAuthenticated) return;
    get2257Status()
      .then((res) => {
        setIdVerified(res.identity_verified);
        setIdRecordStatus(res.record?.verification_status || null);
      })
      .catch(() => {
        setIdVerified(null);
        setIdRecordStatus(null);
      });
  }, [isAuthenticated]);

  const needsIdentityVerification =
    isAuthenticated &&
    idVerified !== null &&
    !idVerified &&
    idRecordStatus !== "approved" &&
    idRecordStatus !== "pending";

  return (
    <div className="page-container max-w-3xl mx-auto px-4 py-8 space-y-10">
      <Helmet>
        <title>{t.pageTitle}</title>
        <meta name="description" content={t.pageDescription} />
      </Helmet>

      {/* Hero */}
      <div className="text-center space-y-3">
        <h1 className="text-3xl font-bold text-gradient">{t.heading}</h1>
        <p className="text-sm text-pnp-textSecondary max-w-lg mx-auto">{t.subtitle}</p>
      </div>

      {/* Intro */}
      <Card>
        <h2 className="text-lg font-bold text-pnp-textPrimary mb-2">{t.introTitle}</h2>
        <p className="text-sm text-pnp-textSecondary leading-relaxed">{t.introBody}</p>
      </Card>

      {/* Step 0: Identity Verification — shown only when needed */}
      {needsIdentityVerification && (
        <Card>
          <div className="flex items-start gap-3">
            <div
              className="flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center text-lg"
              style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
            >
              🪪
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-bold text-pnp-accent">00</span>
                <h3 className="text-sm font-bold text-pnp-textPrimary">Verify Your Identity First</h3>
              </div>
              <p className="text-xs text-pnp-textSecondary leading-relaxed mb-3">
                Federal law (18 U.S.C. § 2257) requires all adult content platforms to verify creator age and identity.
                This is a one-time step — your information is stored securely and used only for compliance.{" "}
                <a href="/2257" target="_blank" rel="noopener noreferrer" className="underline text-pnp-accent">
                  View our 2257 statement
                </a>
              </p>
              <button
                onClick={() => navigate("/creators/apply")}
                className="text-xs font-semibold px-4 py-2 rounded-lg text-white"
                style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
              >
                Start Identity Verification
              </button>
            </div>
          </div>
        </Card>
      )}

      {/* Process Steps */}
      <section className="space-y-4">
        <h2 className="text-xl font-bold text-pnp-textPrimary">{t.processTitle}</h2>
        <div className="space-y-3">
          {STEPS.map((step, i) => {
            const title = t[`${step.key}Title` as keyof typeof t] as string;
            const body = t[`${step.key}Body` as keyof typeof t] as string;
            return (
              <Card key={step.key}>
                <div className="flex gap-4">
                  <div className="flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center text-lg" style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}>
                    {step.icon}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-bold text-pnp-accent">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <h3 className="text-sm font-bold text-pnp-textPrimary">{title}</h3>
                    </div>
                    <p className="text-xs text-pnp-textSecondary leading-relaxed">{body}</p>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      </section>

      {/* Milestones */}
      <section className="space-y-4">
        <h2 className="text-xl font-bold text-pnp-textPrimary">{t.milestonesTitle}</h2>
        <p className="text-sm text-pnp-textSecondary">{t.milestonesBody}</p>
        <div className="grid gap-3 sm:grid-cols-3">
          {([
            { title: t.milestoneSafeTitle, body: t.milestoneSafeBody, icon: "🛡️" },
            { title: t.milestoneEngagementTitle, body: t.milestoneEngagementBody, icon: "💬" },
            { title: t.milestoneTippingTitle, body: t.milestoneTippingBody, icon: "💝" },
          ]).map((m) => (
            <Card key={m.title}>
              <div className="text-center space-y-2">
                <span className="text-2xl">{m.icon}</span>
                <h3 className="text-sm font-bold text-pnp-textPrimary">{m.title}</h3>
                <p className="text-xs text-pnp-textSecondary leading-relaxed">{m.body}</p>
              </div>
            </Card>
          ))}
        </div>
      </section>

      {/* Perks */}
      <section className="space-y-4">
        <h2 className="text-xl font-bold text-pnp-textPrimary">{t.perksTitle}</h2>
        <Card>
          <ul className="space-y-2.5">
            {[t.perk1, t.perk2, t.perk3, t.perk4, t.perk5, t.perk6, t.perk7].map((perk) => (
              <li key={perk} className="flex items-start gap-2.5 text-sm">
                <span className="flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center mt-0.5" style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}>
                  <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                </span>
                <span className="text-pnp-textSecondary">{perk}</span>
              </li>
            ))}
          </ul>
        </Card>
      </section>

      {/* Requirements */}
      <section className="space-y-4">
        <h2 className="text-xl font-bold text-pnp-textPrimary">{t.requirementsTitle}</h2>
        <Card>
          <ol className="space-y-2 list-decimal list-inside">
            {[t.req1, t.req2, t.req3, t.req4, t.req5].map((req) => (
              <li key={req} className="text-sm text-pnp-textSecondary">{req}</li>
            ))}
          </ol>
        </Card>
      </section>

      {/* CTA */}
      <section className="text-center space-y-4 py-4">
        <h2 className="text-xl font-bold text-pnp-textPrimary">{t.ctaReady}</h2>
        <p className="text-sm text-pnp-textSecondary max-w-md mx-auto">{t.ctaBody}</p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <button
            onClick={() => navigate(isAuthenticated ? (isActiveTierCreator ? "/apply" : "/creator") : "/join")}
            className="px-8 py-3 rounded-xl text-sm font-bold text-white btn-gradient hover:opacity-90 active:scale-[0.98] transition-all"
          >
            {isAuthenticated && !isActiveTierCreator ? t.ctaButtonEnroll : t.ctaButton}
          </button>
          {isCreator && (
            <button
              onClick={() => navigate("/creator")}
              className="px-6 py-3 rounded-xl text-sm font-medium text-pnp-textSecondary border border-pnp-border hover:border-pnp-accent/40 transition-colors"
            >
              {t.ctaCreatorDashboard}
            </button>
          )}
        </div>
        {isCreator && (
          <p className="text-xs text-pnp-textSecondary">{t.ctaAlreadyMember}</p>
        )}
      </section>

      {/* Disclaimer */}
      <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/5 p-5 space-y-2">
        <div className="flex items-center gap-2">
          <svg className="w-5 h-5 text-yellow-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <h3 className="text-sm font-bold text-yellow-500">{t.disclaimerTitle}</h3>
        </div>
        <p className="text-xs text-pnp-textSecondary leading-relaxed">{t.disclaimerBody}</p>
      </div>
    </div>
  );
}
