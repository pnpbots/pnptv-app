import React, { useState, useEffect } from "react";
import { Helmet } from "react-helmet-async";
import { Link } from "react-router-dom";

type Platform = "ios" | "android" | "desktop" | "unknown";

function detectPlatform(): Platform {
  const ua = navigator.userAgent || "";
  if (/iPad|iPhone|iPod/.test(ua)) return "ios";
  if (/Android/i.test(ua)) return "android";
  return "desktop";
}

type Lang = "en" | "es";

const t = {
  en: {
    pageTitle: "Download PNPtv!",
    pageDesc: "Install PNPtv! on your device — no app store needed.",
    heading: "Get PNPtv! on your device",
    subtitle: "PNPtv! is a Progressive Web App. Install it directly from your browser for the best experience — push notifications, full screen, and offline access.",
    iosTitle: "Install on iPhone / iPad",
    iosSteps: [
      "Open **Safari** and go to **app.pnptv.app**",
      "Tap the **Share** button (square with arrow at the bottom)",
      "Scroll down and tap **\"Add to Home Screen\"**",
      'Tap **\"Add\"** in the top-right corner',
      "PNPtv! will appear on your home screen like a native app",
    ],
    iosNote: "You must use Safari — Chrome and other browsers on iOS don't support installing PWAs.",
    androidTitle: "Install on Android",
    androidSteps: [
      "Open **Chrome** and go to **app.pnptv.app**",
      "Tap the **three-dot menu** (⋮) in the top-right corner",
      "Tap **\"Install app\"** or **\"Add to Home Screen\"**",
      "Confirm by tapping **\"Install\"**",
      "PNPtv! will appear in your app drawer and home screen",
    ],
    androidNote: "Works best with Chrome or Samsung Internet.",
    desktopTitle: "Install on Desktop",
    desktopSteps: [
      "Open **Chrome**, **Edge**, or **Brave** and go to **app.pnptv.app**",
      "Click the **install icon** (⊕) in the address bar, or open the browser menu",
      "Click **\"Install PNPtv!\"**",
      "The app will open in its own window — pin it to your taskbar or dock",
    ],
    desktopNote: "Firefox and Safari on desktop don't support PWA install. Use a Chromium-based browser.",
    whyInstall: "Why install?",
    benefits: [
      { icon: "🔔", title: "Push notifications", desc: "Never miss a message, stream, or hangout invite." },
      { icon: "📱", title: "Full-screen experience", desc: "No browser bars — feels like a native app." },
      { icon: "⚡", title: "Faster launch", desc: "Opens instantly from your home screen." },
      { icon: "🔒", title: "Privacy", desc: "No app store tracking. No data shared with Apple or Google." },
    ],
    alreadyHaveAccount: "Already have an account?",
    openApp: "Open PNPtv!",
    newHere: "New here?",
    joinNow: "Join now",
  },
  es: {
    pageTitle: "Descargar PNPtv!",
    pageDesc: "Instala PNPtv! en tu dispositivo — sin tienda de aplicaciones.",
    heading: "Instala PNPtv! en tu dispositivo",
    subtitle: "PNPtv! es una Progressive Web App. Instálala directamente desde tu navegador para la mejor experiencia — notificaciones push, pantalla completa y acceso offline.",
    iosTitle: "Instalar en iPhone / iPad",
    iosSteps: [
      "Abre **Safari** y ve a **app.pnptv.app**",
      "Toca el botón **Compartir** (cuadrado con flecha en la parte inferior)",
      "Desplázate y toca **\"Agregar a pantalla de inicio\"**",
      'Toca **\"Agregar\"** en la esquina superior derecha',
      "PNPtv! aparecerá en tu pantalla de inicio como una app nativa",
    ],
    iosNote: "Debes usar Safari — Chrome y otros navegadores en iOS no soportan instalar PWAs.",
    androidTitle: "Instalar en Android",
    androidSteps: [
      "Abre **Chrome** y ve a **app.pnptv.app**",
      "Toca el **menú de tres puntos** (⋮) en la esquina superior derecha",
      "Toca **\"Instalar aplicación\"** o **\"Agregar a pantalla de inicio\"**",
      "Confirma tocando **\"Instalar\"**",
      "PNPtv! aparecerá en tu cajón de apps y pantalla de inicio",
    ],
    androidNote: "Funciona mejor con Chrome o Samsung Internet.",
    desktopTitle: "Instalar en Escritorio",
    desktopSteps: [
      "Abre **Chrome**, **Edge** o **Brave** y ve a **app.pnptv.app**",
      "Haz clic en el **ícono de instalación** (⊕) en la barra de direcciones, o abre el menú del navegador",
      "Haz clic en **\"Instalar PNPtv!\"**",
      "La app se abrirá en su propia ventana — fíjala en tu barra de tareas o dock",
    ],
    desktopNote: "Firefox y Safari en escritorio no soportan instalación de PWA. Usa un navegador basado en Chromium.",
    whyInstall: "¿Por qué instalar?",
    benefits: [
      { icon: "🔔", title: "Notificaciones push", desc: "No te pierdas un mensaje, stream o invitación a hangout." },
      { icon: "📱", title: "Experiencia pantalla completa", desc: "Sin barras del navegador — se siente como una app nativa." },
      { icon: "⚡", title: "Inicio más rápido", desc: "Se abre al instante desde tu pantalla de inicio." },
      { icon: "🔒", title: "Privacidad", desc: "Sin rastreo de tienda de apps. Sin datos compartidos con Apple o Google." },
    ],
    alreadyHaveAccount: "¿Ya tienes cuenta?",
    openApp: "Abrir PNPtv!",
    newHere: "¿Eres nuevo?",
    joinNow: "Únete ahora",
  },
};

function renderMarkdown(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? (
      <strong key={i} className="text-white font-semibold">
        {part.slice(2, -2)}
      </strong>
    ) : (
      <span key={i}>{part}</span>
    )
  );
}

function StepList({ steps, note }: { steps: string[]; note: string }) {
  return (
    <div className="space-y-2">
      <ol className="space-y-2">
        {steps.map((step, i) => (
          <li key={i} className="flex gap-3 text-sm text-pnp-textSecondary leading-relaxed">
            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-pnp-accent/20 text-pnp-accent flex items-center justify-center text-xs font-bold">
              {i + 1}
            </span>
            <span>{renderMarkdown(step)}</span>
          </li>
        ))}
      </ol>
      <p className="text-xs text-pnp-textSecondary/70 mt-2 pl-9 italic">{note}</p>
    </div>
  );
}

export default function DownloadPage() {
  const lang: Lang = navigator.language?.startsWith("es") ? "es" : "en";
  const s = t[lang];
  const [platform, setPlatform] = useState<Platform>("unknown");
  const [expanded, setExpanded] = useState<Platform | null>(null);

  useEffect(() => {
    const p = detectPlatform();
    setPlatform(p);
    setExpanded(p === "unknown" ? null : p);
  }, []);

  const sections: { key: Platform; title: string; icon: string; steps: string[]; note: string }[] = [
    { key: "ios", title: s.iosTitle, icon: "🍎", steps: s.iosSteps, note: s.iosNote },
    { key: "android", title: s.androidTitle, icon: "🤖", steps: s.androidSteps, note: s.androidNote },
    { key: "desktop", title: s.desktopTitle, icon: "💻", steps: s.desktopSteps, note: s.desktopNote },
  ];

  // Put detected platform first
  const sorted = [...sections].sort((a, b) => {
    if (a.key === platform) return -1;
    if (b.key === platform) return 1;
    return 0;
  });

  return (
    <>
      <Helmet>
        <title>{s.pageTitle}</title>
        <meta name="description" content={s.pageDesc} />
        <meta property="og:title" content={s.pageTitle} />
        <meta property="og:description" content={s.pageDesc} />
        <meta property="og:type" content="website" />
      </Helmet>

      <div className="min-h-screen" style={{ background: "#0A0A0B", color: "#fff" }}>
        {/* Top bar */}
        <div
          className="sticky top-0 z-50 flex items-center justify-between gap-3 px-4 py-3"
          style={{
            background: "rgba(10,10,11,0.92)",
            backdropFilter: "blur(12px)",
            borderBottom: "1px solid rgba(255,255,255,0.06)",
          }}
        >
          <Link to="/" className="flex items-center gap-1.5">
            <span className="text-sm font-black text-white">PNPtv</span>
            <span className="text-[10px] font-bold text-pnp-accent">!</span>
          </Link>
          <Link
            to="/join"
            className="text-xs font-semibold px-3 py-1.5 rounded-full bg-pnp-accent text-black hover:brightness-110 transition"
          >
            {s.joinNow}
          </Link>
        </div>

        <div className="max-w-lg mx-auto px-4 py-8 space-y-8">
          {/* Hero */}
          <div className="text-center space-y-3">
            <div className="text-5xl">📲</div>
            <h1 className="text-2xl font-black tracking-tight">{s.heading}</h1>
            <p className="text-sm text-pnp-textSecondary leading-relaxed">{s.subtitle}</p>
          </div>

          {/* Platform install guides */}
          <div className="space-y-3">
            {sorted.map((sec) => {
              const isExpanded = expanded === sec.key;
              const isDetected = platform === sec.key;
              return (
                <div
                  key={sec.key}
                  className={`rounded-2xl border transition-all ${
                    isDetected
                      ? "border-pnp-accent/40 bg-pnp-accent/5"
                      : "border-pnp-border bg-pnp-surface"
                  }`}
                >
                  <button
                    onClick={() => setExpanded(isExpanded ? null : sec.key)}
                    className="w-full flex items-center justify-between px-4 py-3.5 text-left"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-xl">{sec.icon}</span>
                      <span className="text-sm font-semibold text-white">{sec.title}</span>
                      {isDetected && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-pnp-accent/20 text-pnp-accent">
                          {lang === "es" ? "Tu dispositivo" : "Your device"}
                        </span>
                      )}
                    </div>
                    <svg
                      className={`w-4 h-4 text-pnp-textSecondary transition-transform ${isExpanded ? "rotate-180" : ""}`}
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  {isExpanded && (
                    <div className="px-4 pb-4">
                      <StepList steps={sec.steps} note={sec.note} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Why install */}
          <div className="space-y-3">
            <h2 className="text-lg font-bold">{s.whyInstall}</h2>
            <div className="grid grid-cols-2 gap-2">
              {s.benefits.map((b) => (
                <div key={b.title} className="p-3 rounded-xl bg-pnp-surface border border-pnp-border space-y-1">
                  <span className="text-lg">{b.icon}</span>
                  <p className="text-xs font-semibold text-white">{b.title}</p>
                  <p className="text-[11px] text-pnp-textSecondary leading-snug">{b.desc}</p>
                </div>
              ))}
            </div>
          </div>

          {/* CTAs */}
          <div className="space-y-3 pb-8">
            <div className="text-center">
              <p className="text-xs text-pnp-textSecondary mb-2">{s.alreadyHaveAccount}</p>
              <Link
                to="/"
                className="inline-block text-sm font-semibold px-6 py-2.5 rounded-full bg-white text-black hover:brightness-90 transition"
              >
                {s.openApp}
              </Link>
            </div>
            <div className="text-center">
              <p className="text-xs text-pnp-textSecondary mb-2">{s.newHere}</p>
              <Link
                to="/join"
                className="inline-block text-sm font-semibold px-6 py-2.5 rounded-full bg-pnp-accent text-black hover:brightness-110 transition"
              >
                {s.joinNow}
              </Link>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
