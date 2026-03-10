import { useState, useEffect } from "react";

export function useOrientation() {
  const [isLandscape, setIsLandscape] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.innerWidth > window.innerHeight;
  });

  useEffect(() => {
    const update = () => {
      setIsLandscape(window.innerWidth > window.innerHeight);
    };

    // Use screen.orientation API when available (more reliable)
    if (screen.orientation) {
      const onOrientationChange = () => {
        setIsLandscape(screen.orientation.type.startsWith("landscape"));
      };
      screen.orientation.addEventListener("change", onOrientationChange);
      window.addEventListener("resize", update);
      return () => {
        screen.orientation.removeEventListener("change", onOrientationChange);
        window.removeEventListener("resize", update);
      };
    }

    // Fallback: listen to resize
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  return isLandscape;
}
