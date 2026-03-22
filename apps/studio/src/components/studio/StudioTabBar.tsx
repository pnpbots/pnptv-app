import React from "react";
import { LayersIcon, SlidersIcon, SettingsIcon, ChatIcon } from "./shared";

// ─── Types ─────────────────────────────────────────────────────────────────────

export type ActiveTab = "scenes" | "audio" | "filters" | "settings" | "chat";

export interface StudioTabBarProps {
  activeTab: ActiveTab;
  onTabChange: (tab: ActiveTab) => void;
}

// ─── Tab definitions ────────────────────────────────────────────────────────────

interface TabDef {
  id: ActiveTab;
  label: string;
  icon: React.ReactNode;
}

const TABS: TabDef[] = [
  {
    id: "scenes",
    label: "Scenes",
    icon: <LayersIcon className="w-5 h-5" aria-hidden="true" />,
  },
  {
    id: "audio",
    label: "Audio",
    icon: <SlidersIcon className="w-5 h-5" aria-hidden="true" />,
  },
  {
    id: "filters",
    label: "Filters",
    // Rotated variant of sliders to visually distinguish from audio
    icon: (
      <svg
        className="w-5 h-5"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <circle cx="5" cy="6" r="2" />
        <circle cx="12" cy="12" r="2" />
        <circle cx="19" cy="18" r="2" />
        <line x1="5" y1="2" x2="5" y2="4" />
        <line x1="5" y1="8" x2="5" y2="22" />
        <line x1="12" y1="2" x2="12" y2="10" />
        <line x1="12" y1="14" x2="12" y2="22" />
        <line x1="19" y1="2" x2="19" y2="16" />
        <line x1="19" y1="20" x2="19" y2="22" />
      </svg>
    ),
  },
  {
    id: "settings",
    label: "Settings",
    icon: <SettingsIcon className="w-5 h-5" aria-hidden="true" />,
  },
  {
    id: "chat",
    label: "Chat",
    icon: <ChatIcon className="w-5 h-5" aria-hidden="true" />,
  },
];

// ─── StudioTabBar ───────────────────────────────────────────────────────────────

export function StudioTabBar({ activeTab, onTabChange }: StudioTabBarProps) {
  return (
    <nav
      role="tablist"
      aria-label="Studio panels"
      className="flex items-stretch bg-pnp-surface border-b border-pnp-border"
    >
      {TABS.map((tab) => {
        const isActive = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            role="tab"
            aria-selected={isActive}
            aria-controls={`tabpanel-${tab.id}`}
            id={`tab-${tab.id}`}
            onClick={() => onTabChange(tab.id)}
            className="
              relative flex flex-col items-center justify-center gap-1
              flex-1 min-h-[52px] px-1 pt-3 pb-2
              text-[10px] font-medium leading-none
              transition-colors duration-150
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent focus-visible:ring-inset
              active:scale-[0.96]
            "
            style={{ color: isActive ? "#fff" : "#A1A1A3" }}
          >
            {/* Icon */}
            <span
              className="transition-transform duration-150"
              style={{
                color: isActive ? "#D4007A" : undefined,
                transform: isActive ? "scale(1.1)" : "scale(1)",
              }}
            >
              {tab.icon}
            </span>

            {/* Label */}
            <span>{tab.label}</span>

            {/* Active gradient underline */}
            {isActive && (
              <span
                className="absolute bottom-0 left-1/2 -translate-x-1/2 h-0.5 w-8 rounded-full"
                style={{
                  background: "linear-gradient(90deg, #D4007A, #E69138)",
                }}
                aria-hidden="true"
              />
            )}
          </button>
        );
      })}
    </nav>
  );
}
