import { useEffect, useState } from "react";

/**
 * Returns the current window.location.pathname and re-renders on navigation,
 * without requiring a Router context. Useful for components mounted OUTSIDE
 * the RouterProvider (e.g. App-level overlays) that still need to react to
 * route changes.
 *
 * Listens to:
 *   - `popstate` (back/forward)
 *   - `pnptv:navigation` (custom event dispatched by useNavigationDiagnostics
 *     in App.tsx for pushState/replaceState/popstate)
 */
export function useExternalPathname(): string {
  const [pathname, setPathname] = useState<string>(() =>
    typeof window === "undefined" ? "/" : window.location.pathname
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const update = () => setPathname(window.location.pathname);
    window.addEventListener("popstate", update);
    window.addEventListener("pnptv:navigation", update as EventListener);
    return () => {
      window.removeEventListener("popstate", update);
      window.removeEventListener("pnptv:navigation", update as EventListener);
    };
  }, []);

  return pathname;
}

/**
 * Returns true when the current pathname matches one of the floating-UI
 * exclusion paths (checkout, payment, subscribe, lifetime100, main-stage).
 * Use this to hide pills/FABs on conversion-critical pages.
 */
export function isExcludedFromFloatingUI(pathname: string): boolean {
  if (!pathname) return false;
  const exact = new Set<string>([
    "/checkout",
    "/payment",
    "/subscribe",
    "/lifetime100",
    "/payment-checkout",
    "/main-stage",
  ]);
  if (exact.has(pathname)) return true;
  if (pathname.startsWith("/payment/")) return true;
  if (pathname.startsWith("/checkout/")) return true;
  return false;
}
