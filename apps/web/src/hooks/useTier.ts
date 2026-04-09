import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { getGeoCountry } from "@/lib/api";

export interface TierState {
  tier: string;
  isPrime: boolean;
  isMember: boolean;
  isFree: boolean;
  isBanned: boolean;
  isAdmin: boolean;
  hasAccess: (required: "member" | "prime") => boolean;
}

const GEO_CACHE_KEY = "pnptv_geo_latam";

export interface LatamState {
  isLatam: boolean;
  isLatamLoading: boolean;
}

/** Detects whether the current visitor is in a LATAM country.
 *  Result is cached in sessionStorage so only one request is made per session. */
export function useLatam(): LatamState {
  const [isLatam, setIsLatam] = useState(false);
  const [isLatamLoading, setIsLatamLoading] = useState(true);

  useEffect(() => {
    const cached = sessionStorage.getItem(GEO_CACHE_KEY);
    if (cached !== null) {
      setIsLatam(cached === "1");
      setIsLatamLoading(false);
      return;
    }
    getGeoCountry()
      .then((data) => {
        const latam = data.isLatam;
        sessionStorage.setItem(GEO_CACHE_KEY, latam ? "1" : "0");
        setIsLatam(latam);
      })
      .catch(() => {
        // Fail open — never block on geo API error
        sessionStorage.setItem(GEO_CACHE_KEY, "0");
        setIsLatam(false);
      })
      .finally(() => setIsLatamLoading(false));
  }, []);

  return { isLatam, isLatamLoading };
}

export function useTier(): TierState {
  const { user, isAdmin: authIsAdmin } = useAuth();

  // Normalize tier to lowercase; default to "free" when absent
  const tier = (user?.tier || "free").toLowerCase();

  // isAdmin already accounts for role === "admin" | "superadmin" in useAuth
  const isAdmin = authIsAdmin;

  return {
    tier,
    isPrime: tier === "prime" || isAdmin,
    isMember: tier === "member" || tier === "prime" || isAdmin,
    isFree: tier === "free" && !isAdmin,
    isBanned: tier === "banned",
    isAdmin,
    hasAccess: (required: "member" | "prime"): boolean => {
      if (isAdmin) return true;
      if (required === "prime") return tier === "prime";
      if (required === "member") return tier === "member" || tier === "prime";
      return false;
    },
  };
}
