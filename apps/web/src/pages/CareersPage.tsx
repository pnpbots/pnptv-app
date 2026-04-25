import React, { useState } from "react";
import { Helmet } from "react-helmet-async";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { careers } from "@/lib/i18n/careers";

type Lang = "en" | "es";

function getStrings() {
  const lang: Lang = navigator.language?.startsWith("es") ? "es" : "en";
  return { t: careers[lang], lang };
}

export default function CareersPage() {
  const { t } = getStrings();
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [expandedRole, setExpandedRole] = useState<number | null>(null);

  return (
    <>
      <Helmet>
        <title>{t.pageTitle}</title>
        <meta name="description" content={t.pageDescription} />
        <meta property="og:title" content={t.pageTitle} />
        <meta property="og:description" content={t.pageDescription} />
        <meta property="og:type" content="website" />
      </Helmet>

      <div className="min-h-screen" style={{ background: "var(--pnp-background, #0A0A0B)", color: "#fff" }}>
        {/* Top bar */}
        <div
          className="sticky top-0 z-50 flex items-center justify-between gap-3 px-4 py-3"
          style={{
            background: "rgba(10,10,11,0.92)",
            backdropFilter: "blur(12px)",
            borderBottom: "1px solid rgba(255,255,255,0.06)",
          }}
        >
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate(-1)}
              className="text-white/60 hover:text-white transition-colors"
              aria-label="Go back"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <Link to="/" className="flex items-center gap-1.5">
              <span className="text-sm font-black text-white">PNPtv</span>
              <span className="text-sm font-black" style={{ color: "#D4007A" }}>!</span>
            </Link>
          </div>
          {!isAuthenticated && (
            <div className="flex items-center gap-2">
              <Link
                to="/auth"
                className="text-xs font-medium text-white/70 hover:text-white transition-colors px-3 py-1.5 rounded-lg border border-white/10 hover:border-white/20"
              >
                Log In
              </Link>
              <Link
                to="/join"
                className="text-xs font-semibold text-white px-3 py-1.5 rounded-lg"
                style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
              >
                Join Free
              </Link>
            </div>
          )}
        </div>

        {/* Hero */}
        <div className="relative overflow-hidden text-center px-4 pt-10 pb-8">
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              background:
                "radial-gradient(ellipse 80% 50% at 50% 0%, rgba(230,145,56,0.12) 0%, transparent 70%)",
            }}
          />
          <div className="relative">
            <div className="inline-flex items-center gap-2 mb-3 px-3 py-1.5 rounded-full border" style={{ background: "rgba(230,145,56,0.1)", borderColor: "rgba(230,145,56,0.3)" }}>
              <span className="w-1.5 h-1.5 rounded-full bg-[#E69138] animate-pulse" />
              <span className="text-[#E69138] text-xs font-semibold">Now Hiring</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-black text-white mb-3">{t.pageHeading}</h1>
            <p className="text-sm text-white/60 max-w-md mx-auto leading-relaxed">{t.pageSubtitle}</p>
          </div>
        </div>

        <div className="max-w-4xl mx-auto px-4 pb-16 space-y-12">

          {/* Culture */}
          <section>
            <h2 className="text-xl font-bold text-white mb-5">{t.cultureTitle}</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {t.cultureItems.map((item) => (
                <div
                  key={item.title}
                  className="rounded-xl border p-4 transition-colors hover:border-white/15"
                  style={{
                    background: "rgba(255,255,255,0.04)",
                    borderColor: "rgba(255,255,255,0.08)",
                  }}
                >
                  <div className="text-2xl mb-2">{item.icon}</div>
                  <h3 className="text-sm font-bold text-white mb-1">{item.title}</h3>
                  <p className="text-xs text-white/55 leading-relaxed">{item.body}</p>
                </div>
              ))}
            </div>
          </section>

          {/* Open Roles */}
          <section>
            <h2 className="text-xl font-bold text-white mb-1">{t.openRolesTitle}</h2>
            <p className="text-sm text-white/45 mb-5">{t.openRolesSubtitle}</p>

            <div className="space-y-4">
              {t.roles.map((role, index) => {
                const isExpanded = expandedRole === index;
                return (
                  <div
                    key={role.title}
                    className="rounded-2xl border transition-all duration-300 overflow-hidden"
                    style={{
                      background: isExpanded
                        ? "rgba(255,255,255,0.06)"
                        : "rgba(255,255,255,0.03)",
                      borderColor: isExpanded
                        ? "rgba(212,0,122,0.3)"
                        : "rgba(255,255,255,0.08)",
                    }}
                  >
                    <button
                      className="w-full text-left p-5 sm:p-6"
                      onClick={() => setExpandedRole(isExpanded ? null : index)}
                      aria-expanded={isExpanded}
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <h3 className="text-base font-bold text-white mb-1">{role.title}</h3>
                          <div className="flex items-center gap-2">
                            <span
                              className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border"
                              style={{
                                background: "rgba(212,0,122,0.1)",
                                borderColor: "rgba(212,0,122,0.3)",
                                color: "#D4007A",
                              }}
                            >
                              {role.type}
                            </span>
                          </div>
                          {!isExpanded && (
                            <p className="text-xs text-white/50 mt-2 leading-relaxed line-clamp-2">
                              {role.description}
                            </p>
                          )}
                        </div>
                        <div
                          className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center transition-all duration-300 mt-0.5"
                          style={{ background: "rgba(255,255,255,0.06)" }}
                        >
                          <svg
                            className={`w-4 h-4 text-white/40 transition-transform duration-300 ${isExpanded ? "rotate-180" : ""}`}
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={2}
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                          </svg>
                        </div>
                      </div>
                    </button>

                    {isExpanded && (
                      <div
                        className="px-5 sm:px-6 pb-6 border-t space-y-5"
                        style={{ borderColor: "rgba(255,255,255,0.06)" }}
                      >
                        <p className="text-sm leading-relaxed mt-5" style={{ color: "rgba(255,255,255,0.70)" }}>
                          {role.description}
                        </p>

                        <div>
                          <h4 className="text-xs font-bold text-white/80 uppercase tracking-wider mb-3">
                            {t.requirementsTitle}
                          </h4>
                          <ul className="space-y-2">
                            {role.requirements.map((req, ri) => (
                              <li key={ri} className="flex items-start gap-2.5">
                                <span
                                  className="flex-shrink-0 w-4 h-4 rounded-full flex items-center justify-center mt-0.5 text-[10px] font-bold"
                                  style={{ background: "rgba(212,0,122,0.2)", color: "#D4007A" }}
                                >
                                  ✓
                                </span>
                                <span className="text-xs text-white/60 leading-relaxed">{req}</span>
                              </li>
                            ))}
                          </ul>
                        </div>

                        <a
                          href={`mailto:${role.applyEmail}?subject=${encodeURIComponent(role.applySubject)}`}
                          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-90"
                          style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                          </svg>
                          {t.openRoleApplyCta}
                        </a>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          {/* General / No role found */}
          <section
            className="rounded-2xl border p-6 sm:p-8 text-center"
            style={{
              background: "rgba(230,145,56,0.05)",
              borderColor: "rgba(230,145,56,0.2)",
            }}
          >
            <div
              className="w-12 h-12 rounded-2xl flex items-center justify-center text-2xl mx-auto mb-4"
              style={{ background: "rgba(230,145,56,0.15)" }}
            >
              💌
            </div>
            <h2 className="text-lg font-bold text-white mb-2">{t.generalTitle}</h2>
            <p className="text-sm text-white/60 mb-5 max-w-sm mx-auto leading-relaxed">{t.generalBody}</p>
            <a
              href={`mailto:${t.generalEmail}`}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white border transition-colors hover:bg-white/5"
              style={{ borderColor: "rgba(230,145,56,0.4)", color: "#E69138" }}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
              {t.generalCta}
            </a>
          </section>
        </div>

        {/* Mini footer */}
        <div
          className="border-t px-4 py-8 text-center"
          style={{ borderColor: "rgba(255,255,255,0.06)" }}
        >
          <p className="text-xs mb-3" style={{ color: "rgba(255,255,255,0.25)" }}>
            &copy; 2026 PNPtv!
          </p>
          <div className="flex flex-wrap justify-center gap-x-4 gap-y-1">
            {[
              { href: "/terms", label: "Terms" },
              { href: "/privacy", label: "Privacy" },
              { href: "/safety", label: "Safety" },
            ].map(({ href, label }) => (
              <Link
                key={href}
                to={href}
                className="text-xs hover:underline transition-colors"
                style={{ color: "rgba(255,255,255,0.3)" }}
              >
                {label}
              </Link>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
