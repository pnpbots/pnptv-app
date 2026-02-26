import React from "react";
import { useNavigate } from "react-router-dom";
import { Card, Badge } from "@pnptv/ui-kit";

interface ServiceCardProps {
  title: string;
  description: string;
  icon: React.ReactNode;
  to: string;
  status?: "online" | "offline" | "maintenance";
  badge?: string;
}

export function ServiceCard({ title, description, icon, to, status = "online", badge }: ServiceCardProps) {
  const navigate = useNavigate();

  const statusConfig = {
    online: { label: "Live", variant: "success" as const },
    offline: { label: "Offline", variant: "error" as const },
    maintenance: { label: "Maintenance", variant: "warning" as const },
  };

  return (
    <Card onClick={() => navigate(to)} hover>
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: "linear-gradient(135deg, rgba(212,0,122,0.15), rgba(230,145,56,0.15))", color: "#D4007A" }}>
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-pnp-textPrimary truncate">{title}</h3>
            <Badge variant={statusConfig[status].variant}>
              {statusConfig[status].label}
            </Badge>
            {badge && <Badge variant="accent">{badge}</Badge>}
          </div>
          <p className="text-sm text-pnp-textSecondary mt-0.5 line-clamp-2">{description}</p>
        </div>
        <svg className="w-5 h-5 text-pnp-textSecondary flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </div>
    </Card>
  );
}
