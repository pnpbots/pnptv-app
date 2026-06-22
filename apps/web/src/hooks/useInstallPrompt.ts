import { useEffect, useState } from "react";

// BeforeInstallPromptEvent isn't in the standard lib types; define a minimal shape.
export type DeferredInstallPrompt = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export function isStandalonePWA(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

// iOS Safari (non-installed) detection — push requires the site be installed
// to Home Screen (iOS 16.4+).
export function isIOSSafariNotInstalled(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  const isIOS =
    /iPad|iPhone|iPod/.test(ua) ||
    // iPadOS 13+ reports as Mac; detect via touch
    (/Mac/.test(ua) && "ontouchend" in document);
  if (!isIOS) return false;
  return !isStandalonePWA();
}

// Module-scoped cache so multiple consumers (modal + pill) share the SAME
// captured beforeinstallprompt event. The browser only fires it once per page
// load — whichever consumer mounts second would otherwise see null.
let cachedEvent: DeferredInstallPrompt | null = null;
let cachedInstalled = false;
const listeners = new Set<(event: DeferredInstallPrompt | null) => void>();
const installedListeners = new Set<() => void>();
let bootstrapped = false;

function bootstrap() {
  if (bootstrapped || typeof window === "undefined") return;
  bootstrapped = true;
  window.addEventListener("beforeinstallprompt", (e: Event) => {
    e.preventDefault();
    cachedEvent = e as DeferredInstallPrompt;
    listeners.forEach((fn) => fn(cachedEvent));
  });
  window.addEventListener("appinstalled", () => {
    cachedEvent = null;
    cachedInstalled = true;
    listeners.forEach((fn) => fn(null));
    installedListeners.forEach((fn) => fn());
  });
}

bootstrap();

/** Synchronous accessor — has a beforeinstallprompt event been captured? */
export function hasCapturedInstallEvent(): boolean {
  return cachedEvent !== null;
}

/** Synchronous accessor — has the app been installed during this session? */
export function wasInstalledThisSession(): boolean {
  return cachedInstalled;
}

export interface InstallPromptState {
  installEvent: DeferredInstallPrompt | null;
  isInstalled: boolean;
  isIOS: boolean;
  /** Programmatically clear the cached install event (e.g. after a successful prompt). */
  clear: () => void;
}

export function useInstallPrompt(): InstallPromptState {
  const [installEvent, setInstallEvent] = useState<DeferredInstallPrompt | null>(cachedEvent);
  const [isInstalled, setIsInstalled] = useState<boolean>(cachedInstalled || isStandalonePWA());

  useEffect(() => {
    const onChange = (ev: DeferredInstallPrompt | null) => setInstallEvent(ev);
    const onInstalled = () => setIsInstalled(true);
    listeners.add(onChange);
    installedListeners.add(onInstalled);
    // Re-sync in case event fired before this hook mounted.
    setInstallEvent(cachedEvent);
    return () => {
      listeners.delete(onChange);
      installedListeners.delete(onInstalled);
    };
  }, []);

  return {
    installEvent,
    isInstalled,
    isIOS: isIOSSafariNotInstalled(),
    clear: () => {
      cachedEvent = null;
      listeners.forEach((fn) => fn(null));
    },
  };
}
