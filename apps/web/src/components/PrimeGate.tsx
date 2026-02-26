import React from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@pnptv/ui-kit";

interface PrimeGateProps {
  children: React.ReactNode;
}

export function PrimeGate({ children }: PrimeGateProps) {
  const { user, isAuthenticated, isLoading } = useAuth();
  const navigate = useNavigate();

  if (isLoading || !isAuthenticated || !user) {
    return <>{children}</>;
  }

  const isPrime = user.tier?.toLowerCase() === "prime";

  if (isPrime) {
    return <>{children}</>;
  }

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
            PNPTV PRIME
          </h2>
          <p className="text-sm text-pnp-textSecondary">
            Unlock exclusive content and features with a PRIME membership.
          </p>
        </div>

        <ul className="space-y-3 mb-6">
          {[
            { icon: "M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z", label: "Exclusive video collection" },
            { icon: "M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z", label: "Create private hangout groups" },
            { icon: "M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z M15 11a3 3 0 11-6 0 3 3 0 016 0z", label: "Nearby users & discovery" },
          ].map((feature) => (
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
              <span className="text-sm text-pnp-textPrimary">
                {feature.label}
              </span>
            </li>
          ))}
        </ul>

        <button
          onClick={() => navigate("/subscribe")}
          className="btn-gradient w-full py-3 rounded-xl font-semibold text-white"
        >
          Upgrade to PRIME
        </button>
      </Card>
    </div>
  );
}
