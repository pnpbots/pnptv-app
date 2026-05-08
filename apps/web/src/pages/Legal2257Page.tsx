import React from "react";
import { Helmet } from "react-helmet-async";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";

const CUSTODIAN_NAME =
  import.meta.env.VITE_CUSTODIAN_NAME || "[Records Custodian]";
const CUSTODIAN_ADDRESS =
  import.meta.env.VITE_CUSTODIAN_ADDRESS || "pnptv.app";

export default function Legal2257Page() {
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();

  return (
    <>
      <Helmet>
        <title>18 U.S.C. § 2257 Compliance Statement — PNPtv!</title>
        <meta
          name="description"
          content="18 U.S.C. § 2257 Record-Keeping Requirements Compliance Statement for PNPtv."
        />
        <meta name="robots" content="noindex" />
      </Helmet>

      <div className="min-h-dvh" style={{ background: "var(--pnp-background, #0A0A0B)", color: "#fff" }}>
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
              <span className="text-sm font-black" style={{ color: "var(--pnp-accent, #D4007A)" }}>!</span>
            </Link>
          </div>
          {!isAuthenticated && (
            <div className="flex items-center gap-2">
              <Link
                to="/auth"
                className="text-xs font-medium text-white/70 hover:text-white transition-colors px-3 py-1.5 rounded-lg"
                style={{ border: "1px solid rgba(255,255,255,0.1)" }}
              >
                Log In
              </Link>
            </div>
          )}
        </div>

        {/* Content */}
        <div className="max-w-2xl mx-auto px-4 py-12 space-y-10">

          {/* Header */}
          <div className="space-y-2">
            <p className="text-xs font-semibold tracking-widest uppercase" style={{ color: "var(--pnp-accent, #D4007A)" }}>
              Legal
            </p>
            <h1 className="text-2xl font-bold text-white leading-snug">
              18 U.S.C. § 2257 Record-Keeping Requirements<br />Compliance Statement
            </h1>
          </div>

          {/* Divider */}
          <div style={{ height: "1px", background: "rgba(255,255,255,0.07)" }} />

          {/* Statutory overview */}
          <section className="space-y-4">
            <p className="text-sm leading-relaxed" style={{ color: "rgba(255,255,255,0.75)" }}>
              In accordance with the requirements of{" "}
              <strong className="text-white">18 U.S.C. § 2257</strong> and{" "}
              <strong className="text-white">28 C.F.R. Part 75</strong>, all creators publishing content on{" "}
              <strong className="text-white">PNPtv</strong> are required to verify their identity and age prior to
              content publication. PNPtv maintains the records required by this statute.
            </p>
          </section>

          {/* Custodian block */}
          <section
            className="rounded-xl p-6 space-y-4"
            style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}
          >
            <h2 className="text-base font-bold text-white">Designated Records Custodian</h2>
            <p className="text-sm leading-relaxed" style={{ color: "rgba(255,255,255,0.75)" }}>
              Records required pursuant to 18 U.S.C. § 2257 are maintained by:
            </p>
            <address
              className="not-italic text-sm leading-loose"
              style={{ color: "rgba(255,255,255,0.85)" }}
            >
              <strong className="text-white">{CUSTODIAN_NAME}</strong>
              <br />
              {CUSTODIAN_ADDRESS}
            </address>
            <p className="text-sm" style={{ color: "rgba(255,255,255,0.75)" }}>
              These records are available for inspection as required by law.
            </p>
          </section>

          {/* Performer age statement */}
          <section
            className="rounded-xl p-6 space-y-3"
            style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}
          >
            <h2 className="text-base font-bold text-white">Age Verification Statement</h2>
            <p className="text-sm leading-relaxed" style={{ color: "rgba(255,255,255,0.75)" }}>
              All performers depicted on this website were 18 years of age or older at the time of the creation
              of the depictions. PNPtv requires identity verification for all content creators, and prohibits
              any content depicting individuals under the age of 18.
            </p>
          </section>

          {/* Creator verification process */}
          <section
            className="rounded-xl p-6 space-y-3"
            style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}
          >
            <h2 className="text-base font-bold text-white">Creator Verification Process</h2>
            <p className="text-sm leading-relaxed" style={{ color: "rgba(255,255,255,0.75)" }}>
              Before publishing any content on PNPtv, creators are required to:
            </p>
            <ul className="space-y-2 text-sm" style={{ color: "rgba(255,255,255,0.75)" }}>
              <li className="flex items-start gap-2">
                <span className="flex-shrink-0 font-bold text-white mt-0.5">1.</span>
                Submit their legal full name and date of birth as they appear on a government-issued ID.
              </li>
              <li className="flex items-start gap-2">
                <span className="flex-shrink-0 font-bold text-white mt-0.5">2.</span>
                Upload a photograph of a valid government-issued identity document (passport, driver's license,
                national ID card, state/province ID, or equivalent).
              </li>
              <li className="flex items-start gap-2">
                <span className="flex-shrink-0 font-bold text-white mt-0.5">3.</span>
                Have their identity and age confirmed by PNPtv's compliance team before their account is activated
                for content publication.
              </li>
            </ul>
            <p className="text-sm leading-relaxed" style={{ color: "rgba(255,255,255,0.75)" }}>
              Identity records are stored securely and are not shared with third parties except as required by law.
            </p>
          </section>

          {/* Contact */}
          <section className="space-y-3">
            <h2 className="text-base font-bold text-white">Contact</h2>
            <p className="text-sm leading-relaxed" style={{ color: "rgba(255,255,255,0.75)" }}>
              For inquiries regarding these records, or to report concerns about content on this platform,
              contact us at:{" "}
              <a
                href="mailto:legal@pnptv.app"
                className="underline"
                style={{ color: "var(--pnp-accent, #D4007A)" }}
              >
                legal@pnptv.app
              </a>
            </p>
          </section>

          {/* Divider */}
          <div style={{ height: "1px", background: "rgba(255,255,255,0.07)" }} />

          {/* Footer note */}
          <p className="text-xs leading-relaxed" style={{ color: "rgba(255,255,255,0.35)" }}>
            This statement is provided pursuant to 18 U.S.C. § 2257 and 28 C.F.R. Part 75.
            PNPtv is committed to full compliance with all applicable federal record-keeping laws.
          </p>

        </div>
      </div>
    </>
  );
}
