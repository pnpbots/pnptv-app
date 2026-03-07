import { useAuth } from "@/hooks/useAuth";

export interface TierState {
  tier: string;
  isPrime: boolean;
  isMember: boolean;
  isFree: boolean;
  isBanned: boolean;
  isAdmin: boolean;
  hasAccess: (required: "member" | "prime") => boolean;
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
