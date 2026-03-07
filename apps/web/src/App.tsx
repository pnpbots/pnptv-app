import React, { useEffect } from "react";
import { RouterProvider } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import { AuthProvider } from "@/hooks/useAuth";
import { NotificationProvider } from "@/hooks/useNotifications";
import { router } from "@/router";
import ErrorBoundary from "@/components/ErrorBoundary";
import { PWAInstallBanner } from "@/components/PWAInstallBanner";

function useScreenCaptureGuard() {
  useEffect(() => {
    // Blur content when app loses visibility (screen recording, app switcher)
    const onVisibility = () => {
      const root = document.getElementById("root");
      if (!root) return;
      if (document.visibilityState === "hidden") {
        root.style.filter = "blur(20px)";
      } else {
        root.style.filter = "";
      }
    };

    // Block right-click context menu (prevents "Save Image")
    const onContextMenu = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
      e.preventDefault();
    };

    // Block common screenshot keyboard shortcuts
    const onKeyDown = (e: KeyboardEvent) => {
      // PrintScreen
      if (e.key === "PrintScreen") {
        e.preventDefault();
      }
      // Cmd+Shift+3/4/5 (macOS screenshots)
      if (e.metaKey && e.shiftKey && ["3", "4", "5"].includes(e.key)) {
        e.preventDefault();
      }
    };

    document.addEventListener("visibilitychange", onVisibility);
    document.addEventListener("contextmenu", onContextMenu);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      document.removeEventListener("contextmenu", onContextMenu);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);
}

export default function App() {
  useScreenCaptureGuard();

  return (
    <ErrorBoundary>
      <HelmetProvider>
        <AuthProvider>
          <NotificationProvider>
            <RouterProvider router={router} />
            <PWAInstallBanner />
          </NotificationProvider>
        </AuthProvider>
      </HelmetProvider>
    </ErrorBoundary>
  );
}
