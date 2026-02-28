import { useState, useEffect, useCallback } from "react";

const STORAGE_KEY = "pnptv_tutorials_seen";

function getSeenMap(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function markSeen(section: string) {
  try {
    const map = getSeenMap();
    map[section] = true;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // private browsing — silently fail
  }
}

export function resetAllTutorials() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // private browsing
  }
}

export function useTutorial(section: string) {
  const [showTutorial, setShowTutorial] = useState(false);

  useEffect(() => {
    const seen = getSeenMap();
    if (seen[section]) return;

    const timer = setTimeout(() => setShowTutorial(true), 600);
    return () => clearTimeout(timer);
  }, [section]);

  const dismissTutorial = useCallback(() => {
    setShowTutorial(false);
    markSeen(section);
  }, [section]);

  return { showTutorial, dismissTutorial };
}
