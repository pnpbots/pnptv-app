import React from "react";
import { useAuth } from "@/hooks/useAuth";
import { Card, Button, Badge } from "@pnptv/ui-kit";

const ADMIN_LINKS = [
  {
    title: "Authentik Admin",
    description: "Identity & SSO management",
    url: import.meta.env.VITE_AUTHENTIK_URL || "https://auth.pnptv.app",
    badge: "SSO",
  },
  {
    title: "Directus Studio",
    description: "Content management & CRM",
    url: import.meta.env.VITE_DIRECTUS_URL || "https://cms.pnptv.app",
    badge: "CMS",
  },
  {
    title: "Ampache Admin",
    description: "Media library management",
    url: import.meta.env.VITE_AMPACHE_URL || "https://media.pnptv.app",
    badge: "Media",
  },
  {
    title: "Cal.com Admin",
    description: "Booking & scheduling config",
    url: import.meta.env.VITE_CALCOM_URL || "https://booking.pnptv.app",
    badge: "Booking",
  },
  {
    title: "Restreamer Admin",
    description: "Live stream management",
    url: import.meta.env.VITE_RESTREAMER_URL || "https://live.pnptv.app",
    badge: "Live",
  },
  {
    title: "Synapse Admin",
    description: "Matrix chat server management",
    url: (import.meta.env.VITE_AUTHENTIK_URL || "https://matrix.pnptv.app") + "/_synapse/admin",
    badge: "Chat",
  },
  {
    title: "NPM Admin",
    description: "Reverse proxy & SSL management",
    url: "https://148.230.80.210:81",
    badge: "Proxy",
  },
];

export default function AdminDashboard() {
  const { isAuthenticated, isAdmin, user } = useAuth();

  if (!isAuthenticated || !isAdmin) {
    return (
      <div className="page-container">
        <div className="text-center py-16">
          <h1 className="text-xl font-bold text-pnp-textPrimary mb-2">Access Denied</h1>
          <p className="text-sm text-pnp-textSecondary">
            You must be signed in as an admin to access this page.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="page-container">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-pnp-textPrimary">Admin Dashboard</h1>
          <p className="text-sm text-pnp-textSecondary mt-1">
            Manage all PNPTV backend services
          </p>
        </div>
        <Badge variant="warning">Admin</Badge>
      </div>

      {/* Service links */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {ADMIN_LINKS.map((link) => (
          <Card
            key={link.url}
            onClick={() => window.open(link.url, "_blank")}
            hover
          >
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="font-medium text-pnp-textPrimary">{link.title}</h3>
                  <Badge variant="accent">{link.badge}</Badge>
                </div>
                <p className="text-sm text-pnp-textSecondary">{link.description}</p>
              </div>
              <svg className="w-4 h-4 text-pnp-textSecondary flex-shrink-0 mt-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </div>
          </Card>
        ))}
      </div>

      <div className="mt-6">
        <Card>
          <p className="text-xs text-pnp-textSecondary">
            Signed in as: {user?.displayName || user?.username || "Admin"}
            {" \u00B7 "}
            Admin panel is only accessible to authenticated users with admin privileges.
          </p>
        </Card>
      </div>
    </div>
  );
}
