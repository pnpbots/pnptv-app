import React, { useEffect, useState, useCallback } from "react";

const DISMISS_KEY = "pwa_install_dismissed_until";
const DISMISS_DAYS = 3;

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
    String(Date.now() + DISMISS_DAYS * 24 * 60 * 60 * 1000)
  );
}

export function PWAInstallBanner() {
  const [show, setShow] = useState(false);
  const [isIOSDevice, setIsIOSDevice] = useState(false);
  const [showIOSSteps, setShowIOSSteps] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);

  useEffect(() => {
    if (isStandalone() || isDismissed() || isTelegramWebApp()) return;

    const ios = isIOS();
    setIsIOSDevice(ios);

    if (ios) {
      setShow(true);
      return;
    }

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setShow(true);
    };

    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
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
    }
    setDeferredPrompt(null);
  }, [deferredPrompt, isIOSDevice]);

  const handleDismiss = useCallback(() => {
    dismiss();
    setShow(false);
    setShowIOSSteps(false);
  }, []);

  if (!show) return null;

  if (showIOSSteps) {
    return (
      <div className="fixed inset-0 z-[9999] flex items-end justify-center bg-black/70 backdrop-blur-sm p-4">
        <div className="w-full max-w-sm bg-[#1a1a1a] border border-pnp-border rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <img src="/icon-192.png" alt="PNPtv" className="w-10 h-10 rounded-xl" />
              <div>
                <p className="font-bold text-white text-sm">Instalar PNPtv!</p>
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
            Sigue estos pasos para agregar la app a tu pantalla de inicio:
          </p>

          <div className="space-y-3">
            <div className="flex items-start gap-3">
              <span className="w-6 h-6 rounded-full bg-[#D4007A] text-white text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">1</span>
              <p className="text-sm text-white">
                Toca el botón <span className="font-bold">Compartir</span>{" "}
                <svg className="inline w-4 h-4 text-[#007AFF]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                </svg>{" "}
                en la barra inferior de Safari
              </p>
            </div>
            <div className="flex items-start gap-3">
              <span className="w-6 h-6 rounded-full bg-[#D4007A] text-white text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">2</span>
              <p className="text-sm text-white">
                Desplázate y toca <span className="font-bold">"Agregar a pantalla de inicio"</span>
              </p>
            </div>
            <div className="flex items-start gap-3">
              <span className="w-6 h-6 rounded-full bg-[#D4007A] text-white text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">3</span>
              <p className="text-sm text-white">
                Toca <span className="font-bold">"Agregar"</span> en la esquina superior derecha
              </p>
            </div>
          </div>

          <button
            onClick={handleDismiss}
            className="w-full py-2 text-sm text-pnp-textSecondary hover:text-white transition-colors"
          >
            Cerrar
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
            <p className="font-bold text-white text-sm leading-tight">Instala PNPtv!</p>
            <p className="text-xs text-pnp-textSecondary mt-0.5 leading-snug">
              Acceso rápido, notificaciones y experiencia de app completa
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
            {isIOSDevice ? "Cómo instalar" : "Instalar app"}
          </button>
          <button
            onClick={handleDismiss}
            className="px-4 py-2 rounded-xl text-sm text-pnp-textSecondary hover:text-white bg-pnp-surface hover:bg-pnp-border transition-colors"
          >
            Ahora no
          </button>
        </div>
      </div>
    </div>
  );
}
