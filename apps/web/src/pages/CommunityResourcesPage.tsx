import React, { useState } from "react";
import { Helmet } from "react-helmet-async";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { communityResources } from "@/lib/i18n/communityResources";

type Lang = "en" | "es";

function getStrings() {
  const lang: Lang = navigator.language?.startsWith("es") ? "es" : "en";
  return { t: communityResources[lang], lang };
}

function SectionHeader({ icon, title, subtitle }: { icon: string; title: string; subtitle?: string }) {
  return (
    <div className="flex items-start gap-3 mb-5">
      <div
        className="flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center text-xl"
        style={{ background: "rgba(255,255,255,0.08)" }}
      >
        {icon}
      </div>
      <div>
        <h2 className="text-lg font-bold text-white">{title}</h2>
        {subtitle && <p className="text-xs text-white/50 mt-0.5">{subtitle}</p>}
      </div>
    </div>
  );
}

function AccordionItem({
  title,
  body,
}: {
  title: string;
  body: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div
      className="rounded-xl border transition-all duration-200"
      style={{
        background: open ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.03)",
        borderColor: open ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.07)",
      }}
    >
      <button
        className="w-full flex items-center justify-between gap-3 p-4 text-left"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        <span className="text-sm font-semibold text-white">{title}</span>
        <svg
          className={`w-4 h-4 flex-shrink-0 text-white/40 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div
          className="px-4 pb-4 border-t"
          style={{ borderColor: "rgba(255,255,255,0.06)" }}
        >
          <p className="text-sm leading-relaxed mt-3" style={{ color: "rgba(255,255,255,0.68)" }}>
            {body}
          </p>
        </div>
      )}
    </div>
  );
}

export default function CommunityResourcesPage() {
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
                "radial-gradient(ellipse 80% 50% at 50% 0%, rgba(34,197,94,0.10) 0%, transparent 70%)",
            }}
          />
          <div className="relative">
            <div className="inline-flex items-center gap-2 mb-3 px-3 py-1.5 rounded-full border" style={{ background: "rgba(34,197,94,0.1)", borderColor: "rgba(34,197,94,0.3)" }}>
              <span className="text-green-400 text-xs font-semibold">Harm Reduction Resource</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-black text-white mb-3">{t.pageHeading}</h1>
            <p className="text-sm text-white/60 max-w-md mx-auto leading-relaxed">{t.pageSubtitle}</p>
          </div>
        </div>

        <div className="max-w-4xl mx-auto px-4 pb-16 space-y-10">

          {/* Emergency Resources */}
          <section>
            <SectionHeader icon="🆘" title={t.emergencyTitle} subtitle={t.emergencySubtitle} />
            <div className="space-y-3">
              {t.emergencyResources.map((resource) => (
                <div
                  key={resource.name}
                  className="rounded-xl border p-4"
                  style={{
                    background: "rgba(255,69,58,0.06)",
                    borderColor: "rgba(255,69,58,0.2)",
                  }}
                >
                  <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
                    <div className="flex-1">
                      <h3 className="text-sm font-bold text-white">{resource.name}</h3>
                      <p className="text-xs text-white/55 mt-0.5 leading-relaxed">{resource.description}</p>
                      <p className="text-xs mt-1.5 font-medium" style={{ color: "rgba(255,150,150,0.8)" }}>
                        {resource.available}
                      </p>
                    </div>
                    <a
                      href={resource.number.startsWith("Text") ? undefined : `tel:${resource.number.replace(/\s/g, "")}`}
                      className="flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-white transition-opacity hover:opacity-80"
                      style={{ background: "rgba(255,69,58,0.25)", border: "1px solid rgba(255,69,58,0.4)" }}
                      aria-label={`Call ${resource.name}`}
                    >
                      {resource.number.startsWith("Text") ? (
                        <>
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                          </svg>
                          {resource.number}
                        </>
                      ) : (
                        <>
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                          </svg>
                          {resource.number}
                        </>
                      )}
                    </a>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Harm Reduction */}
          <section>
            <SectionHeader icon="🛡️" title={t.harmReductionTitle} subtitle={t.harmReductionSubtitle} />
            <div className="space-y-2">
              {t.harmReductionItems.map((item) => (
                <AccordionItem key={item.title} title={item.title} body={item.body} />
              ))}
            </div>
          </section>

          {/* Sexual Health */}
          <section>
            <SectionHeader icon="❤️" title={t.sexualHealthTitle} subtitle={t.sexualHealthSubtitle} />
            <div className="space-y-2">
              {t.sexualHealthItems.map((item) => (
                <AccordionItem key={item.title} title={item.title} body={item.body} />
              ))}
            </div>
          </section>

          {/* Mental Health */}
          <section>
            <SectionHeader icon="🧠" title={t.mentalHealthTitle} subtitle={t.mentalHealthSubtitle} />
            <div className="space-y-2">
              {t.mentalHealthItems.map((item) => (
                <AccordionItem key={item.title} title={item.title} body={item.body} />
              ))}
            </div>
          </section>

          {/* Community Guidelines */}
          <section
            className="rounded-2xl p-6 border"
            style={{
              background: "rgba(212,0,122,0.05)",
              borderColor: "rgba(212,0,122,0.2)",
            }}
          >
            <div className="flex items-start gap-3 mb-3">
              <span className="text-2xl flex-shrink-0">📋</span>
              <h2 className="text-lg font-bold text-white mt-0.5">{t.communityGuidelinesTitle}</h2>
            </div>
            <p className="text-sm text-white/65 leading-relaxed mb-4">{t.communityGuidelinesBody}</p>
            <Link
              to="/community-guidelines"
              className="inline-flex items-center gap-2 text-sm font-semibold transition-colors hover:opacity-80"
              style={{ color: "#D4007A" }}
            >
              {t.communityGuidelinesCta}
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M17 8l4 4m0 0l-4 4m4-4H3" />
              </svg>
            </Link>
          </section>

          {/* Disclaimer */}
          <p
            className="text-xs text-center leading-relaxed"
            style={{ color: "rgba(255,255,255,0.25)" }}
          >
            {t.copyrightNote}
          </p>
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
