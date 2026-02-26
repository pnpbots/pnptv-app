import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { handleCallback } from "@/lib/auth";

export default function AuthCallback() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    handleCallback()
      .then(() => {
        navigate("/", { replace: true });
      })
      .catch((err) => {
        setError(err?.message || "Authentication failed");
      });
  }, [navigate]);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-pnp-background p-4">
        <div className="text-center">
          <div className="w-16 h-16 rounded-full bg-pnp-error/20 flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-pnp-error" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-pnp-textPrimary mb-2">Authentication Error</h2>
          <p className="text-sm text-pnp-textSecondary mb-4">{error}</p>
          <button
            onClick={() => navigate("/", { replace: true })}
            className="text-pnp-accent hover:underline text-sm"
          >
            Return Home
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-pnp-background">
      <div className="w-8 h-8 border-2 border-pnp-accent border-t-transparent rounded-full animate-spin" />
    </div>
  );
}
