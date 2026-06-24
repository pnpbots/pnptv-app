import React, { useState, useEffect } from "react";
import { Helmet } from "react-helmet-async";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import DOMPurify from "dompurify";
import { getPage, type Page } from "@/lib/directus";
import { useAuth } from "@/hooks/useAuth";
import { acceptTerms, ApiError } from "@/lib/api";

const CONSENT_SLUGS = new Set(["terms", "privacy", "creator-terms"]);

export default function CmsPage() {
  const { slug: paramSlug } = useParams<{ slug: string }>();
  const location = useLocation();
  const slug = paramSlug || location.pathname.replace(/^\//, "");
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();
  const [page, setPage] = useState<Page | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [accepted, setAccepted] = useState(false);

  const showConsentBar = !loading && !!page && CONSENT_SLUGS.has(slug);

  const handleAccept = async () => {
    if (accepting || accepted) return;
    setAccepting(true);
    try {
      await acceptTerms();
      setAccepted(true);
    } catch (err: unknown) {
      if (err instanceof ApiError && err.status === 401) {
        navigate(`/login?returnTo=${encodeURIComponent(location.pathname)}`);
      }
    } finally {
      setAccepting(false);
    }
  };

  useEffect(() => {
    if (!slug) return;
    setLoading(true);
    setNotFound(false);
    getPage(slug).then((p) => {
      if (p) {
        setPage(p);
      } else {
        setNotFound(true);
      }
      setLoading(false);
    });
  }, [slug]);

  if (loading) {
    return (
      <div className="min-h-dvh flex items-center justify-center" style={{ background: "var(--pnp-background, #0A0A0B)" }}>
        <div className="w-8 h-8 border-2 border-white/20 border-t-white/80 rounded-full animate-spin" />
      </div>
    );
  }

  if (notFound || !page) {
    return (
      <div className="min-h-dvh flex flex-col items-center justify-center gap-4 px-4" style={{ background: "var(--pnp-background, #0A0A0B)", color: "#fff" }}>
        <p className="text-lg font-semibold">Page not found</p>
        <button onClick={() => navigate(-1)} className="text-sm underline" style={{ color: "#D4007A" }}>
          Go back
        </button>
      </div>
    );
  }

  return (
    <>
      <Helmet>
        <title>{page.title} — PNPtv!</title>
      </Helmet>
      <div className="min-h-dvh" style={{ background: "var(--pnp-background, #0A0A0B)", color: "#fff" }}>
        {/* Top bar */}
        <div className="sticky top-0 z-50 flex items-center gap-3 px-4 py-3" style={{ background: "rgba(10,10,11,0.92)", backdropFilter: "blur(12px)", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
          <button onClick={() => navigate(-1)} className="text-white/60 hover:text-white transition-colors" aria-label="Go back">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <span className="text-sm font-semibold text-white truncate">{page.title}</span>
        </div>

        {/* Content */}
        <div className="max-w-2xl mx-auto px-4 py-8">
          <h1 className="text-2xl font-black mb-6">{page.title}</h1>
          {page.content && (
            <div
              className="prose prose-invert prose-sm max-w-none
                prose-headings:text-white prose-p:text-white/70 prose-li:text-white/70
                prose-a:text-[#D4007A] prose-strong:text-white
                prose-ul:list-disc prose-ol:list-decimal"
              dangerouslySetInnerHTML={{
                __html: DOMPurify.sanitize(page.content || '', {
                  ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'u', 'h1', 'h2', 'h3', 'h4', 'ul', 'ol', 'li', 'a', 'blockquote', 'code', 'pre', 'hr', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'img', 'span', 'div'],
                  ALLOWED_ATTR: ['href', 'target', 'rel', 'src', 'alt', 'class'],
                  ALLOW_DATA_ATTR: false,
                  ALLOWED_URI_REGEXP: /^(https?:\/\/|\/)/i,
                }),
              }}
            />
          )}

          {/* Consent acceptance — inline at bottom of content */}
          {showConsentBar && (
            <div className="mt-8 rounded-2xl p-5" style={{ background: "rgba(212,0,122,0.06)", border: "1px solid rgba(212,0,122,0.2)" }}>
              {accepted ? (
                <div className="flex items-center justify-center gap-2">
                  <svg className="w-5 h-5 flex-shrink-0" style={{ color: "#4ADE80" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                  </svg>
                  <span className="text-sm font-semibold" style={{ color: "#4ADE80" }}>Agreement confirmed</span>
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-sm" style={{ color: "rgba(255,255,255,0.6)" }}>
                    By tapping below you confirm you have read and agree to this document.
                  </p>
                  <button
                    onClick={handleAccept}
                    disabled={accepting}
                    className="w-full py-3 rounded-xl text-sm font-semibold text-white disabled:opacity-60 transition-opacity hover:opacity-90"
                    style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
                  >
                    {accepting ? "Confirming…" : `I have read and agree to the ${page.title}`}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t px-4 py-6 text-center" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
          <p className="text-xs" style={{ color: "rgba(255,255,255,0.25)" }}>
            &copy; {new Date().getFullYear()} PNPtv!
          </p>
        </div>
      </div>
    </>
  );
}
