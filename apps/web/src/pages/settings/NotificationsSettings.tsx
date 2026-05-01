import React, { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/lib/i18n";
import { getVapidKey, subscribePush, unsubscribePush } from "@/lib/api";

// ── Toggle Switch ─────────────────────────────────────────────────────────────

function Toggle({
  checked,
  onChange,
  disabled,
  accentColor,
}: {
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
  accentColor: string;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      disabled={disabled}
      className="relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0"
      style={{ background: checked ? accentColor : "rgba(255,255,255,0.15)" }}
    >
      <span
        className="inline-block h-4 w-4 rounded-full bg-white shadow transition-transform duration-200"
        style={{ transform: checked ? "translateX(22px)" : "translateX(3px)" }}
      />
    </button>
  );
}

// ── NotificationsSettings ─────────────────────────────────────────────────────

type ChannelPrefs = { inApp: boolean; bot: boolean; email: boolean; push: boolean };
type NotifPrefs = Record<string, ChannelPrefs | { enabled: boolean; start: string; end: string }>;

export default function NotificationsSettings() {
  const navigate = useNavigate();
  const { user, isAuthenticated } = useAuth();
  const t = useI18n();
  const p = t.profile;

  const [notifPrefs, setNotifPrefs] = useState<NotifPrefs | null>(null);
  const [notifLoading, setNotifLoading] = useState(true);

  const [notifSoundEnabled, setNotifSoundEnabled] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    return window.localStorage.getItem("pnp.notifSound") !== "0";
  });

  type PushState = "unsupported" | "denied" | "enabled" | "disabled";
  const [pushState, setPushState] = useState<PushState>("disabled");
  const [pushLoading, setPushLoading] = useState(false);

  const [newsletterSubscribed, setNewsletterSubscribed] = useState(() => {
    try { return localStorage.getItem("pnp_newsletter_subscribed") === "1"; } catch { return false; }
  });
  const [newsletterLoading, setNewsletterLoading] = useState(false);

  // Detect push state
  useEffect(() => {
    if (!isAuthenticated) return;
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      setPushState("unsupported"); return;
    }
    if (Notification.permission === "denied") { setPushState("denied"); return; }
    navigator.serviceWorker.ready.then((reg) => {
      reg.pushManager.getSubscription().then((sub) => {
        setPushState(sub ? "enabled" : "disabled");
      }).catch(() => setPushState("disabled"));
    }).catch(() => setPushState("disabled"));
  }, [isAuthenticated]);

  // Load notification preferences
  useEffect(() => {
    if (!isAuthenticated) return;
    let cancelled = false;
    setNotifLoading(true);
    fetch(`${import.meta.env.VITE_API_URL || "https://pnptv.app"}/api/webapp/notifications/preferences`, { credentials: "include" })
      .then(r => r.ok ? r.json() : null)
      .catch(() => null)
      .then((data) => {
        if (cancelled) return;
        if (data?.preferences) setNotifPrefs(data.preferences);
        setNotifLoading(false);
      });
    return () => { cancelled = true; };
  }, [isAuthenticated]);

  const handleNotifSoundToggle = useCallback(() => {
    setNotifSoundEnabled((prev) => {
      const next = !prev;
      try { window.localStorage.setItem("pnp.notifSound", next ? "1" : "0"); } catch { /* noop */ }
      return next;
    });
  }, []);

  const handleNotifToggle = useCallback(async (type: string, channel: string, newValue: boolean) => {
    if (!notifPrefs) return;
    const prev = { ...notifPrefs };
    const typePref = notifPrefs[type] as ChannelPrefs;
    setNotifPrefs({ ...notifPrefs, [type]: { ...typePref, [channel]: newValue } });
    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL || "https://pnptv.app"}/api/webapp/notifications/preferences`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [type]: { [channel]: newValue } }),
      });
      if (!res.ok) setNotifPrefs(prev);
    } catch {
      setNotifPrefs(prev);
    }
  }, [notifPrefs]);

  const handleQuietHoursToggle = useCallback(async () => {
    if (!notifPrefs) return;
    const qh = notifPrefs.quiet_hours as { enabled: boolean; start: string; end: string } | undefined;
    const newEnabled = !(qh?.enabled ?? false);
    const prev = { ...notifPrefs };
    setNotifPrefs({ ...notifPrefs, quiet_hours: { enabled: newEnabled, start: qh?.start ?? "23:00", end: qh?.end ?? "08:00" } });
    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL || "https://pnptv.app"}/api/webapp/notifications/preferences`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quiet_hours: { enabled: newEnabled } }),
      });
      if (!res.ok) setNotifPrefs(prev);
    } catch {
      setNotifPrefs(prev);
    }
  }, [notifPrefs]);

  const handlePushToggle = useCallback(async () => {
    if (pushLoading || pushState === "unsupported" || pushState === "denied") return;
    setPushLoading(true);
    try {
      if (pushState === "enabled") {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (sub) {
          await unsubscribePush(sub.endpoint).catch(() => {});
          await sub.unsubscribe();
        }
        setPushState("disabled");
      } else {
        const permission = await Notification.requestPermission();
        if (permission !== "granted") {
          setPushState(permission === "denied" ? "denied" : "disabled");
          return;
        }
        const { publicKey } = await getVapidKey();
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: publicKey,
        });
        await subscribePush(sub.toJSON() as { endpoint: string; keys: { auth: string; p256dh: string } });
        setPushState("enabled");
      }
    } catch (err) {
      console.warn("Push toggle error:", err);
    } finally {
      setPushLoading(false);
    }
  }, [pushLoading, pushState]);

  const handleNewsletterToggle = useCallback(async () => {
    if (!user?.email) return;
    setNewsletterLoading(true);
    try {
      if (newsletterSubscribed) {
        const res = await fetch("/api/newsletter/subscription/form", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: user.email, list_uuids: [], unsubscribe: true }),
        });
        if (res.ok) { localStorage.setItem("pnp_newsletter_subscribed", "0"); setNewsletterSubscribed(false); }
      } else {
        const res = await fetch("/api/newsletter/subscription", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: user.email, list_ids: [3], name: user.firstName || undefined }),
        });
        if (res.ok) { localStorage.setItem("pnp_newsletter_subscribed", "1"); setNewsletterSubscribed(true); }
      }
    } catch { /* silent */ }
    finally { setNewsletterLoading(false); }
  }, [user, newsletterSubscribed]);

  return (
    <div className="space-y-4">
      {/* ── Notification preferences table ── */}
      <div className="glass-card-sm p-5">
        <h2 className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-3">
          {p.notificationsSection}
        </h2>
        {notifLoading ? (
          <div className="space-y-3">
            <div className="h-4 rounded bg-white/10 animate-pulse w-48" />
            <div className="h-4 rounded bg-white/10 animate-pulse w-40" />
            <div className="h-4 rounded bg-white/10 animate-pulse w-44" />
          </div>
        ) : notifPrefs ? (
          <>
            <p className="text-xs mb-3" style={{ color: "var(--pnp-text-secondary)" }}>
              {p.notifChooseHow}
            </p>

            {/* Column headers */}
            <div className="flex items-center gap-0.5 mb-2 px-1">
              <div className="flex-1 min-w-0" />
              <div className="w-10 text-center text-[9px] font-medium" style={{ color: "var(--pnp-text-secondary)" }}>{p.notifChannelPush}</div>
              <div className="w-10 text-center text-[9px] font-medium" style={{ color: "var(--pnp-text-secondary)" }}>{p.notifChannelBot}</div>
              <div className="w-10 text-center text-[9px] font-medium" style={{ color: "var(--pnp-text-secondary)" }}>{p.notifChannelEmail}</div>
            </div>

            {([
              ["likes", p.notifLikes],
              ["follows", p.notifFollowers],
              ["replies", p.notifReplies],
              ["dms", p.notifDms],
              ["payments", p.notifPayments],
              ["announcements", p.notifAnnouncements],
              ["hangout_calls", p.notifHangoutCalls],
              ["going_live", "Notify me when creators I follow go live"],
            ] as const).map(([key, label]) => {
              const pref = notifPrefs[key] as ChannelPrefs | undefined;
              if (!pref) return null;
              return (
                <div
                  key={key}
                  className="flex items-center gap-0.5 rounded-lg px-2 py-2.5 mb-1"
                  style={{ background: "rgba(255,255,255,0.03)" }}
                >
                  <p className="flex-1 min-w-0 text-sm text-white truncate pr-1">{label}</p>
                  <div className="w-10 flex justify-center flex-shrink-0">
                    <Toggle
                      checked={pref.push !== false}
                      onChange={() => handleNotifToggle(key, "push", pref.push === false)}
                      accentColor="#5ED1C4"
                    />
                  </div>
                  <div className="w-10 flex justify-center flex-shrink-0">
                    <Toggle
                      checked={pref.bot === true}
                      onChange={() => handleNotifToggle(key, "bot", !pref.bot)}
                      accentColor="#5ED1C4"
                    />
                  </div>
                  <div className="w-10 flex justify-center flex-shrink-0">
                    <Toggle
                      checked={pref.email === true}
                      onChange={() => handleNotifToggle(key, "email", !pref.email)}
                      accentColor="#5ED1C4"
                    />
                  </div>
                </div>
              );
            })}

            {/* Quiet Hours */}
            <div
              className="flex items-center justify-between rounded-lg px-3 py-3 mt-3"
              style={{ background: "rgba(102,126,234,0.06)", border: "1px solid rgba(102,126,234,0.15)" }}
            >
              <div className="flex-1 min-w-0 mr-3">
                <p className="text-sm font-medium text-white">{p.quietHours}</p>
                <p className="text-xs mt-0.5" style={{ color: "var(--pnp-text-secondary)" }}>
                  {p.quietHoursDesc}
                </p>
              </div>
              <Toggle
                checked={(notifPrefs.quiet_hours as { enabled: boolean })?.enabled === true}
                onChange={handleQuietHoursToggle}
                accentColor="#667eea"
              />
            </div>

            {/* Sound */}
            <div
              className="flex items-center justify-between rounded-lg px-3 py-3 mt-2"
              style={{ background: "rgba(94,209,196,0.06)", border: "1px solid rgba(94,209,196,0.15)" }}
            >
              <div className="flex-1 min-w-0 mr-3">
                <p className="text-sm font-medium text-white">{p.notifSoundTitle}</p>
                <p className="text-xs mt-0.5" style={{ color: "var(--pnp-text-secondary)" }}>
                  {p.notifSoundDesc}
                </p>
              </div>
              <Toggle
                checked={notifSoundEnabled}
                onChange={handleNotifSoundToggle}
                accentColor="#5ED1C4"
              />
            </div>
          </>
        ) : (
          <p className="text-xs" style={{ color: "var(--pnp-text-secondary)" }}>
            {p.notifLoadError}
          </p>
        )}
      </div>

      {/* ── Communications ── */}
      <div className="glass-card-sm p-5">
        <h2 className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-4">
          Communications
        </h2>

        {/* Newsletter */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex-1 min-w-0 mr-4">
            <p className="text-sm text-white font-medium">PNPtv! Newsletter</p>
            <p className="text-xs mt-0.5" style={{ color: "var(--pnp-text-secondary)" }}>
              Receive creator drops, platform news, and exclusive offers by email.
            </p>
          </div>
          <Toggle
            checked={newsletterSubscribed}
            onChange={handleNewsletterToggle}
            disabled={newsletterLoading || !user?.email}
            accentColor="#D4007A"
          />
        </div>

        {/* Browser push */}
        <div className="flex items-center justify-between">
          <div className="flex-1 min-w-0 mr-4">
            <p className="text-sm text-white font-medium">Browser Notifications</p>
            <p className="text-xs mt-0.5" style={{ color: "var(--pnp-text-secondary)" }}>
              {pushState === "unsupported"
                ? "Push notifications are not supported in this browser."
                : pushState === "denied"
                ? "Notifications blocked. Allow them in your browser settings."
                : pushState === "enabled"
                ? "You will receive push notifications for messages and invites."
                : "Enable to get notified about messages and hangout invites."}
            </p>
          </div>
          {pushState === "unsupported" || pushState === "denied" ? (
            <span
              className="text-xs px-2.5 py-1 rounded-full flex-shrink-0"
              style={{
                background: "rgba(255,255,255,0.07)",
                color: "var(--pnp-text-secondary)",
                border: "1px solid rgba(255,255,255,0.12)",
              }}
            >
              {pushState === "unsupported" ? "N/A" : "Blocked"}
            </span>
          ) : (
            <Toggle
              checked={pushState === "enabled"}
              onChange={handlePushToggle}
              disabled={pushLoading}
              accentColor="#5ED1C4"
            />
          )}
        </div>
      </div>

      {/* ── Back to settings ── */}
      <button
        onClick={() => navigate("/settings")}
        className="w-full py-3 rounded-xl text-sm font-medium transition-colors hover:text-white"
        style={{ color: "var(--pnp-text-secondary)", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}
      >
        {t.profile.back}
      </button>
    </div>
  );
}
