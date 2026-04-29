import { useState, useEffect, useCallback } from "react";
import { updateProfile } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";

const STORAGE_KEY = "pnptv_tutorials_seen_v4";
const NEVER_SHOW_KEY = "pnptv_tutorials_never_show";

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

function isNeverShow(): boolean {
  try {
    return localStorage.getItem(NEVER_SHOW_KEY) === "true";
  } catch {
    return false;
  }
}

function setNeverShow() {
  try {
    localStorage.setItem(NEVER_SHOW_KEY, "true");
  } catch {
    // private browsing
  }
}

export function resetAllTutorials() {
  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(NEVER_SHOW_KEY);
  } catch {
    // private browsing
  }
}

/**
 * One-shot per-browser reset of specific tutorial sections, used to re-show
 * tutorials when a feature gets a meaningful upgrade. Each call ID is gated
 * by its own localStorage flag so a given reset only fires once per user
 * even if the call site is on every page mount.
 *
 * Does NOT touch user.hasSeenTutorial (server-side opt-out) — users who
 * explicitly clicked "never show again" continue to be respected.
 */
export function applyTargetedTutorialReset(resetId: string, sections: string[]) {
  try {
    const flagKey = `pnptv_tutorial_reset:${resetId}`;
    if (localStorage.getItem(flagKey)) return false;
    const map = getSeenMap();
    let mutated = false;
    for (const s of sections) {
      if (map[s]) {
        delete map[s];
        mutated = true;
      }
    }
    if (mutated) localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
    localStorage.setItem(flagKey, "true");
    return mutated;
  } catch {
    return false;
  }
}

export function useTutorial(section: string) {
  const [showTutorial, setShowTutorial] = useState(false);
  const { user } = useAuth();

  useEffect(() => {
    // Never show if user opted out server-side or locally
    if (user?.hasSeenTutorial || isNeverShow()) return;

    const seen = getSeenMap();
    if (seen[section]) return;

    const timer = setTimeout(() => setShowTutorial(true), 600);
    return () => clearTimeout(timer);
  }, [section, user?.hasSeenTutorial]);

  const dismissTutorial = useCallback(() => {
    setShowTutorial(false);
    markSeen(section);
  }, [section]);

  const dismissForever = useCallback(async () => {
    setShowTutorial(false);
    markSeen(section);
    setNeverShow();
    try {
      await updateProfile({ hasSeenTutorial: true });
    } catch {
      // still saved locally even if API fails
    }
  }, [section]);

  // Manual reopen — bypasses seen / never-show flags. Used by in-page
  // "Help" buttons that let users re-read the tutorial after dismissing.
  const openTutorial = useCallback(() => {
    setShowTutorial(true);
  }, []);

  return { showTutorial, dismissTutorial, dismissForever, openTutorial };
}
