import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card, Badge } from "@pnptv/ui-kit";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/lib/i18n";

interface AdminLink {
  title: string;
  description: string;
  url: string;
  badge: string;
  external: boolean;
  action?: "provision-calcom";
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
        title: "Matrix Synapse",
        description: "Matrix chat server",
        url: "https://matrix.pnptv.app",
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
      {
        title: "Provision Creator Calendars",
        description: "Auto-create Cal.com accounts for all active creators",
        url: "",
        badge: "Setup",
        external: false,
        action: "provision-calcom",
      },
    ],
  },
  {
    title: "Monitoring",
    links: [
      {
        title: "Uptime Kuma",
        description: "Service uptime & public status page",
        url: "https://status.pnptv.app",
        badge: "Uptime",
        external: true,
      },
      {
        title: "Healthchecks",
        description: "Cron job & background worker monitoring",
        url: "https://checks.pnptv.app",
        badge: "Crons",
        external: true,
      },
    ],
  },
  {
    title: "Analytics & BI",
    links: [
      {
        title: "Umami Analytics",
        description: "Privacy-first webapp usage & conversion analytics",
        url: "https://analytics.pnptv.app",
        badge: "Analytics",
        external: true,
      },
      {
        title: "Metabase",
        description: "Business intelligence & revenue dashboards",
        url: "https://metabase.pnptv.app",
        badge: "BI",
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
        title: "PNP Connect",
        description: "Location-based discovery",
        url: "/nearby",
        badge: "Connect",
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
        title: "Creator Applications",
        description: "Review full-time creator applications",
        url: "/admin/creators",
        badge: "Creators",
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
  <svg
    className="w-4 h-4 text-pnp-textSecondary flex-shrink-0 mt-1"
    fill="none"
    viewBox="0 0 24 24"
    stroke="currentColor"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
    />
  </svg>
);

const ArrowRightIcon = () => (
  <svg
    className="w-4 h-4 text-pnp-textSecondary flex-shrink-0 mt-1"
    fill="none"
    viewBox="0 0 24 24"
    stroke="currentColor"
  >
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
  </svg>
);

export default function ExternalServices() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const t = useI18n().admin;
  const [provisioningCalcom, setProvisioningCalcom] = useState(false);
  const [provisionResult, setProvisionResult] = useState<string | null>(null);

  const handleClick = async (link: AdminLink) => {
    if (link.action === "provision-calcom") {
      if (provisioningCalcom) return;
      if (!window.confirm("Provision Cal.com accounts for all active creators? This is safe to run multiple times.")) return;
      setProvisioningCalcom(true);
      setProvisionResult(null);
      try {
        const res = await fetch("/api/admin/calcom/provision-all", { method: "POST", credentials: "include" });
        const data = await res.json().catch(() => ({}));
        setProvisionResult(res.ok ? `Done — ${data.provisioned ?? 0} creators provisioned.` : `Error: ${data.error || "unknown"}`);
      } catch {
        setProvisionResult("Request failed — check backend logs.");
      } finally {
        setProvisioningCalcom(false);
      }
      return;
    }
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
          <h1 className="text-2xl font-bold text-pnp-textPrimary">{t.services.title}</h1>
          <p className="text-sm text-pnp-textSecondary mt-1">
            {t.services.subtitle}
          </p>
        </div>
        <Badge variant="warning">Admin</Badge>
      </div>

      {provisionResult && (
        <div
          className="mb-4 px-4 py-3 rounded-xl text-sm"
          style={{
            background: provisionResult.startsWith("Error") || provisionResult.startsWith("Request")
              ? "rgba(239,68,68,0.1)" : "rgba(94,209,196,0.1)",
            border: provisionResult.startsWith("Error") || provisionResult.startsWith("Request")
              ? "1px solid rgba(239,68,68,0.3)" : "1px solid rgba(94,209,196,0.3)",
            color: provisionResult.startsWith("Error") || provisionResult.startsWith("Request")
              ? "#f87171" : "#5ED1C4",
          }}
        >
          {provisionResult}
        </div>
      )}

      {SECTIONS.map((section, idx) => (
        <div key={section.title} className={idx > 0 ? "mt-6" : ""}>
          <h2 className="text-sm font-semibold text-pnp-textSecondary uppercase tracking-wider mb-3">
            {section.title}
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {section.links.map((link) => (
              <Card key={link.title} onClick={() => handleClick(link)} hover>
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-medium text-pnp-textPrimary">
                        {link.action === "provision-calcom" && provisioningCalcom ? "Provisioning…" : link.title}
                      </h3>
                      <Badge variant="accent">{link.badge}</Badge>
                    </div>
                    <p className="text-sm text-pnp-textSecondary">{link.description}</p>
                  </div>
                  {link.action ? <ArrowRightIcon /> : link.external ? <ExternalIcon /> : <ArrowRightIcon />}
                </div>
              </Card>
            ))}
          </div>
        </div>
      ))}

      <div className="mt-6">
        <Card>
          <p className="text-xs text-pnp-textSecondary">
            {t.services.signedInAs}{" "}
            <span className="text-pnp-textPrimary font-medium">
              {user?.displayName || user?.username || "Admin"}
            </span>
            {" \u00B7 "}
            {t.services.adminNote}
          </p>
        </Card>
      </div>
    </div>
  );
}
