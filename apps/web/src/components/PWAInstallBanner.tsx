import React, { useEffect, useState, useCallback } from "react";

const DISMISS_KEY = "pwa_install_dismissed_until";
const DISMISS_HOURS = 6; // Re-show after 6 hours if dismissed

function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as any).standalone === true
  );
}

function isIOS(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
}

function isTelegramWebApp(): boolean {
  try {
    return !!(window as any).Telegram?.WebApp?.initData;
  } catch {
    return false;
  }
}

function isDismissed(): boolean {
  const until = localStorage.getItem(DISMISS_KEY);
  if (!until) return false;
  return Date.now() < Number(until);
}

function dismiss() {
  localStorage.setItem(
    DISMISS_KEY,
    String(Date.now() + DISMISS_HOURS * 60 * 60 * 1000)
  );
}

export function PWAInstallBanner() {
  const [show, setShow] = useState(false);
  const [isIOSDevice, setIsIOSDevice] = useState(false);
  const [showIOSSteps, setShowIOSSteps] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [showInterstitial, setShowInterstitial] = useState(false);

  useEffect(() => {
    if (isStandalone() || isTelegramWebApp()) return;

    const ios = isIOS();
    setIsIOSDevice(ios);

    if (ios) {
      if (!isDismissed()) setShow(true);
      return;
    }

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
      if (!isDismissed()) setShow(true);
    };

    window.addEventListener("beforeinstallprompt", handler);

    // Full-screen interstitial after 4s for any browser visitor
    const timer = setTimeout(() => {
      if (!isDismissed() && !isStandalone()) setShowInterstitial(true);
    }, 4000);

    return () => {
      window.removeEventListener("beforeinstallprompt", handler);
      clearTimeout(timer);
    };
  }, []);

  const handleInstall = useCallback(async () => {
    if (isIOSDevice) {
      setShowIOSSteps(true);
      return;
    }
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted") {
      setShow(false);
      setShowInterstitial(false);
    }
    setDeferredPrompt(null);
  }, [deferredPrompt, isIOSDevice]);

  const handleDismiss = useCallback(() => {
    dismiss();
    setShow(false);
    setShowInterstitial(false);
    setShowIOSSteps(false);
  }, []);

  // Full-screen interstitial shown after 4s
  if (showInterstitial && !isStandalone()) {
    return (
      <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-black/90 backdrop-blur-md p-6">
        <div className="w-full max-w-sm space-y-6 text-center">
          <img src="/icon-192.png" alt="PNPtv" className="w-20 h-20 rounded-2xl mx-auto shadow-2xl" />
          <div>
            <h2 className="text-2xl font-bold text-white mb-2">Install PNPtv!</h2>
            <p className="text-pnp-textSecondary text-sm leading-relaxed">
              Get the full experience — faster access, push notifications, and no browser chrome. Install it on your home screen in seconds.
            </p>
          </div>

          <div className="space-y-2 text-left">
            {[
              "Instant access from your home screen",
              "Push notifications for messages and updates",
              "Full-screen immersive experience",
              "Works offline for key features",
            ].map((f) => (
              <div key={f} className="flex items-center gap-2 text-sm text-white/80">
                <span className="text-green-400 font-bold text-base">+</span> {f}
              </div>
            ))}
          </div>

          <div className="space-y-2">
            <button
              onClick={
                isIOSDevice
                  ? () => { setShowInterstitial(false); setShowIOSSteps(true); }
                  : handleInstall
              }
              className="w-full py-3.5 rounded-2xl text-base font-bold text-white shadow-lg transition-opacity hover:opacity-90 active:opacity-80"
              style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
            >
              {isIOSDevice ? "How to Install on iPhone" : "Install App — It's Free"}
            </button>
            <button
              onClick={handleDismiss}
              className="w-full py-2.5 text-sm text-pnp-textSecondary hover:text-white transition-colors"
            >
              Continue in browser (not recommended)
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!show) return null;

  if (showIOSSteps) {
    return (
      <div className="fixed inset-0 z-[9999] flex items-end justify-center bg-black/70 backdrop-blur-sm p-4">
        <div className="w-full max-w-sm bg-[#1a1a1a] border border-pnp-border rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <img src="/icon-192.png" alt="PNPtv" className="w-10 h-10 rounded-xl" />
              <div>
                <p className="font-bold text-white text-sm">Install PNPtv!</p>
                <p className="text-xs text-pnp-textSecondary">app.pnptv.app</p>
              </div>
            </div>
            <button onClick={handleDismiss} className="text-pnp-textSecondary hover:text-white p-1">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <p className="text-sm text-pnp-textSecondary">
            Add to your home screen for the full app experience:
          </p>

          <div className="space-y-3">
            {[
              <>Tap the <span className="font-bold">Share</span> button in Safari's bottom bar</>,
              <>Scroll down and tap <span className="font-bold">"Add to Home Screen"</span></>,
              <>Tap <span className="font-bold">"Add"</span> in the top-right corner</>,
            ].map((step, i) => (
              <div key={i} className="flex items-start gap-3">
                <span className="w-6 h-6 rounded-full bg-[#D4007A] text-white text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
                  {i + 1}
                </span>
                <p className="text-sm text-white">{step}</p>
              </div>
            ))}
          </div>

          <button
            onClick={handleDismiss}
            className="w-full py-2 text-sm text-pnp-textSecondary hover:text-white transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed bottom-0 left-0 right-0 z-[9998] p-3 lg:p-4">
      <div className="max-w-sm mx-auto lg:max-w-md bg-[#1a1a1a] border border-pnp-border rounded-2xl p-4 shadow-2xl">
        <div className="flex items-center gap-3">
          <img src="/icon-192.png" alt="PNPtv" className="w-12 h-12 rounded-xl flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="font-bold text-white text-sm leading-tight">Install PNPtv!</p>
            <p className="text-xs text-pnp-textSecondary mt-0.5 leading-snug">
              Push notifications, faster access, full-screen experience
            </p>
          </div>
          <button onClick={handleDismiss} className="text-pnp-textSecondary hover:text-white p-1 flex-shrink-0">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex gap-2 mt-3">
          <button
            onClick={handleInstall}
            className="flex-1 py-2 rounded-xl text-sm font-bold text-white transition-opacity hover:opacity-90 active:opacity-80"
            style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
          >
            {isIOSDevice ? "How to Install" : "Install App"}
          </button>
          <button
            onClick={handleDismiss}
            className="px-4 py-2 rounded-xl text-sm text-pnp-textSecondary hover:text-white bg-pnp-surface hover:bg-pnp-border transition-colors"
          >
            Not now
          </button>
        </div>
      </div>
    </div>
  );
}
