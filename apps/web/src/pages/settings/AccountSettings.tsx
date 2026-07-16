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
  changeEmail,
  updateProfile,
  passkeyRegisterBegin,
  passkeyRegisterFinish,
  listPasskeys,
  deletePasskey,
  type ReferralStats,
  type UpcomingBooking,
  type PasskeyDevice,
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

  // Username edit
  const [usernameEdit, setUsernameEdit] = useState(false);
  const [usernameValue, setUsernameValue] = useState("");
  const [usernameSaving, setUsernameSaving] = useState(false);
  const [usernameError, setUsernameError] = useState<string | null>(null);
  const [usernameSuccess, setUsernameSuccess] = useState(false);

  // Email change
  const [emailEdit, setEmailEdit] = useState(false);
  const [emailValue, setEmailValue] = useState("");
  const [emailSaving, setEmailSaving] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [emailSuccess, setEmailSuccess] = useState<string | null>(null);

  const [referralStats, setReferralStats] = useState<ReferralStats | null>(null);
  const [referralCopied, setReferralCopied] = useState(false);

  const [upcomingCalls, setUpcomingCalls] = useState<UpcomingBooking[]>([]);
  const [upcomingCallsLoading, setUpcomingCallsLoading] = useState(false);

  // Passkey management
  const [passkeys, setPasskeys] = useState<PasskeyDevice[]>([]);
  const [passkeysLoading, setPasskeysLoading] = useState(false);
  const [passkeyAdding, setPasskeyAdding] = useState(false);
  const [passkeyAddError, setPasskeyAddError] = useState<string | null>(null);
  const [passkeyAddName, setPasskeyAddName] = useState("");
  const [passkeyAddSuccess, setPasskeyAddSuccess] = useState(false);
  const [passkeyDeleting, setPasskeyDeleting] = useState<number | null>(null);

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

  useEffect(() => {
    if (!isAuthenticated) return;
    let cancelled = false;
    setPasskeysLoading(true);
    listPasskeys()
      .then((res) => { if (!cancelled) setPasskeys(res.devices ?? []); })
      .catch(() => { if (!cancelled) setPasskeys([]); })
      .finally(() => { if (!cancelled) setPasskeysLoading(false); });
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

  const bufferToB64url = (buf: ArrayBuffer | Uint8Array | null | undefined): string => {
    if (!buf) return "";
    const bytes = new Uint8Array(buf instanceof ArrayBuffer ? buf : buf.buffer ?? (buf as Uint8Array));
    let str = "";
    bytes.forEach((b) => { str += String.fromCharCode(b); });
    return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
  };

  const b64urlToBuffer = (b64url: string): ArrayBuffer => {
    const padded = b64url.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(b64url.length / 4) * 4, "=");
    return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0)).buffer;
  };

  const handleAddPasskey = useCallback(async () => {
    if (!window.PublicKeyCredential) {
      setPasskeyAddError("Your browser doesn't support passkeys.");
      return;
    }
    setPasskeyAdding(true);
    setPasskeyAddError(null);
    setPasskeyAddSuccess(false);
    try {
      const beginRes = await passkeyRegisterBegin();
      if (!beginRes.success || !beginRes.options) {
        setPasskeyAddError(beginRes.error === "server_error" ? "Server error. Try again." : "Couldn't start passkey setup.");
        return;
      }
      const opts = beginRes.options;
      const publicKey: PublicKeyCredentialCreationOptions = {
        rp: opts.rp,
        user: {
          id: b64urlToBuffer(opts.user.id),
          name: opts.user.name,
          displayName: opts.user.displayName,
        },
        challenge: b64urlToBuffer(opts.challenge),
        pubKeyCredParams: opts.pubKeyCredParams as PublicKeyCredentialParameters[],
        timeout: opts.timeout,
        attestation: (opts.attestation as AttestationConveyancePreference) || "none",
        excludeCredentials: opts.excludeCredentials?.map((c) => ({
          id: b64urlToBuffer(c.id),
          type: "public-key" as const,
          transports: c.transports as AuthenticatorTransport[] | undefined,
        })),
        authenticatorSelection: opts.authenticatorSelection
          ? {
              residentKey: (opts.authenticatorSelection.residentKey as ResidentKeyRequirement) || "preferred",
              userVerification: (opts.authenticatorSelection.userVerification as UserVerificationRequirement) || "preferred",
            }
          : undefined,
      };

      let credential: PublicKeyCredential;
      try {
        credential = (await navigator.credentials.create({ publicKey })) as PublicKeyCredential;
      } catch (err) {
        const name = (err as { name?: string })?.name;
        if (name === "NotAllowedError") {
          setPasskeyAddError("Cancelled. Try again when ready.");
        } else if (name === "InvalidStateError") {
          setPasskeyAddError("This passkey is already registered.");
        } else {
          setPasskeyAddError("Couldn't create passkey. Your device may not support it.");
        }
        return;
      }
      if (!credential) { setPasskeyAddError("No credential returned."); return; }

      const response = credential.response as AuthenticatorAttestationResponse;
      const serialized = {
        id: credential.id,
        rawId: bufferToB64url(credential.rawId),
        type: credential.type,
        response: {
          clientDataJSON: bufferToB64url(response.clientDataJSON),
          attestationObject: bufferToB64url(response.attestationObject),
          transports: typeof response.getTransports === "function" ? response.getTransports() : [],
        },
        clientExtensionResults: credential.getClientExtensionResults?.() || {},
      };

      const finishRes = await passkeyRegisterFinish({
        credential: serialized,
        name: passkeyAddName.trim() || "My Passkey",
      });

      if (!finishRes.success) {
        const msgs: Record<string, string> = {
          expired: "Session expired. Please try again.",
          verification_failed: "Passkey verification failed. Try again.",
          authentik_user_not_found: "Account not linked to identity provider. Contact support.",
          store_failed: "Saved locally but couldn't sync. Contact support.",
        };
        setPasskeyAddError(msgs[finishRes.error ?? ""] || "Registration failed. Try again.");
        return;
      }

      setPasskeyAddSuccess(true);
      setPasskeyAddName("");
      const refreshed = await listPasskeys().catch(() => null);
      if (refreshed) setPasskeys(refreshed.devices ?? []);
      setTimeout(() => setPasskeyAddSuccess(false), 4000);
    } catch {
      setPasskeyAddError("Unexpected error. Try again.");
    } finally {
      setPasskeyAdding(false);
    }
  }, [passkeyAddName]);

  const handleDeletePasskey = useCallback(async (pk: number) => {
    setPasskeyDeleting(pk);
    try {
      await deletePasskey(pk);
      setPasskeys((prev) => prev.filter((d) => d.pk !== pk));
    } catch {
      // Silent — stale UI is acceptable
    } finally {
      setPasskeyDeleting(null);
    }
  }, []);

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
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-white">
                  {user?.displayName || user?.firstName || "—"}
                </p>
                {memberSince && (
                  <p className="text-xs mt-0.5 flex items-center gap-1" style={{ color: "var(--pnp-text-secondary)" }}>
                    <svg className="w-3 h-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
                    </svg>
                    {p.joined} {formatDate(memberSince, uiLang)}
                  </p>
                )}
              </div>
              <Badge variant={isPrime ? "accent" : "default"}>{tierLabel}</Badge>
            </div>

            {/* Username edit */}
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wider mb-1.5" style={{ color: "var(--pnp-text-secondary)" }}>
                @username
              </p>
              {usernameEdit ? (
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const val = usernameValue.trim();
                    setUsernameError(null);
                    if (!/^[a-zA-Z0-9_]{3,30}$/.test(val)) {
                      setUsernameError("3–30 characters, letters/numbers/underscores only.");
                      return;
                    }
                    setUsernameSaving(true);
                    try {
                      await updateProfile({ username: val });
                      await refreshUser();
                      setUsernameSuccess(true);
                      setUsernameEdit(false);
                      setTimeout(() => setUsernameSuccess(false), 3000);
                    } catch (err: unknown) {
                      setUsernameError(err instanceof Error ? err.message : "Could not save. Try again.");
                    } finally {
                      setUsernameSaving(false);
                    }
                  }}
                  className="flex gap-2"
                >
                  <input
                    type="text"
                    value={usernameValue}
                    onChange={(e) => { setUsernameValue(e.target.value); setUsernameError(null); }}
                    placeholder={user?.username || "choose_a_handle"}
                    maxLength={30}
                    autoFocus
                    disabled={usernameSaving}
                    className="flex-1 py-2 px-3 rounded-lg text-sm text-white placeholder:text-white/30 focus:outline-none focus:ring-1 disabled:opacity-60"
                    style={{
                      background: "rgba(255,255,255,0.07)",
                      border: usernameError ? "1px solid #ef4444" : "1px solid rgba(255,255,255,0.12)",
                      fontSize: "16px",
                    }}
                  />
                  <button
                    type="submit"
                    disabled={usernameSaving || !usernameValue.trim()}
                    className="px-3 py-2 rounded-lg text-xs font-semibold text-white transition-all hover:brightness-110 disabled:opacity-50 btn-gradient"
                  >
                    {usernameSaving ? "…" : "Save"}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setUsernameEdit(false); setUsernameError(null); }}
                    className="px-3 py-2 rounded-lg text-xs font-medium transition-colors"
                    style={{ color: "var(--pnp-text-secondary)", background: "rgba(255,255,255,0.06)" }}
                  >
                    Cancel
                  </button>
                </form>
              ) : (
                <div className="flex items-center justify-between">
                  <span className="text-sm" style={{ color: user?.username ? "#EBEBF5" : "var(--pnp-text-secondary)" }}>
                    {user?.username ? `@${user.username}` : "Not set"}
                  </span>
                  <button
                    onClick={() => { setUsernameValue(user?.username || ""); setUsernameEdit(true); setUsernameSuccess(false); }}
                    className="text-xs font-medium transition-opacity hover:opacity-70"
                    style={{ color: "var(--pnp-accent, #D4007A)" }}
                  >
                    {user?.username ? "Change" : "Set"}
                  </button>
                </div>
              )}
              {usernameError && <p className="text-xs text-red-400 mt-1">{usernameError}</p>}
              {usernameSuccess && <p className="text-xs mt-1" style={{ color: "#4ade80" }}>Username updated!</p>}
            </div>

            {/* Email change */}
            {profileEmail && !profileEmail.endsWith("@telegram.pnptv.app") && (
              <div>
                <p className="text-[11px] font-medium uppercase tracking-wider mb-1.5" style={{ color: "var(--pnp-text-secondary)" }}>
                  Email
                </p>
                {emailSuccess ? (
                  <div
                    className="rounded-xl p-3 text-sm"
                    style={{ background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.3)", color: "#86efac" }}
                  >
                    {emailSuccess}
                  </div>
                ) : emailEdit ? (
                  <form
                    onSubmit={async (e) => {
                      e.preventDefault();
                      const val = emailValue.trim().toLowerCase();
                      setEmailError(null);
                      if (!val || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) {
                        setEmailError("Please enter a valid email address.");
                        return;
                      }
                      setEmailSaving(true);
                      try {
                        const res = await changeEmail(val);
                        if (res.success) {
                          setProfileEmail(res.email ?? val);
                          setEmailEdit(false);
                          setEmailValue("");
                          setEmailSuccess(`Email updated to ${res.email ?? val}. A confirmation was sent.`);
                          await refreshUser().catch(() => {});
                        } else {
                          setEmailError(res.error || "Could not update email. Try again.");
                        }
                      } catch (err: unknown) {
                        setEmailError(err instanceof Error ? err.message : "Connection error. Try again.");
                      } finally {
                        setEmailSaving(false);
                      }
                    }}
                    className="space-y-2"
                  >
                    <div className="flex gap-2">
                      <input
                        type="email"
                        inputMode="email"
                        autoComplete="email"
                        value={emailValue}
                        onChange={(e) => { setEmailValue(e.target.value); setEmailError(null); }}
                        placeholder="new@email.com"
                        autoFocus
                        disabled={emailSaving}
                        className="flex-1 py-2 px-3 rounded-lg text-sm text-white placeholder:text-white/30 focus:outline-none focus:ring-1 disabled:opacity-60"
                        style={{
                          background: "rgba(255,255,255,0.07)",
                          border: emailError ? "1px solid #ef4444" : "1px solid rgba(255,255,255,0.12)",
                          fontSize: "16px",
                        }}
                      />
                      <button
                        type="submit"
                        disabled={emailSaving || !emailValue.trim()}
                        className="px-3 py-2 rounded-lg text-xs font-semibold text-white transition-all hover:brightness-110 disabled:opacity-50 btn-gradient"
                      >
                        {emailSaving ? "…" : "Save"}
                      </button>
                      <button
                        type="button"
                        onClick={() => { setEmailEdit(false); setEmailError(null); setEmailValue(""); }}
                        className="px-3 py-2 rounded-lg text-xs font-medium transition-colors"
                        style={{ color: "var(--pnp-text-secondary)", background: "rgba(255,255,255,0.06)" }}
                      >
                        Cancel
                      </button>
                    </div>
                    {emailError && <p className="text-xs text-red-400">{emailError}</p>}
                    <p className="text-[11px]" style={{ color: "var(--pnp-text-secondary)" }}>
                      We'll notify your current address and send a confirmation to the new one.
                    </p>
                  </form>
                ) : (
                  <div className="flex items-center justify-between">
                    <span className="text-sm" style={{ color: "#EBEBF5" }}>{profileEmail}</span>
                    <button
                      onClick={() => { setEmailEdit(true); setEmailSuccess(null); }}
                      className="text-xs font-medium transition-opacity hover:opacity-70"
                      style={{ color: "var(--pnp-accent, #D4007A)" }}
                    >
                      Change
                    </button>
                  </div>
                )}
              </div>
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
                className="w-full py-3 px-4 rounded-xl font-semibold text-sm text-white transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed btn-gradient"
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

      {/* ── Passkeys ── */}
      <div className="glass-card-sm p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xs font-semibold text-white/50 uppercase tracking-wider">Passkeys</h2>
          {typeof window !== "undefined" && !!window.PublicKeyCredential && (
            <button
              onClick={() => { setPasskeyAddError(null); setPasskeyAddSuccess(false); setPasskeyAddName(""); }}
              className="text-xs font-medium transition-opacity hover:opacity-70"
              style={{ color: "var(--pnp-accent, #D4007A)" }}
            >
              + Add passkey
            </button>
          )}
        </div>
        <p className="text-[11px] mb-4" style={{ color: "var(--pnp-text-secondary)" }}>
          Sign in with Face ID, Touch ID, or a hardware key — no password needed.
        </p>

        {/* Add passkey form */}
        {!passkeyAddSuccess && typeof window !== "undefined" && !!window.PublicKeyCredential && (
          <div className="mb-4 space-y-2">
            <div className="flex gap-2">
              <input
                type="text"
                value={passkeyAddName}
                onChange={(e) => { setPasskeyAddName(e.target.value); setPasskeyAddError(null); }}
                placeholder="Passkey name (optional)"
                maxLength={60}
                disabled={passkeyAdding}
                className="flex-1 py-2 px-3 rounded-lg text-sm text-white placeholder:text-white/30 focus:outline-none focus:ring-1 disabled:opacity-60"
                style={{
                  background: "rgba(255,255,255,0.07)",
                  border: passkeyAddError ? "1px solid #ef4444" : "1px solid rgba(255,255,255,0.12)",
                  fontSize: "16px",
                }}
              />
              <button
                onClick={handleAddPasskey}
                disabled={passkeyAdding}
                className="px-3 py-2 rounded-lg text-xs font-semibold text-white transition-all hover:brightness-110 disabled:opacity-50 btn-gradient flex-shrink-0"
              >
                {passkeyAdding ? "Creating…" : "Create"}
              </button>
            </div>
            {passkeyAddError && <p className="text-xs text-red-400">{passkeyAddError}</p>}
          </div>
        )}
        {passkeyAddSuccess && (
          <div className="mb-4 rounded-xl p-3 text-sm" style={{ background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.3)", color: "#86efac" }}>
            Passkey added! You can now sign in without a password.
          </div>
        )}

        {/* Passkey list */}
        {passkeysLoading ? (
          <div className="space-y-2">
            {[1, 2].map((i) => <div key={i} className="h-12 rounded-xl animate-pulse" style={{ background: "rgba(255,255,255,0.06)" }} />)}
          </div>
        ) : passkeys.length === 0 ? (
          <div className="py-3 text-center">
            <p className="text-sm" style={{ color: "var(--pnp-text-secondary)" }}>No passkeys registered yet.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {passkeys.map((pk) => (
              <div
                key={pk.pk}
                className="flex items-center justify-between px-3 py-2.5 rounded-xl"
                style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
              >
                <div className="flex items-center gap-2.5">
                  <svg className="w-4 h-4 flex-shrink-0" style={{ color: "#a3a3a3" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" />
                  </svg>
                  <div>
                    <p className="text-sm font-medium" style={{ color: "#EBEBF5" }}>{pk.name}</p>
                    {pk.createdAt && (
                      <p className="text-[10px]" style={{ color: "var(--pnp-text-secondary)" }}>
                        Added {new Date(pk.createdAt).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => handleDeletePasskey(pk.pk)}
                  disabled={passkeyDeleting === pk.pk}
                  className="text-xs px-2.5 py-1 rounded-lg transition-colors disabled:opacity-50"
                  style={{ color: "#ef4444", background: "rgba(239,68,68,0.08)" }}
                >
                  {passkeyDeleting === pk.pk ? "…" : "Remove"}
                </button>
              </div>
            ))}
          </div>
        )}

        {typeof window !== "undefined" && !window.PublicKeyCredential && (
          <p className="text-xs mt-2" style={{ color: "var(--pnp-text-secondary)" }}>
            Your browser doesn't support passkeys. Try Chrome or Safari on a modern device.
          </p>
        )}
      </div>

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
              className="text-xs font-semibold underline underline-offset-2 transition-opacity hover:opacity-70 text-pnp-accent"
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
                    {booking.performer_photo && (booking.performer_photo.startsWith("/") || booking.performer_photo.startsWith("http")) ? (
                      <img src={booking.performer_photo} alt={booking.performer_name} className="w-full h-full object-cover" />
                    ) : (
                      <div
                        className="w-10 h-10 rounded-full flex items-center justify-center text-xs font-bold text-white btn-gradient"
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
            <div className="flex gap-4 mb-3">
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
            <button
              type="button"
              onClick={() => navigate("/referrals")}
              className="w-full py-2 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-all hover:brightness-110 active:scale-[0.98]"
              style={{
                background: "rgba(212,0,122,0.10)",
                border: "1px solid rgba(212,0,122,0.25)",
                color: "#D4007A",
              }}
            >
              {uiLang?.toLowerCase().startsWith("en") ? "View Referral Center" : "Ver Centro de Referidos"}
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
              </svg>
            </button>
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
