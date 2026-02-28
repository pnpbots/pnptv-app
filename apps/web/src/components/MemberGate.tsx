import React from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@pnptv/ui-kit";

interface MemberGateProps {
  children: React.ReactNode;
}

export function MemberGate({ children }: MemberGateProps) {
  const { user, isAuthenticated, isLoading } = useAuth();
  const navigate = useNavigate();

  // Still loading: show spinner (don't leak children)
  if (isLoading) {
    return <div className="flex items-center justify-center min-h-screen"><div className="animate-spin w-8 h-8 border-2 border-white/20 border-t-white rounded-full" /></div>;
  }

  // Not authenticated: show children (Layout handles login)
  if (!isAuthenticated || !user) {
    return <>{children}</>;
  }

  const hasMemberAccess = user.tier?.toLowerCase() === "member" || user.tier?.toLowerCase() === "prime";

  if (hasMemberAccess) {
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
            Become a PNP Member
          </h2>
          <p className="text-sm text-pnp-textSecondary">
            Join the community for just $4.99/month and unlock private hangouts,
            social feed, and nearby discovery.
          </p>
        </div>

        <ul className="space-y-3 mb-6">
          {[
            { icon: "M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z", label: "Private hangout rooms" },
            { icon: "M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z", label: "Social feed access" },
            { icon: "M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z M15 11a3 3 0 11-6 0 3 3 0 016 0z", label: "Nearby users discovery" },
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
          Become a PNP Member
        </button>
      </Card>
    </div>
  );
}
