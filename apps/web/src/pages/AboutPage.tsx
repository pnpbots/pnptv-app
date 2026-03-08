import React from "react";
import { Helmet } from "react-helmet-async";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { about } from "@/lib/i18n/about";

type Lang = "en" | "es";

function getStrings() {
  const lang: Lang = navigator.language?.startsWith("es") ? "es" : "en";
  return { t: about[lang], lang };
}

export default function AboutPage() {
  const { t } = getStrings();
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();

  return (
    <>
      <Helmet>
        <title>{t.pageTitle}</title>
        <meta name="description" content={t.pageDescription} />
        <meta property="og:title" content={t.pageTitle} />
        <meta property="og:description" content={t.pageDescription} />
        <meta property="og:type" content="website" />
      </Helmet>

      <div className="min-h-screen" style={{ background: "#0A0A0B", color: "#fff" }}>
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
        <div className="relative overflow-hidden text-center px-4 pt-12 pb-10">
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              background:
                "radial-gradient(ellipse 80% 60% at 50% 0%, rgba(212,0,122,0.14) 0%, transparent 70%)",
            }}
          />
          <div className="relative">
            <div className="inline-flex items-center gap-1 mb-4">
              <span className="text-4xl font-black text-white">PNPtv</span>
              <span className="text-4xl font-black" style={{ color: "#D4007A" }}>!</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold text-white mb-3">{t.pageHeading}</h1>
            <p className="text-base text-white/60 max-w-lg mx-auto leading-relaxed">{t.pageSubtitle}</p>
          </div>
        </div>

        <div className="max-w-4xl mx-auto px-4 pb-16 space-y-12">
          {/* Mission */}
          <section>
            <h2 className="text-xl font-bold text-white mb-4">{t.missionTitle}</h2>
            <div
              className="rounded-2xl p-6 border"
              style={{
                background: "rgba(212,0,122,0.06)",
                borderColor: "rgba(212,0,122,0.2)",
              }}
            >
              <p className="text-sm leading-relaxed" style={{ color: "rgba(255,255,255,0.75)" }}>
                {t.missionBody}
              </p>
            </div>
          </section>

          {/* What we offer */}
          <section>
            <h2 className="text-xl font-bold text-white mb-4">{t.whatWeOfferTitle}</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {t.features.map((feature) => (
                <div
                  key={feature.name}
                  className="rounded-xl p-4 border transition-colors hover:border-white/15"
                  style={{
                    background: "rgba(255,255,255,0.04)",
                    borderColor: "rgba(255,255,255,0.08)",
                  }}
                >
                  <div className="flex items-start gap-3">
                    <span className="text-2xl flex-shrink-0 mt-0.5">{feature.icon}</span>
                    <div>
                      <h3 className="text-sm font-bold text-white mb-1">{feature.name}</h3>
                      <p className="text-xs text-white/55 leading-relaxed">{feature.description}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Values */}
          <section>
            <h2 className="text-xl font-bold text-white mb-4">{t.valuesTitle}</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {t.values.map((value, i) => {
                const gradients = [
                  "from-[#D4007A]/20 to-[#D4007A]/5",
                  "from-green-500/20 to-green-500/5",
                  "from-[#E69138]/20 to-[#E69138]/5",
                  "from-purple-500/20 to-purple-500/5",
                ];
                const borderColors = [
                  "rgba(212,0,122,0.25)",
                  "rgba(34,197,94,0.25)",
                  "rgba(230,145,56,0.25)",
                  "rgba(168,85,247,0.25)",
                ];
                return (
                  <div
                    key={value.title}
                    className={`rounded-2xl p-5 border bg-gradient-to-br ${gradients[i % gradients.length]}`}
                    style={{ borderColor: borderColors[i % borderColors.length] }}
                  >
                    <h3 className="text-sm font-bold text-white mb-2">{value.title}</h3>
                    <p className="text-xs text-white/60 leading-relaxed">{value.body}</p>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Stats */}
          <section>
            <h2 className="text-xl font-bold text-white mb-4 text-center">{t.statsTitle}</h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {t.stats.map((stat) => (
                <div
                  key={stat.label}
                  className="rounded-xl p-5 border text-center"
                  style={{
                    background: "rgba(255,255,255,0.04)",
                    borderColor: "rgba(255,255,255,0.08)",
                  }}
                >
                  <div
                    className="text-2xl font-black mb-1"
                    style={{
                      background: "linear-gradient(135deg, #D4007A, #E69138)",
                      WebkitBackgroundClip: "text",
                      WebkitTextFillColor: "transparent",
                      backgroundClip: "text",
                    }}
                  >
                    {stat.value}
                  </div>
                  <div className="text-xs text-white/50">{stat.label}</div>
                </div>
              ))}
            </div>
          </section>

          {/* Team */}
          <section>
            <h2 className="text-xl font-bold text-white mb-4">{t.teamTitle}</h2>
            <div
              className="rounded-2xl p-6 border"
              style={{
                background: "rgba(255,255,255,0.03)",
                borderColor: "rgba(255,255,255,0.08)",
              }}
            >
              <div className="flex items-center gap-3 mb-4">
                <div
                  className="w-12 h-12 rounded-xl flex items-center justify-center text-xl flex-shrink-0"
                  style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
                >
                  🏳️‍🌈
                </div>
                <div>
                  <div className="text-sm font-bold text-white">PNPtv Team</div>
                  <div className="text-xs text-white/40">Latin America &amp; beyond</div>
                </div>
              </div>
              <p className="text-sm leading-relaxed" style={{ color: "rgba(255,255,255,0.70)" }}>
                {t.teamBody}
              </p>
            </div>
          </section>

          {/* Contact CTA */}
          <section
            className="rounded-2xl p-6 sm:p-8 border text-center"
            style={{
              background: "rgba(212,0,122,0.06)",
              borderColor: "rgba(212,0,122,0.2)",
            }}
          >
            <h2 className="text-lg font-bold text-white mb-2">{t.contactTitle}</h2>
            <p className="text-sm text-white/60 mb-5 max-w-sm mx-auto">{t.contactBody}</p>
            <Link
              to="/contact"
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-90"
              style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
            >
              {t.contactCta}
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M17 8l4 4m0 0l-4 4m4-4H3" />
              </svg>
            </Link>
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
