import React from "react";
import { useNavigate } from "react-router-dom";

interface HangoutsPaywallProps {
  onBack?: () => void;
}

export function HangoutsPaywall({ onBack }: HangoutsPaywallProps) {
  const navigate = useNavigate();

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.85)", backdropFilter: "blur(8px)" }}
    >
      <div
        className="w-full max-w-sm rounded-2xl p-6 space-y-5 text-center"
        style={{ background: "#1C1C1E", border: "1px solid rgba(212,0,122,0.25)" }}
      >
        {/* Icon */}
        <div
          className="w-16 h-16 mx-auto rounded-full flex items-center justify-center"
          style={{
            background: "linear-gradient(135deg, rgba(212,0,122,0.15), rgba(230,145,56,0.15))",
            border: "1px solid rgba(212,0,122,0.3)",
          }}
        >
          <svg
            className="w-8 h-8"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
            style={{ color: "#D4007A" }}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"
            />
          </svg>
        </div>

        {/* Title */}
        <div>
          <h2 className="text-xl font-bold text-white mb-2">PNP Hangouts</h2>
          <p className="text-sm leading-relaxed" style={{ color: "#8E8E93" }}>
            Hangouts video calls are an exclusive service for PNPtv members. Upgrade to unlock
            private group calls, the Main Stage, and more.
          </p>
        </div>

        {/* Feature bullets */}
        <div className="text-left space-y-2 py-1">
          {[
            "Private group video calls",
            "Main Stage — 24/7 community room",
            "Direct messages & media sharing",
            "Full community access",
          ].map((feat) => (
            <div key={feat} className="flex items-center gap-2.5">
              <div
                className="w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0"
                style={{ background: "rgba(212,0,122,0.15)" }}
              >
                <svg
                  className="w-2.5 h-2.5"
                  style={{ color: "#D4007A" }}
                  fill="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <span className="text-sm text-white/70">{feat}</span>
            </div>
          ))}
        </div>

        {/* CTAs */}
        <div className="space-y-2.5 pt-1">
          <button
            onClick={() => navigate("/subscribe")}
            className="w-full py-3 rounded-xl text-sm font-bold text-white transition-all active:scale-95"
            style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
          >
            Become a Member
          </button>
          <button
            onClick={onBack || (() => navigate(-1))}
            className="w-full py-2.5 rounded-xl text-sm font-medium border border-white/10 text-white/50 hover:border-white/20 transition-colors"
          >
            Go Back
          </button>
        </div>
      </div>
    </div>
  );
}
