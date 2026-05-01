import React, { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Badge } from "@pnptv/ui-kit";
import { useAuth } from "@/hooks/useAuth";
import { useTier } from "@/hooks/useTier";
import { useI18n } from "@/lib/i18n";
import {
  getProfile,
  getMyReferral,
  getUpcomingBookings,
  enablePnptvIdLogin,
  type ReferralStats,
  type UpcomingBooking,
} from "@/lib/api";
import IdentityConnections from "@/components/profile/IdentityConnections";

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(dateStr: string, lang: string): string {
  return new Date(dateStr).toLocaleDateString(lang, {
    month: "long",
    year: "numeric",
  });
}

// ── AccountSettings ────────────────────────────────────────────────────────

export default function AccountSettings() {
  const navigate = useNavigate();
  const { user, isAuthenticated, refreshUser } = useAuth();
  const { isPrime, tier } = useTier();
  const t = useI18n();
  const p = t.profile;
  const uiLang = t.lang;

  const [memberSince, setMemberSince] = useState<string | null>(null);
  const [profileEmail, setProfileEmail] = useState<string | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);

  const [enablePnptvIdEmail, setEnablePnptvIdEmail] = useState("");
  const [enablePnptvIdSaving, setEnablePnptvIdSaving] = useState(false);
  const [enablePnptvIdError, setEnablePnptvIdError] = useState<string | null>(null);
  const [enablePnptvIdSuccess, setEnablePnptvIdSuccess] = useState<string | null>(null);

  const [referralStats, setReferralStats] = useState<ReferralStats | null>(null);
  const [referralCopied, setReferralCopied] = useState(false);

  const [upcomingCalls, setUpcomingCalls] = useState<UpcomingBooking[]>([]);
  const [upcomingCallsLoading, setUpcomingCallsLoading] = useState(false);

  useEffect(() => {
    if (!isAuthenticated) return;
    let cancelled = false;
    setProfileLoading(true);

    async function load() {
      try {
        const [profileRes, referralRes] = await Promise.all([
          getProfile(),
          getMyReferral().catch(() => null),
        ]);
        if (cancelled) return;
        const profile = profileRes.profile;
        setMemberSince(profile.memberSince ?? null);
        setProfileEmail(profile.email ?? null);
        if (referralRes) setReferralStats(referralRes);
      } catch {
        // Silent — sections degrade gracefully
      } finally {
        if (!cancelled) setProfileLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated) return;
    let cancelled = false;
    setUpcomingCallsLoading(true);
    getUpcomingBookings()
      .then((res) => { if (!cancelled) setUpcomingCalls(res.bookings ?? []); })
      .catch(() => { if (!cancelled) setUpcomingCalls([]); })
      .finally(() => { if (!cancelled) setUpcomingCallsLoading(false); });
    return () => { cancelled = true; };
  }, [isAuthenticated]);

  const handleCopyReferral = useCallback(() => {
    if (!referralStats?.link) return;
    const text = referralStats.link;
    const onSuccess = () => {
      setReferralCopied(true);
      setTimeout(() => setReferralCopied(false), 2000);
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(onSuccess).catch(() => {
        const ta = document.createElement("textarea");
        ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
        document.body.appendChild(ta); ta.select();
        document.execCommand("copy"); document.body.removeChild(ta);
        onSuccess();
      });
    } else {
      const ta = document.createElement("textarea");
      ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      document.execCommand("copy"); document.body.removeChild(ta);
      onSuccess();
    }
  }, [referralStats]);

  const tierLabel = isPrime ? "PRIME" : tier.charAt(0).toUpperCase() + tier.slice(1);

  return (
    <div className="space-y-4">
      {/* ── Account info ── */}
      <div className="glass-card-sm p-5">
        <h2 className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-4">
          {p.accountSection}
        </h2>
        {profileLoading ? (
          <div className="space-y-3">
            <div className="h-4 rounded bg-white/10 animate-pulse w-40" />
            <div className="h-3 rounded bg-white/10 animate-pulse w-28" />
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-white">
                  {user?.displayName || user?.firstName || "—"}
                </p>
                {user?.username && (
                  <p className="text-xs mt-0.5" style={{ color: "var(--pnp-text-secondary)" }}>
                    @{user.username}
                  </p>
                )}
              </div>
              <Badge variant={isPrime ? "accent" : "default"}>{tierLabel}</Badge>
            </div>
            {memberSince && (
              <p className="text-xs flex items-center gap-1.5" style={{ color: "var(--pnp-text-secondary)" }}>
                <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
                </svg>
                {p.joined} {formatDate(memberSince, uiLang)}
              </p>
            )}
          </div>
        )}
      </div>

      {/* ── Enable PNPtv ID login (Telegram-only users) ── */}
      {!profileLoading && (!profileEmail || profileEmail.endsWith("@telegram.pnptv.app")) && (
        <div className="glass-card-sm p-5">
          <h2 className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-3">
            Enable PNPtv ID login
          </h2>
          <p className="text-xs mb-3" style={{ color: "var(--pnp-text-secondary)" }}>
            Right now you sign in with Telegram. Add an email and password so
            you can also log in with a <strong>PNPtv ID</strong> — useful if
            you lose access to Telegram.
          </p>
          {enablePnptvIdSuccess ? (
            <div
              className="rounded-xl p-3 text-sm"
              style={{
                background: "rgba(34,197,94,0.1)",
                border: "1px solid rgba(34,197,94,0.3)",
                color: "#86efac",
              }}
            >
              {enablePnptvIdSuccess}
            </div>
          ) : (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const email = enablePnptvIdEmail.trim();
                setEnablePnptvIdError(null);
                if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                  setEnablePnptvIdError("Please enter a valid email address.");
                  return;
                }
                setEnablePnptvIdSaving(true);
                try {
                  const res = await enablePnptvIdLogin(email);
                  if (res.success) {
                    setEnablePnptvIdSuccess(
                      res.message || `Check ${email} for a link to set your password.`,
                    );
                    setEnablePnptvIdEmail("");
                    refreshUser().catch(() => {});
                    setProfileEmail(email);
                  } else {
                    setEnablePnptvIdError(res.message || "Something went wrong. Please try again.");
                  }
                } catch (err: unknown) {
                  setEnablePnptvIdError(
                    err instanceof Error ? err.message : "Connection error. Please try again.",
                  );
                } finally {
                  setEnablePnptvIdSaving(false);
                }
              }}
              className="space-y-3"
              noValidate
            >
              <input
                type="email"
                inputMode="email"
                autoComplete="email"
                value={enablePnptvIdEmail}
                onChange={(e) => { setEnablePnptvIdEmail(e.target.value); setEnablePnptvIdError(null); }}
                placeholder="your@email.com"
                aria-label="Email address"
                aria-invalid={!!enablePnptvIdError}
                disabled={enablePnptvIdSaving}
                className="w-full py-3 px-4 rounded-xl text-sm text-white placeholder:text-white/40 focus:outline-none focus:ring-2 transition-all disabled:opacity-60"
                style={{
                  background: "rgba(255,255,255,0.06)",
                  border: enablePnptvIdError ? "1px solid #ef4444" : "1px solid rgba(255,255,255,0.1)",
                  fontSize: "16px",
                }}
              />
              {enablePnptvIdError && (
                <p className="text-xs text-red-400 px-1">{enablePnptvIdError}</p>
              )}
              <button
                type="submit"
                disabled={enablePnptvIdSaving || !enablePnptvIdEmail.trim()}
                className="w-full py-3 px-4 rounded-xl font-semibold text-sm text-white transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed"
                style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
              >
                {enablePnptvIdSaving ? "Sending set-password link..." : "Send me a set-password link"}
              </button>
              <p className="text-center text-[11px]" style={{ color: "var(--pnp-text-secondary)" }}>
                We'll update your email and send a one-time link to create your password.
              </p>
            </form>
          )}
        </div>
      )}

      {/* ── Identity & Connections ── */}
      <IdentityConnections telegramUsername={user?.username || undefined} />

      {/* ── Upcoming Calls ── */}
      <div className="glass-card-sm p-5">
        <h2 className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-4">
          Upcoming Calls
        </h2>
        {upcomingCallsLoading ? (
          <div className="space-y-3">
            {[1, 2].map((i) => (
              <div key={i} className="h-16 rounded-xl animate-pulse" style={{ background: "rgba(255,255,255,0.06)" }} />
            ))}
          </div>
        ) : upcomingCalls.length === 0 ? (
          <div className="py-4 flex flex-col items-center gap-2 text-center">
            <svg className="w-8 h-8" style={{ color: "#636366" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.2} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" />
            </svg>
            <p className="text-sm font-medium" style={{ color: "#EBEBF5" }}>No upcoming calls</p>
            <a
              href="/creators"
              className="text-xs font-semibold underline underline-offset-2 transition-opacity hover:opacity-70"
              style={{ color: "#D4007A" }}
            >
              Browse creators
            </a>
          </div>
        ) : (
          <div className="space-y-3">
            {upcomingCalls.map((booking) => {
              const startMs = new Date(booking.start_time_utc).getTime();
              const nowMs = Date.now();
              const diffMs = startMs - nowMs;
              const diffMinutes = Math.floor(diffMs / 60_000);
              const isInWindow = Math.abs(diffMs) <= 15 * 60_000;
              const isInProgress = diffMs < 0 && Math.abs(diffMs) < (booking.duration_minutes ?? 30) * 60_000;

              let timePill: string;
              if (isInProgress) timePill = "In progress";
              else if (isInWindow) timePill = "Starts soon!";
              else if (diffMinutes < 60) timePill = `in ${diffMinutes}m`;
              else if (diffMinutes < 24 * 60) timePill = `in ${Math.floor(diffMinutes / 60)}h ${diffMinutes % 60}m`;
              else timePill = `in ${Math.floor(diffMinutes / 1440)}d`;

              const formattedStart = new Date(booking.start_time_utc).toLocaleString(undefined, {
                month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true,
              });

              return (
                <div
                  key={booking.id}
                  className="flex items-center gap-3 px-3 py-3 rounded-xl"
                  style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
                >
                  <div className="w-10 h-10 rounded-full overflow-hidden flex-shrink-0">
                    {booking.performer_photo ? (
                      <img src={booking.performer_photo} alt={booking.performer_name} className="w-full h-full object-cover" />
                    ) : (
                      <div
                        className="w-10 h-10 rounded-full flex items-center justify-center text-xs font-bold text-white"
                        style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
                      >
                        {booking.performer_name.slice(0, 2).toUpperCase()}
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate" style={{ color: "#EBEBF5" }}>
                      @{booking.performer_name}
                    </p>
                    <p className="text-xs" style={{ color: "var(--pnp-text-secondary)" }}>{formattedStart}</p>
                  </div>
                  {isInWindow || isInProgress ? (
                    <a
                      href={`/call/${booking.id}`}
                      className="flex-shrink-0 min-h-[34px] px-3 rounded-lg text-xs font-bold text-white flex items-center gap-1.5 transition-opacity hover:opacity-90"
                      style={{ background: "linear-gradient(90deg, #7B61FF, #D4007A)" }}
                    >
                      Join
                    </a>
                  ) : (
                    <span
                      className="flex-shrink-0 px-2.5 py-1 rounded-full text-xs font-medium"
                      style={{ background: "rgba(255,255,255,0.07)", color: "var(--pnp-text-secondary)" }}
                    >
                      {timePill}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Referral Program ── */}
      <div className="glass-card-sm p-5">
        <h2 className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-3">
          {p.referralProgram}
        </h2>
        <p className="text-xs mb-4" style={{ color: "var(--pnp-text-secondary)" }}>
          {p.referralInviteDesc}{" "}
          <strong style={{ color: "#FFB454" }}>{p.referralFreePrime}</strong>{" "}
          {p.referralWhenTheyJoin}
        </p>
        {profileLoading ? (
          <div className="h-16 rounded-lg animate-pulse" style={{ background: "rgba(255,255,255,0.05)" }} />
        ) : referralStats ? (
          <>
            <div className="flex items-center gap-2 mb-3">
              <div
                className="flex-1 px-3 py-2 rounded-lg text-xs font-mono truncate"
                style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "#fff" }}
              >
                {referralStats.link}
              </div>
              <button
                onClick={handleCopyReferral}
                className="px-3 py-2 rounded-lg text-xs font-medium flex-shrink-0 transition-colors"
                style={{
                  background: referralCopied ? "rgba(94,209,196,0.15)" : "rgba(255,180,84,0.15)",
                  border: referralCopied ? "1px solid rgba(94,209,196,0.4)" : "1px solid rgba(255,180,84,0.4)",
                  color: referralCopied ? "#5ED1C4" : "#FFB454",
                }}
              >
                {referralCopied ? p.copied : p.copy}
              </button>
            </div>
            <div className="flex gap-4">
              <div className="text-center">
                <div className="text-xl font-bold text-white">{referralStats.total}</div>
                <div className="text-[10px]" style={{ color: "var(--pnp-text-secondary)" }}>{p.invited}</div>
              </div>
              <div className="text-center">
                <div className="text-xl font-bold" style={{ color: "#FFB454" }}>{referralStats.completed}</div>
                <div className="text-[10px]" style={{ color: "var(--pnp-text-secondary)" }}>{p.joined_noun}</div>
              </div>
              <div className="text-center">
                <div className="text-xl font-bold" style={{ color: "#5ED1C4" }}>{referralStats.tokensEarned ?? 0}</div>
                <div className="text-[10px]" style={{ color: "var(--pnp-text-secondary)" }}>{p.tokensEarned ?? p.daysEarned}</div>
              </div>
            </div>
          </>
        ) : (
          <p className="text-xs" style={{ color: "var(--pnp-text-secondary)" }}>{p.referralLoadError}</p>
        )}
      </div>

      {/* ── Back to settings ── */}
      <button
        onClick={() => navigate("/settings")}
        className="w-full py-3 rounded-xl text-sm font-medium transition-colors hover:text-white"
        style={{ color: "var(--pnp-text-secondary)", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}
      >
        {p.back}
      </button>
    </div>
  );
}
