import React from "react";
import { useNavigate } from "react-router-dom";
import { useNotifications } from "@/hooks/useNotifications";

function getDeepLink(toast: { type: string; entityType?: string; entityId?: string; actor?: any }): string {
  switch (toast.entityType) {
    case "post":
      return "/social";
    case "message":
      return toast.actor?.id ? `/dm/${toast.actor.id}` : "/";
    case "group":
      return "/chat";
    case "payment":
      return "/profile";
    default:
      return "/";
  }
}

export function Toast() {
  const { latestToast, dismissToast } = useNotifications();
  const navigate = useNavigate();

  if (!latestToast) return null;

  const handleTap = () => {
    dismissToast();
    navigate(getDeepLink(latestToast));
  };

  return (
    <div className="fixed top-16 left-1/2 -translate-x-1/2 z-50 animate-slide-in-top">
      <button
        onClick={handleTap}
        className="flex items-center gap-3 px-4 py-3 rounded-xl glass-nav border border-pnp-border shadow-xl max-w-sm"
      >
        {/* Actor avatar */}
        <div
          className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold"
          style={{ background: "linear-gradient(135deg, #D4007A, #E69138)", color: "#fff" }}
        >
          {latestToast.actor?.photoUrl ? (
            <img
              src={latestToast.actor.photoUrl}
              alt=""
              className="w-8 h-8 rounded-full object-cover"
            />
          ) : (
            (latestToast.actor?.firstName || latestToast.actor?.username || "!")[0].toUpperCase()
          )}
        </div>

        <p className="text-xs text-pnp-textPrimary font-medium leading-snug line-clamp-2">
          {latestToast.message}
        </p>

        <button
          onClick={(e) => { e.stopPropagation(); dismissToast(); }}
          className="flex-shrink-0 text-pnp-textSecondary hover:text-pnp-textPrimary ml-1"
          aria-label="Dismiss"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
            <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
          </svg>
        </button>
      </button>
    </div>
  );
}
