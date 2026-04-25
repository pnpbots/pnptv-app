import React, { useState } from "react";
import { Helmet } from "react-helmet-async";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { shop } from "@/lib/i18n/shop";

type Lang = "en" | "es";

function getStrings() {
  const lang: Lang = navigator.language?.startsWith("es") ? "es" : "en";
  return { t: shop[lang], lang };
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

export default function ShopPage() {
  const { t } = getStrings();
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [waitlistState, setWaitlistState] = useState<"idle" | "success" | "error">("idle");

  const handleWaitlist = () => {
    if (!isValidEmail(email)) {
      setWaitlistState("error");
      return;
    }
    // Store to localStorage as a no-backend waitlist simulation
    const existing = JSON.parse(localStorage.getItem("pnptv_shop_waitlist") || "[]") as string[];
    if (!existing.includes(email.trim().toLowerCase())) {
      existing.push(email.trim().toLowerCase());
      localStorage.setItem("pnptv_shop_waitlist", JSON.stringify(existing));
    }
    setWaitlistState("success");
  };

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
                "radial-gradient(ellipse 80% 50% at 50% 0%, rgba(212,0,122,0.14) 0%, rgba(230,145,56,0.08) 60%, transparent 90%)",
            }}
          />
          <div className="relative">
            <div
              className="inline-flex items-center gap-2 mb-3 px-3 py-1.5 rounded-full border text-xs font-bold"
              style={{
                background: "rgba(212,0,122,0.1)",
                borderColor: "rgba(212,0,122,0.3)",
                color: "#D4007A",
              }}
            >
              {t.comingSoonBadge}
            </div>
            <h1 className="text-3xl sm:text-4xl font-black text-white mb-2">{t.pageHeading}</h1>
            <p
              className="text-base font-medium"
              style={{ color: "#E69138" }}
            >
              {t.pageSubtitle}
            </p>
          </div>
        </div>

        <div className="max-w-4xl mx-auto px-4 pb-16">
          {/* Products grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-10">
            {t.products.map((product) => (
              <div
                key={product.id}
                className="rounded-2xl border overflow-hidden transition-all duration-200 hover:border-white/15 group"
                style={{
                  background: "rgba(255,255,255,0.03)",
                  borderColor: "rgba(255,255,255,0.08)",
                }}
              >
                {/* Product image placeholder — styled gradient div */}
                <div
                  className={`relative h-44 bg-gradient-to-br ${product.gradient} flex flex-col items-center justify-center gap-2 overflow-hidden`}
                >
                  {/* Subtle pattern overlay */}
                  <div
                    className="absolute inset-0 opacity-20"
                    style={{
                      backgroundImage:
                        "radial-gradient(circle at 20% 80%, rgba(255,255,255,0.15) 0%, transparent 50%), radial-gradient(circle at 80% 20%, rgba(255,255,255,0.1) 0%, transparent 50%)",
                    }}
                  />
                  <span className="relative text-5xl group-hover:scale-110 transition-transform duration-300">
                    {product.emoji}
                  </span>
                  <span className="relative text-white/80 text-sm font-bold tracking-wide">
                    {product.name}
                  </span>
                </div>

                {/* Product info */}
                <div className="p-4">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <h3 className="text-sm font-bold text-white">{product.name}</h3>
                    <span
                      className="flex-shrink-0 text-sm font-black"
                      style={{ color: "#E69138" }}
                    >
                      {product.price}
                    </span>
                  </div>
                  <p className="text-xs text-white/50 leading-relaxed">{product.description}</p>

                  {/* Disabled shop button */}
                  <div
                    className="mt-3 w-full py-2 rounded-lg text-xs font-semibold text-center"
                    style={{
                      background: "rgba(255,255,255,0.05)",
                      color: "rgba(255,255,255,0.3)",
                      border: "1px solid rgba(255,255,255,0.07)",
                      cursor: "default",
                    }}
                  >
                    {t.comingSoonBadge}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Waitlist section */}
          <div
            className="rounded-2xl border p-6 sm:p-8 text-center"
            style={{
              background: "rgba(212,0,122,0.05)",
              borderColor: "rgba(212,0,122,0.2)",
            }}
          >
            {waitlistState === "success" ? (
              <div className="py-4">
                <div
                  className="w-14 h-14 rounded-2xl flex items-center justify-center text-2xl mx-auto mb-4"
                  style={{ background: "rgba(34,197,94,0.15)" }}
                >
                  ✅
                </div>
                <p className="text-base font-bold text-white mb-1">{t.waitlistSuccess}</p>
              </div>
            ) : (
              <>
                <div
                  className="w-14 h-14 rounded-2xl flex items-center justify-center text-2xl mx-auto mb-4"
                  style={{ background: "rgba(212,0,122,0.15)" }}
                >
                  🛍️
                </div>
                <h2 className="text-lg font-bold text-white mb-2">{t.waitlistTitle}</h2>
                <p className="text-sm text-white/60 mb-5 max-w-sm mx-auto leading-relaxed">
                  {t.waitlistBody}
                </p>

                <div className="flex flex-col sm:flex-row gap-3 max-w-md mx-auto">
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      if (waitlistState === "error") setWaitlistState("idle");
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleWaitlist();
                    }}
                    placeholder={t.waitlistEmailPlaceholder}
                    className="flex-1 px-4 py-3 rounded-xl text-sm bg-transparent text-white outline-none transition-colors placeholder-white/30"
                    style={{
                      border: `1px solid ${waitlistState === "error" ? "rgba(255,69,58,0.5)" : "rgba(255,255,255,0.15)"}`,
                    }}
                    aria-invalid={waitlistState === "error"}
                    aria-describedby={waitlistState === "error" ? "waitlist-error" : undefined}
                  />
                  <button
                    onClick={handleWaitlist}
                    className="px-6 py-3 rounded-xl text-sm font-bold text-white transition-opacity hover:opacity-90 flex-shrink-0"
                    style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
                  >
                    {t.waitlistCta}
                  </button>
                </div>

                {waitlistState === "error" && (
                  <p id="waitlist-error" className="text-xs text-red-400 mt-2">
                    {t.waitlistError}
                  </p>
                )}

                <p className="text-xs mt-4" style={{ color: "rgba(255,255,255,0.25)" }}>
                  {t.privacyNote}
                </p>
              </>
            )}
          </div>
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
