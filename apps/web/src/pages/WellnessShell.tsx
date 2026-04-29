/**
 * WellnessShell.tsx — the page rendered when a user has active Wellness Mode
 * and tries to access anything outside the allowlist. The API redirects them
 * to /wellness via window.location.replace from the WELLNESS_MODE 403 handler
 * in lib/api.ts.
 *
 * The shell intentionally keeps things minimal: list the wellness hangouts,
 * show a button into Cristina, link to settings (where they can request to
 * disable), and surface the harm-reduction resources from the policy page.
 */

import React, { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import {
  getWellnessHangouts,
  getWellnessMode,
  type WellnessHangout,
  type WellnessModeStatus,
} from "@/lib/api";

export default function WellnessShell() {
  const [hangouts, setHangouts] = useState<WellnessHangout[]>([]);
  const [status, setStatus] = useState<WellnessModeStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [h, s] = await Promise.all([getWellnessHangouts(), getWellnessMode()]);
      setHangouts(h.groups || []);
      setStatus(s);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <>
      <Helmet>
        <title>Wellness Break · PNPtv</title>
      </Helmet>
      <div className="min-h-screen bg-pnp-bg" style={{
        backgroundImage: "radial-gradient(circle at top right, rgba(94,209,196,0.08), transparent 50%)",
      }}>
        <div className="max-w-2xl mx-auto px-4 py-10">
          <div className="text-center mb-8">
            <div className="text-5xl mb-3">🧘</div>
            <h1 className="text-2xl font-bold text-white mb-2">Wellness Break</h1>
            <p className="text-sm text-white/60 max-w-md mx-auto leading-relaxed">
              You're taking a break from the rest of the platform. Only the wellness hangouts, Cristina, and your settings are reachable right now. <strong className="text-white">You're doing great.</strong>
            </p>
            {status?.active && (
              <p className="text-xs text-white/40 mt-3">
                {status.indefinite
                  ? "Active indefinitely — disable when you're ready in Settings."
                  : status.until
                    ? `Active until ${new Date(status.until).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}`
                    : ""}
              </p>
            )}
          </div>

          {/* Wellness hangouts */}
          <section className="mb-6">
            <h2 className="text-xs uppercase tracking-wider text-white/50 mb-3">Wellness Hangouts</h2>
            {loading && <div className="h-24 rounded-2xl bg-white/5 animate-pulse" />}
            {error && <p className="text-sm text-red-400">{error}</p>}
            {!loading && hangouts.length === 0 && (
              <p className="text-sm text-white/50 italic">No wellness hangouts available right now. Reach out to support — this is a setup gap.</p>
            )}
            <div className="space-y-3">
              {hangouts.map((h) => (
                <Link
                  key={h.id}
                  to={`/hangouts/${h.id}`}
                  className="block rounded-2xl p-4 transition-all hover:scale-[1.01]"
                  style={{
                    background: "linear-gradient(135deg, rgba(94,209,196,0.1), rgba(94,209,196,0.04))",
                    border: "1px solid rgba(94,209,196,0.25)",
                  }}
                >
                  <div className="flex items-start gap-3">
                    <div className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: "rgba(94,209,196,0.2)" }}>
                      <span className="text-2xl">🌿</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="text-base font-bold text-white">{h.name}</h3>
                      <p className="text-xs text-white/60 leading-relaxed mt-1 line-clamp-3">{h.description}</p>
                      <p className="text-[11px] text-white/40 mt-2">{h.member_count} member{h.member_count === 1 ? "" : "s"}</p>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </section>

          {/* Cristina */}
          <section className="mb-6">
            <h2 className="text-xs uppercase tracking-wider text-white/50 mb-3">Talk to Cristina</h2>
            <Link
              to="/cristina"
              className="block rounded-2xl p-4 transition-all hover:scale-[1.01]"
              style={{ background: "rgba(212,0,122,0.08)", border: "1px solid rgba(212,0,122,0.25)" }}
            >
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 text-2xl" style={{ background: "rgba(212,0,122,0.15)" }}>🧜‍♀️</div>
                <div className="flex-1">
                  <h3 className="text-base font-bold text-white">Cristina AI</h3>
                  <p className="text-xs text-white/60">Need to vent, ask for resources, or find a sponsor? She's here, no judgment.</p>
                </div>
              </div>
            </Link>
          </section>

          {/* Crisis lines */}
          <section className="mb-6">
            <h2 className="text-xs uppercase tracking-wider text-white/50 mb-3">If you need help right now</h2>
            <div className="rounded-2xl p-4 space-y-2 text-sm" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}>
              <p className="text-white/80"><strong>SAMHSA Helpline (US):</strong> <a href="tel:18006624357" className="text-pnp-primary">1-800-662-4357</a> — free, 24/7, confidential</p>
              <p className="text-white/80"><strong>Crystal Meth Anonymous:</strong> <a href="https://crystalmeth.org" target="_blank" rel="noopener" className="text-pnp-primary">crystalmeth.org</a></p>
              <p className="text-white/80"><strong>Trevor Project (LGBTQ+ crisis):</strong> <a href="tel:18664887386" className="text-pnp-primary">1-866-488-7386</a></p>
              <p className="text-white/80"><strong>International:</strong> <a href="https://findahelpline.com" target="_blank" rel="noopener" className="text-pnp-primary">findahelpline.com</a></p>
            </div>
          </section>

          {/* Manage mode */}
          <section className="text-center mt-10">
            <Link
              to="/settings"
              className="inline-block text-xs text-white/50 hover:text-white/80 transition-colors"
            >
              Manage Wellness Break Mode in Settings →
            </Link>
          </section>
        </div>
      </div>
    </>
  );
}
