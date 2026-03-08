import React, { useEffect } from "react";
import { RouterProvider } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import { AuthProvider } from "@/hooks/useAuth";
import { NotificationProvider } from "@/hooks/useNotifications";
import { router } from "@/router";
import ErrorBoundary from "@/components/ErrorBoundary";
import { PWAInstallBanner } from "@/components/PWAInstallBanner";
import { NotificationPermissionPrompt } from "@/components/NotificationPermissionPrompt";
import { useAuth } from "@/hooks/useAuth";

function useScreenCaptureGuard() {
  useEffect(() => {
    const root = document.getElementById("root");

    // ── 1. Blur content when app loses visibility (app switcher, screen recording) ──
    const onVisibility = () => {
      if (!root) return;
      if (document.visibilityState === "hidden") {
        root.style.filter = "blur(30px)";
        root.style.transition = "filter 0.05s";
      } else {
        root.style.filter = "";
      }
    };

    // ── 2. Also blur on window blur (catches iOS app-switcher preview) ──
    // Skip blur when a Jitsi/8x8 iframe is active (clicking inside iframe triggers window blur)
    const onWindowBlur = () => {
      if (root) {
        const activeEl = document.activeElement;
        const iframeSrc = (activeEl as HTMLIFrameElement)?.src || "";
        if (activeEl?.tagName === "IFRAME" && (iframeSrc.includes("8x8.vc") || iframeSrc.includes("jit.si"))) {
          return; // User clicked inside the video call iframe — don't blur
        }
        root.style.filter = "blur(30px)";
        root.style.transition = "filter 0.05s";
      }
    };
    const onWindowFocus = () => {
      if (root) root.style.filter = "";
    };

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
      if (origGetDisplayMedia) {
        navigator.mediaDevices.getDisplayMedia = () =>
          Promise.reject(new DOMException("Screen capture is not allowed", "NotAllowedError"));
      }
    }

    document.addEventListener("visibilitychange", onVisibility);
    document.addEventListener("contextmenu", onContextMenu);
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("dragstart", onDragStart);
    window.addEventListener("blur", onWindowBlur);
    window.addEventListener("focus", onWindowFocus);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      document.removeEventListener("contextmenu", onContextMenu);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("dragstart", onDragStart);
      window.removeEventListener("blur", onWindowBlur);
      window.removeEventListener("focus", onWindowFocus);
    };
  }, []);
}

function AppOverlays() {
  const { isAuthenticated } = useAuth();
  return (
    <>
      <PWAInstallBanner />
      <NotificationPermissionPrompt isAuthenticated={isAuthenticated} />
    </>
  );
}

export default function App() {
  useScreenCaptureGuard();

  return (
    <ErrorBoundary>
      <HelmetProvider>
        <AuthProvider>
          <NotificationProvider>
            <RouterProvider router={router} />
            <AppOverlays />
          </NotificationProvider>
        </AuthProvider>
      </HelmetProvider>
    </ErrorBoundary>
  );
}
