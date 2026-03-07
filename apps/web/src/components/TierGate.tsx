import React from "react";
import { useNavigate } from "react-router-dom";
import { Card } from "@pnptv/ui-kit";
import { useAuth } from "@/hooks/useAuth";
import { useTier } from "@/hooks/useTier";
import { useI18n } from "@/lib/i18n";

interface TierGateProps {
  /** Minimum tier required to see children */
  required: "member" | "prime";
  children: React.ReactNode;
}

// ---------------------------------------------------------------------------
// Spinner — shared between loading and unauthenticated states
// ---------------------------------------------------------------------------
function Spinner() {
  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="animate-spin w-8 h-8 border-2 border-white/20 border-t-white rounded-full" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Feature row
// ---------------------------------------------------------------------------
interface Feature {
  icon: string;
  label: string;
}

function FeatureList({ features }: { features: Feature[] }) {
  return (
    <ul className="space-y-3 mb-6">
      {features.map((feature) => (
        <li key={feature.label} className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-pnp-accent/10 flex items-center justify-center flex-shrink-0">
            <svg
              className="w-4 h-4 text-pnp-accent"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d={feature.icon}
              />
            </svg>
          </div>
          <span className="text-sm text-pnp-textPrimary">{feature.label}</span>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Upsell card — prime variant
// ---------------------------------------------------------------------------
function PrimeUpsell() {
  const navigate = useNavigate();
  const t = useI18n();
  const p = t.gates.prime;
  const { isMember } = useTier();

  const features: Feature[] = [
    {
      icon: "M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z M15 11a3 3 0 11-6 0 3 3 0 016 0z",
      label: p.featureNearby,
    },
    {
      icon: "M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z",
      label: p.featureHangouts,
    },
    {
      icon: "M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z",
      label: p.featureVideo,
    },
    {
      icon: "M12 19l9 2-9-18-9 18 9-2zm0 0v-8",
      label: p.featureTelegram,
    },
  ];

  return (
    <div className="page-container flex items-center justify-center min-h-[60vh]">
      <Card className="max-w-md w-full p-6">
        <div className="text-center mb-6">
          <div className="w-16 h-16 rounded-full bg-[#D4007A]/20 flex items-center justify-center mx-auto mb-4">
            <svg
              className="w-8 h-8 text-[#D4007A]"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
              />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-pnp-textPrimary mb-2">
            {p.title}
          </h2>
          <p className="text-sm text-pnp-textSecondary">
            {isMember ? p.memberUpgradeMsg : p.unlockMsg}
          </p>
        </div>

        <FeatureList features={features} />

        <button
          onClick={() => navigate("/subscribe")}
          className="btn-gradient w-full py-3 rounded-xl font-semibold text-white"
        >
          {isMember ? p.upgradeToPrime : p.getPrime}
        </button>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Upsell card — member variant
// ---------------------------------------------------------------------------
function MemberUpsell() {
  const navigate = useNavigate();

  const features: Feature[] = [
    {
      icon: "M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z",
      label: "Join hangout rooms",
    },
    {
      icon: "M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z",
      label: "Unlimited direct messages",
    },
    {
      icon: "M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z",
      label: "Browse all user profiles",
    },
    {
      icon: "M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z",
      label: "Watch live streams",
    },
  ];

  return (
    <div className="page-container flex items-center justify-center min-h-[60vh]">
      <Card className="max-w-md w-full p-6">
        <div className="text-center mb-6">
          <div className="w-16 h-16 rounded-full bg-[#D4007A]/20 flex items-center justify-center mx-auto mb-4">
            <svg
              className="w-8 h-8 text-[#D4007A]"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
              />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-pnp-textPrimary mb-2">
            Become a PNP Member
          </h2>
          <p className="text-sm text-pnp-textSecondary">
            Join the community for just $4.99/month and unlock private hangouts,
            social feed, and nearby discovery.
          </p>
        </div>

        <FeatureList features={features} />

        <button
          onClick={() => navigate("/subscribe")}
          className="btn-gradient w-full py-3 rounded-xl font-semibold text-white"
        >
          Become a PNP Member
        </button>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// TierGate — public API
// ---------------------------------------------------------------------------
export function TierGate({ required, children }: TierGateProps) {
  const { isAuthenticated, isLoading } = useAuth();
  const { hasAccess } = useTier();

  // Auth is still resolving — do not leak children
  if (isLoading) {
    return <Spinner />;
  }

  // Not authenticated — Layout handles the login redirect; show spinner in the
  // meantime so the gate content never flashes
  if (!isAuthenticated) {
    return <Spinner />;
  }

  // User has sufficient tier (or is admin) — render content
  if (hasAccess(required)) {
    return <>{children}</>;
  }

  // Show the appropriate upsell
  if (required === "prime") {
    return <PrimeUpsell />;
  }

  return <MemberUpsell />;
}
