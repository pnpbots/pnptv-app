import React, { useEffect, useState } from "react";
import { RouterProvider } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import { AuthProvider } from "@/hooks/useAuth";
import { NotificationProvider } from "@/hooks/useNotifications";
import { MusicPlayerProvider } from "@/hooks/useMusicPlayer";
import { router } from "@/router";
import { useI18n } from "@/lib/i18n";
import ErrorBoundary from "@/components/ErrorBoundary";
import { NotificationPermissionPrompt } from "@/components/NotificationPermissionPrompt";
import { PermissionOnboarding } from "@/components/PermissionOnboarding";
import { useAuth } from "@/hooks/useAuth";
import { getSocket, connectSocket, disconnectSocket } from "@/lib/socket";

// ── LATAM landing-mode guard ──────────────────────────────────────────────────
// The backend's Express geo-block middleware can't run for static SPA HTML
// routes (pnptv-web nginx serves them directly), so the SPA has to self-check
// and redirect LATAM visitors to /landing?focus=performer. Grandfathered
// active users (signaled by landingMode=false from /api/webapp/geo) pass through.
const LANDING_MODE_ALLOWED = new Set([
  "/", "/landing", "/join", "/auth",
  "/become-a-model", "/become-model", "/apply",
  "/about", "/blog", "/careers", "/resources", "/download",
  "/terms", "/privacy", "/cookies", "/community-guidelines",
  "/content-policy", "/refunds", "/subscriptions", "/creator-terms",
  "/dmca", "/safety", "/contact",
]);
const LANDING_MODE_PREFIXES = ["/page/", "/blog/", "/auth/"];

function useLatamLandingGuard() {
  useEffect(() => {
    const CACHE_KEY = "pnptv_landing_mode";
    const path = window.location.pathname;

    const pathAllowed =
      LANDING_MODE_ALLOWED.has(path) ||
      LANDING_MODE_PREFIXES.some(p => path.startsWith(p));

    const redirectIfNeeded = (payload: { country: string | null; landingMode: boolean }) => {
      if (!payload.landingMode) return;
      if (pathAllowed) return;
      const qs = new URLSearchParams({ focus: "performer" });
      if (payload.country) qs.set("country", payload.country);
      window.location.replace(`/landing?${qs.toString()}`);
    };

    // Try cache first — avoids a redirect flash on repeat navigations
    try {
      const cached = sessionStorage.getItem(CACHE_KEY);
      if (cached) {
        const parsed = JSON.parse(cached);
        redirectIfNeeded(parsed);
        if (parsed.landingMode && !pathAllowed) return; // already redirecting
      }
    } catch { /* ignore */ }

    fetch("/api/webapp/geo", { credentials: "include" })
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        if (!data) return;
        const payload = { country: data.country, landingMode: !!data.landingMode };
        try { sessionStorage.setItem(CACHE_KEY, JSON.stringify(payload)); } catch { /* ignore */ }
        redirectIfNeeded(payload);
      })
      .catch(() => { /* fail open — user sees app */ });
  }, []);
}

function useScreenCaptureGuard() {
  useEffect(() => {
    const root = document.getElementById("root");

    // ── 1 & 2. Visibility/window blur guards — DISABLED ──

    // ── 3. Block right-click context menu (prevents "Save Image As") ──
    const onContextMenu = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
      e.preventDefault();
    };

    // ── 4. Block screenshot & save keyboard shortcuts ──
    const onKeyDown = (e: KeyboardEvent) => {
      // PrintScreen
      if (e.key === "PrintScreen") {
        e.preventDefault();
        navigator.clipboard?.writeText("").catch(() => {});
      }
      // Cmd+Shift+3/4/5 (macOS screenshots)
      if (e.metaKey && e.shiftKey && ["3", "4", "5"].includes(e.key)) {
        e.preventDefault();
      }
      // Ctrl/Cmd+P (print)
      if ((e.ctrlKey || e.metaKey) && e.key === "p") {
        e.preventDefault();
      }
      // Ctrl/Cmd+S (save page)
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
      }
      // Ctrl/Cmd+Shift+I (dev tools — optional deterrent)
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "I") {
        e.preventDefault();
      }
      // F12 (dev tools)
      if (e.key === "F12") {
        e.preventDefault();
      }
    };

    // ── 5. Block image/video drag (prevents drag-to-desktop saving) ──
    const onDragStart = (e: DragEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "IMG" || target.tagName === "VIDEO" || target.tagName === "CANVAS") {
        e.preventDefault();
      }
    };

    // ── 6. Block Screen Capture API (getDisplayMedia) ──
    if (navigator.mediaDevices) {
      const origGetDisplayMedia = navigator.mediaDevices.getDisplayMedia;
      if (typeof origGetDisplayMedia === "function") {
        navigator.mediaDevices.getDisplayMedia = () =>
          Promise.reject(new DOMException("Screen capture is not allowed", "NotAllowedError"));
      }
    }

    document.addEventListener("contextmenu", onContextMenu);
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("dragstart", onDragStart);

    return () => {
      document.removeEventListener("contextmenu", onContextMenu);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("dragstart", onDragStart);
    };
  }, []);
}

function useDocumentDir() {
  const { lang } = useI18n();
  useEffect(() => {
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
    document.documentElement.lang = lang;
  }, [lang]);
}

function UpdateBanner() {
  const [waitingSW, setWaitingSW] = useState<ServiceWorker | null>(null);

  useEffect(() => {
    const handler = (e: Event) => setWaitingSW((e as CustomEvent).detail);
    window.addEventListener("sw-update-available", handler);
    return () => window.removeEventListener("sw-update-available", handler);
  }, []);

  if (!waitingSW) return null;

  return (
    <div
      className="fixed top-0 left-0 right-0 z-[9999] flex items-center justify-center gap-3 px-4 py-3 text-sm font-semibold text-white animate-fade-in-up"
      style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
    >
      <span>A new version of PNPtv! is available</span>
      <button
        onClick={() => {
          waitingSW.postMessage({ type: "SKIP_WAITING" });
        }}
        className="px-4 py-1.5 rounded-lg text-sm font-bold transition-all active:scale-95"
        style={{ background: "rgba(255,255,255,0.25)", backdropFilter: "blur(4px)" }}
      >
        Update Now
      </button>
    </div>
  );
}

function useGlobalSocketEvents() {
  const { isAuthenticated, logout } = useAuth();
  const [suspendedMsg, setSuspendedMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!isAuthenticated) return;
    const socket = connectSocket();

    const onSessionExpired = () => {
      disconnectSocket();
      // Redirect to login — full page reload clears all state
      window.location.href = "/login?reason=session_expired";
    };

    const onSuspended = (data: { message?: string }) => {
      disconnectSocket();
      setSuspendedMsg(data?.message || "Your account has been suspended.");
      setTimeout(() => {
        if (logout) logout();
        window.location.href = "/login?reason=suspended";
      }, 4000);
    };

    socket.on("auth:session_expired", onSessionExpired);
    socket.on("auth:suspended", onSuspended);
    return () => {
      socket.off("auth:session_expired", onSessionExpired);
      socket.off("auth:suspended", onSuspended);
    };
  }, [isAuthenticated]);

  return { suspendedMsg };
}

function AppOverlays() {
  const { isAuthenticated } = useAuth();
  const { suspendedMsg } = useGlobalSocketEvents();
  useDocumentDir();
  return (
    <>
      <UpdateBanner />
      <PermissionOnboarding isAuthenticated={isAuthenticated} />
      <NotificationPermissionPrompt isAuthenticated={isAuthenticated} />
      {suspendedMsg && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 p-6">
          <div className="bg-[#1C1C1E] border border-red-500/40 rounded-2xl p-6 max-w-sm w-full text-center space-y-3">
            <p className="text-2xl">⛔</p>
            <p className="text-red-400 font-semibold">Account Suspended</p>
            <p className="text-pnp-textSecondary text-sm">{suspendedMsg}</p>
            <p className="text-pnp-textSecondary text-xs">Redirecting to login…</p>
          </div>
        </div>
      )}
    </>
  );
}

export default function App() {
  useLatamLandingGuard();
  useScreenCaptureGuard();

  return (
    <ErrorBoundary>
      <HelmetProvider>
        <AuthProvider>
          <NotificationProvider>
            <MusicPlayerProvider>
              <RouterProvider router={router} />
              <AppOverlays />
            </MusicPlayerProvider>
          </NotificationProvider>
        </AuthProvider>
      </HelmetProvider>
    </ErrorBoundary>
  );
}
