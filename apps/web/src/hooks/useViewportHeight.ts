import { useEffect } from "react";

/**
 * Sets a CSS custom property --app-vh equal to 1% of the true visible viewport height.
 * Unlike 100vh/100dvh, window.innerHeight is always the actual visible area
 * in all browsers, webviews (Telegram, iOS Safari, Android Chrome).
 *
 * Usage in CSS/Tailwind: height: calc(var(--app-vh, 1vh) * 100)
 */
export function useViewportHeight() {
  useEffect(() => {
    const update = () => {
      // Telegram WebApp provides viewportStableHeight which doesn't change with keyboard
      const tg = (window as any).Telegram?.WebApp;
      const h = tg?.viewportStableHeight || window.innerHeight;
      document.documentElement.style.setProperty("--app-vh", `${h * 0.01}px`);
    };

    update();
    window.addEventListener("resize", update);
    // visualViewport is more reliable on iOS for tracking viewport changes
    window.visualViewport?.addEventListener("resize", update);

    return () => {
      window.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("resize", update);
    };
  }, []);
}
