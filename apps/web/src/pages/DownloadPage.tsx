import React, { useState, useEffect, useRef } from "react";
import { Helmet } from "react-helmet-async";
import { Link } from "react-router-dom";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

declare global {
  interface WindowEventMap {
    beforeinstallprompt: BeforeInstallPromptEvent;
  }
}

const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);

export default function DownloadPage() {
  const lang = navigator.language?.startsWith("es") ? "es" : "en";
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [installing, setInstalling] = useState(false);
  const promptRef = useRef<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    // Check if already installed (standalone mode)
    if (window.matchMedia("(display-mode: standalone)").matches || (navigator as any).standalone) {
      setInstalled(true);
      return;
    }

    const handler = (e: BeforeInstallPromptEvent) => {
      e.preventDefault();
      promptRef.current = e;
      setDeferredPrompt(e);
    };

    window.addEventListener("beforeinstallprompt", handler);
    window.addEventListener("appinstalled", () => setInstalled(true));

    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const handleInstall = async () => {
    const prompt = promptRef.current;
    if (!prompt) return;
    setInstalling(true);
    await prompt.prompt();
    const { outcome } = await prompt.userChoice;
    if (outcome === "accepted") setInstalled(true);
    setInstalling(false);
    setDeferredPrompt(null);
    promptRef.current = null;
  };

  const t = lang === "es"
    ? {
        title: "Instalar PNPtv!",
        desc: "Instala la app directo en tu dispositivo.",
        installBtn: "Instalar App",
        installingBtn: "Instalando...",
        installedMsg: "Ya tienes PNPtv! instalada",
        openApp: "Abrir App",
        iosTitle: "Instalar en iPhone",
        iosStep1: "Toca el boton de Compartir",
        iosStep2: 'Selecciona "Agregar a pantalla de inicio"',
        iosStep3: 'Toca "Agregar"',
        joinNow: "Unete ahora",
      }
    : {
        title: "Install PNPtv!",
        desc: "Install the app directly on your device.",
        installBtn: "Install App",
        installingBtn: "Installing...",
        installedMsg: "PNPtv! is already installed",
        openApp: "Open App",
        iosTitle: "Install on iPhone",
        iosStep1: "Tap the Share button",
        iosStep2: 'Select "Add to Home Screen"',
        iosStep3: 'Tap "Add"',
        joinNow: "Join now",
      };

  return (
    <>
      <Helmet>
        <title>{t.title}</title>
        <meta name="description" content={t.desc} />
      </Helmet>

      <div className="min-h-screen flex flex-col items-center justify-center px-6" style={{ background: "#0A0A0B" }}>
        <div className="max-w-sm w-full text-center space-y-6">
          {/* Logo */}
          <div>
            <span className="text-4xl font-black text-white">PNPtv</span>
            <span className="text-2xl font-bold text-pnp-accent">!</span>
          </div>

          <p className="text-sm text-pnp-textSecondary">{t.desc}</p>

          {installed ? (
            <>
              <p className="text-sm text-green-400 font-medium">{t.installedMsg}</p>
              <Link
                to="/"
                className="block w-full py-3.5 rounded-2xl bg-pnp-accent text-black font-bold text-base text-center transition hover:brightness-110"
              >
                {t.openApp}
              </Link>
            </>
          ) : isIOS ? (
            /* iOS doesn't support beforeinstallprompt — show Safari steps */
            <div className="space-y-4">
              <div className="space-y-3 text-left">
                {[t.iosStep1, t.iosStep2, t.iosStep3].map((step, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <span className="flex-shrink-0 w-8 h-8 rounded-full bg-pnp-accent/20 text-pnp-accent flex items-center justify-center text-sm font-bold">
                      {i + 1}
                    </span>
                    <span className="text-sm text-white">{step}</span>
                  </div>
                ))}
              </div>
              {/* Share icon illustration */}
              <div className="flex justify-center">
                <svg className="w-10 h-10 text-pnp-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 8.25H7.5a2.25 2.25 0 0 0-2.25 2.25v9a2.25 2.25 0 0 0 2.25 2.25h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25H15m0-3-3-3m0 0-3 3m3-3v12" />
                </svg>
              </div>
            </div>
          ) : deferredPrompt ? (
            /* Chrome/Edge/Samsung — native install prompt */
            <button
              onClick={handleInstall}
              disabled={installing}
              className="w-full py-3.5 rounded-2xl bg-pnp-accent text-black font-bold text-base transition hover:brightness-110 disabled:opacity-60"
            >
              {installing ? t.installingBtn : t.installBtn}
            </button>
          ) : (
            /* Fallback — browser doesn't support install prompt yet */
            <Link
              to="/"
              className="block w-full py-3.5 rounded-2xl bg-pnp-accent text-black font-bold text-base text-center transition hover:brightness-110"
            >
              {t.openApp}
            </Link>
          )}

          <Link to="/join" className="block text-xs text-pnp-textSecondary hover:text-white transition">
            {t.joinNow}
          </Link>
        </div>
      </div>
    </>
  );
}
