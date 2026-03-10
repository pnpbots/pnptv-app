import React, { useEffect, useState, useCallback } from "react";
import { Helmet } from "react-helmet-async";
import { useNavigate } from "react-router-dom";
import { useI18n } from "@/lib/i18n";

function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as any).standalone === true
  );
}

function isIOS(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
}

export default function DownloadPage() {
  const t = useI18n();
  const pwa = t.gates.pwa;
  const navigate = useNavigate();
  const [isIOSDevice] = useState(isIOS);
  const [showIOSSteps, setShowIOSSteps] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [installed, setInstalled] = useState(isStandalone);

  useEffect(() => {
    if (installed) return;

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };

    window.addEventListener("beforeinstallprompt", handler);
    window.addEventListener("appinstalled", () => setInstalled(true));

    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, [installed]);

  const handleInstall = useCallback(async () => {
    if (isIOSDevice) {
      setShowIOSSteps(true);
      return;
    }
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted") setInstalled(true);
    setDeferredPrompt(null);
  }, [deferredPrompt, isIOSDevice]);

  // Already installed — redirect to app
  if (installed) {
    return (
      <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-black/90 backdrop-blur-md p-6">
        <div className="w-full max-w-sm space-y-6 text-center">
          <img src="/icon-192.png" alt="PNPtv" className="w-20 h-20 rounded-2xl mx-auto shadow-2xl" />
          <p className="text-lg font-bold text-white">{pwa.installTitle}</p>
          <p className="text-sm text-green-400">{pwa.featureHomeScreen}</p>
          <button
            onClick={() => navigate("/")}
            className="w-full py-3.5 rounded-2xl text-base font-bold text-white shadow-lg transition-opacity hover:opacity-90"
            style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
          >
            {t.common.open || "Open App"}
          </button>
        </div>
      </div>
    );
  }

  // iOS steps sheet
  if (showIOSSteps) {
    return (
      <>
        <Helmet><title>{pwa.installTitle}</title></Helmet>
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/90 backdrop-blur-md p-6">
          <div className="w-full max-w-sm bg-[#1a1a1a] border border-pnp-border rounded-2xl p-5 space-y-4">
            <div className="flex items-center gap-3">
              <img src="/icon-192.png" alt="PNPtv" className="w-10 h-10 rounded-xl" />
              <div>
                <p className="font-bold text-white text-sm">{pwa.iosSheetTitle}</p>
                <p className="text-xs text-pnp-textSecondary">app.pnptv.app</p>
              </div>
            </div>

            <p className="text-sm text-pnp-textSecondary">{pwa.iosSheetSubtitle}</p>

            <div className="space-y-3">
              {[pwa.iosStep1, pwa.iosStep2, pwa.iosStep3].map((step, i) => (
                <div key={i} className="flex items-start gap-3">
                  <span className="w-6 h-6 rounded-full bg-[#D4007A] text-white text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
                    {i + 1}
                  </span>
                  <p className="text-sm text-white">{step}</p>
                </div>
              ))}
            </div>

            <button
              onClick={() => setShowIOSSteps(false)}
              className="w-full py-2 text-sm text-pnp-textSecondary hover:text-white transition-colors"
            >
              {pwa.close}
            </button>
          </div>
        </div>
      </>
    );
  }

  // Main install interstitial (same design as PWAInstallBanner)
  return (
    <>
      <Helmet><title>{pwa.installTitle}</title></Helmet>
      <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-black/90 backdrop-blur-md p-6">
        <div className="w-full max-w-sm space-y-6 text-center">
          <img src="/icon-192.png" alt="PNPtv" className="w-20 h-20 rounded-2xl mx-auto shadow-2xl" />
          <div>
            <h2 className="text-2xl font-bold text-white mb-2">{pwa.installTitle}</h2>
            <p className="text-pnp-textSecondary text-sm leading-relaxed">
              {pwa.installDescription}
            </p>
          </div>

          <div className="space-y-2 text-left">
            {[
              pwa.featureHomeScreen,
              pwa.featureNotifications,
              pwa.featureFullscreen,
              pwa.featureOffline,
            ].map((f) => (
              <div key={f} className="flex items-center gap-2 text-sm text-white/80">
                <span className="text-green-400 font-bold text-base">+</span> {f}
              </div>
            ))}
          </div>

          <button
            onClick={handleInstall}
            className="w-full py-3.5 rounded-2xl text-base font-bold text-white shadow-lg transition-opacity hover:opacity-90 active:opacity-80"
            style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
          >
            {isIOSDevice ? pwa.howToInstallIphone : pwa.installApp}
          </button>

          <button
            onClick={() => navigate("/")}
            className="w-full py-2.5 text-sm text-pnp-textSecondary hover:text-white transition-colors"
          >
            {pwa.continueInBrowser}
          </button>
        </div>
      </div>
    </>
  );
}
