import React from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Card, Badge } from "@pnptv/ui-kit";

interface AdminLink {
  title: string;
  description: string;
  url: string;
  badge: string;
  external: boolean;
}

interface Section {
  title: string;
  links: AdminLink[];
}

const SECTIONS: Section[] = [
  {
    title: "Infrastructure",
    links: [
      {
        title: "Authentik Admin",
        description: "Identity & SSO management",
        url: import.meta.env.VITE_AUTHENTIK_URL || "https://auth.pnptv.app",
        badge: "SSO",
        external: true,
      },
      {
        title: "NPM Admin",
        description: "Reverse proxy & SSL management",
        url: "https://148.230.80.210:81",
        badge: "Proxy",
        external: true,
      },
      {
        title: "Health Check",
        description: "Backend health status endpoint",
        url: "https://pnptv.app/health",
        badge: "Status",
        external: true,
      },
    ],
  },
  {
    title: "Content & Media",
    links: [
      {
        title: "Directus Studio",
        description: "Content management & CRM",
        url: import.meta.env.VITE_DIRECTUS_URL || "https://cms.pnptv.app",
        badge: "CMS",
        external: true,
      },
      {
        title: "Ampache Admin",
        description: "Media library management",
        url: import.meta.env.VITE_AMPACHE_URL || "https://media.pnptv.app",
        badge: "Media",
        external: true,
      },
      {
        title: "Restreamer Admin",
        description: "Live stream management",
        url: import.meta.env.VITE_RESTREAMER_URL || "https://live.pnptv.app",
        badge: "Live",
        external: true,
      },
    ],
  },
  {
    title: "Communication",
    links: [
      {
        title: "Synapse Admin",
        description: "Matrix chat server management",
        url: "https://matrix.pnptv.app/_synapse/admin",
        badge: "Matrix",
        external: true,
      },
      {
        title: "Element Chat",
        description: "Matrix web chat UI",
        url: "https://chat.pnptv.app",
        badge: "Chat",
        external: true,
      },
      {
        title: "Bluesky PDS",
        description: "AT Protocol personal data server",
        url: "https://pds.pnptv.app",
        badge: "ATProto",
        external: true,
      },
    ],
  },
  {
    title: "Booking & Scheduling",
    links: [
      {
        title: "Cal.com Admin",
        description: "Booking & scheduling config",
        url: import.meta.env.VITE_CALCOM_URL || "https://booking.pnptv.app",
        badge: "Booking",
        external: true,
      },
    ],
  },
  {
    title: "App Pages",
    links: [
      {
        title: "Social Feed",
        description: "Community social timeline",
        url: "/social",
        badge: "Feed",
        external: false,
      },
      {
        title: "Hangouts",
        description: "Group chat rooms",
        url: "/chat",
        badge: "Chat",
        external: false,
      },
      {
        title: "Direct Messages",
        description: "Private conversations",
        url: "/dm",
        badge: "DM",
        external: false,
      },
      {
        title: "Nearby / Booking",
        description: "Location-based discovery & booking",
        url: "/booking",
        badge: "Nearby",
        external: false,
      },
      {
        title: "Subscriptions",
        description: "Plan management & checkout",
        url: "/subscribe",
        badge: "Plans",
        external: false,
      },
      {
        title: "Cristina AI Support",
        description: "AI assistant & support chat",
        url: "/support",
        badge: "AI",
        external: false,
      },
    ],
  },
];

const ExternalIcon = () => (
  <svg className="w-4 h-4 text-pnp-textSecondary flex-shrink-0 mt-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
  </svg>
);

const ArrowRightIcon = () => (
  <svg className="w-4 h-4 text-pnp-textSecondary flex-shrink-0 mt-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
  </svg>
);

export default function AdminDashboard() {
  const { isAuthenticated, isAdmin, user } = useAuth();
  const navigate = useNavigate();

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

  const handleClick = (link: AdminLink) => {
    if (link.external) {
      window.open(link.url, "_blank");
    } else {
      navigate(link.url);
    }
  };

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

      {SECTIONS.map((section, idx) => (
        <div key={section.title} className={idx > 0 ? "mt-6" : ""}>
          <h2 className="text-sm font-semibold text-pnp-textSecondary uppercase tracking-wider mb-3">
            {section.title}
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {section.links.map((link) => (
              <Card
                key={link.url}
                onClick={() => handleClick(link)}
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
                  {link.external ? <ExternalIcon /> : <ArrowRightIcon />}
                </div>
              </Card>
            ))}
          </div>
        </div>
      ))}

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
