import React, { useState, useEffect } from "react";
import { Helmet } from "react-helmet-async";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import DOMPurify from "dompurify";
import { getPage, type Page } from "@/lib/directus";

export default function CmsPage() {
  const { slug: paramSlug } = useParams<{ slug: string }>();
  const location = useLocation();
  const slug = paramSlug || location.pathname.replace(/^\//, "");
  const navigate = useNavigate();
  const [page, setPage] = useState<Page | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

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
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#0A0A0B" }}>
        <div className="w-8 h-8 border-2 border-white/20 border-t-white/80 rounded-full animate-spin" />
      </div>
    );
  }

  if (notFound || !page) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 px-4" style={{ background: "#0A0A0B", color: "#fff" }}>
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
      <div className="min-h-screen" style={{ background: "#0A0A0B", color: "#fff" }}>
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
