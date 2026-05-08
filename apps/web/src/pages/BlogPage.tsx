import React, { useState } from "react";
import { Helmet } from "react-helmet-async";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { blog } from "@/lib/i18n/blog";

type Lang = "en" | "es";

function getStrings() {
  const lang: Lang = navigator.language?.startsWith("es") ? "es" : "en";
  return { t: blog[lang], lang };
}

function CategoryBadge({ category, label }: { category: string; label: string }) {
  const colors: Record<string, string> = {
    community: "bg-purple-500/20 text-purple-300 border-purple-500/30",
    safety: "bg-green-500/20 text-green-300 border-green-500/30",
    creators: "bg-pnp-amber/20 text-pnp-amber border-pnp-amber/30",
    platform: "bg-pnp-accent/20 text-pnp-accent border-pnp-accent/30",
  };
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${colors[category] ?? "bg-white/10 text-white/60 border-white/20"}`}
    >
      {label}
    </span>
  );
}

export default function BlogPage() {
  const { t } = getStrings();
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [activeCategory, setActiveCategory] = useState<string>("all");
  const [expandedSlug, setExpandedSlug] = useState<string | null>(null);

  const categories = [
    { key: "all", label: t.categories.all },
    { key: "community", label: t.categories.community },
    { key: "safety", label: t.categories.safety },
    { key: "creators", label: t.categories.creators },
    { key: "platform", label: t.categories.platform },
  ];

  const filteredArticles =
    activeCategory === "all"
      ? t.articles
      : t.articles.filter((a) => a.category === activeCategory);

  const categoryLabels: Record<string, string> = {
    community: t.categories.community,
    safety: t.categories.safety,
    creators: t.categories.creators,
    platform: t.categories.platform,
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

      <div className="min-h-dvh bg-pnp-background text-white">
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
              <span className="text-sm font-black text-pnp-accent">!</span>
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
                className="text-xs font-semibold text-white px-3 py-1.5 rounded-lg btn-gradient"
              >
                Join Free
              </Link>
            </div>
          )}
        </div>

        {/* Hero */}
        <div className="relative overflow-hidden px-4 pt-10 pb-8 text-center">
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              background:
                "radial-gradient(ellipse 80% 50% at 50% 0%, rgba(212,0,122,0.12) 0%, transparent 70%)",
            }}
          />
          <h1 className="relative text-3xl sm:text-4xl font-black text-white mb-3">
            {t.pageHeading}
          </h1>
          <p className="relative text-sm text-white/60 max-w-md mx-auto">{t.pageSubtitle}</p>
        </div>

        {/* Category filters */}
        <div className="px-4 mb-6 flex gap-2 flex-wrap justify-center">
          {categories.map((cat) => (
            <button
              key={cat.key}
              onClick={() => setActiveCategory(cat.key)}
              className={`px-4 py-1.5 rounded-full text-xs font-semibold border transition-all duration-200 ${
                activeCategory === cat.key
                  ? "border-pnp-accent text-white bg-pnp-accent/15"
                  : "border-white/10 text-white/50 hover:border-white/20 hover:text-white/70 bg-white/[0.04]"
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>

        {/* Articles */}
        <div className="max-w-4xl mx-auto px-4 pb-12 space-y-4">
          {filteredArticles.map((article) => {
            const isExpanded = expandedSlug === article.slug;
            return (
              <article
                key={article.slug}
                className="rounded-2xl border transition-all duration-300"
                style={{
                  background: isExpanded
                    ? "rgba(255,255,255,0.06)"
                    : "rgba(255,255,255,0.03)",
                  borderColor: isExpanded
                    ? "rgba(212,0,122,0.3)"
                    : "rgba(255,255,255,0.07)",
                }}
              >
                <button
                  className="w-full text-left p-5 sm:p-6"
                  onClick={() =>
                    setExpandedSlug(isExpanded ? null : article.slug)
                  }
                  aria-expanded={isExpanded}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 mb-2">
                        <CategoryBadge
                          category={article.category}
                          label={categoryLabels[article.category] ?? article.category}
                        />
                        <span className="text-xs text-white/30">{article.date}</span>
                      </div>
                      <h2 className="text-base sm:text-lg font-bold text-white leading-snug mb-2">
                        {article.title}
                      </h2>
                      <p className="text-sm text-white/55 leading-relaxed">
                        {article.summary}
                      </p>
                    </div>
                    <div
                      className="flex-shrink-0 mt-1 w-8 h-8 rounded-full flex items-center justify-center transition-all duration-300"
                      style={{ background: "rgba(255,255,255,0.06)" }}
                    >
                      <svg
                        className={`w-4 h-4 text-white/50 transition-transform duration-300 ${isExpanded ? "rotate-180" : ""}`}
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                      </svg>
                    </div>
                  </div>

                  <div className="mt-3">
                    <span
                      className="text-xs font-semibold text-pnp-accent"
                    >
                      {isExpanded ? t.readLess : t.readMore}
                    </span>
                  </div>
                </button>

                {/* Expanded content */}
                {isExpanded && (
                  <div
                    className="px-5 sm:px-6 pb-6 border-t"
                    style={{ borderColor: "rgba(255,255,255,0.06)" }}
                  >
                    <div className="mt-5 space-y-4">
                      {article.content.split("\n\n").map((paragraph, i) => (
                        <p
                          key={i}
                          className="text-sm leading-relaxed"
                          style={{ color: "rgba(255,255,255,0.72)" }}
                        >
                          {paragraph.trim()}
                        </p>
                      ))}
                    </div>
                  </div>
                )}
              </article>
            );
          })}
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
