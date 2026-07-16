import React, { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { useNotifications } from "@/hooks/useNotifications";
import { useI18n } from "@/lib/i18n";
import { NotificationDropdown } from "./NotificationDropdown";

export function NotificationBell() {
  const { unreadCount } = useNotifications();
  const t = useI18n();
  const [open, setOpen] = useState(false);
  const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0 });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onMouse = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!buttonRef.current?.contains(target) && !panelRef.current?.contains(target)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onMouse);
    return () => document.removeEventListener("mousedown", onMouse);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const handleToggle = () => {
    if (!open && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setDropdownPos({ top: rect.bottom + 8, left: rect.right + 8 });
    }
    setOpen(v => !v);
  };

  const badge = unreadCount > 99 ? "99+" : unreadCount > 0 ? String(unreadCount) : null;
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' ? window.innerWidth < 640 : false);
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 640);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  return (
    <>
      <button
        ref={buttonRef}
        onClick={handleToggle}
        aria-label={t.notifications.notifications}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="relative min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent focus-visible:ring-offset-2 focus-visible:ring-offset-pnp-background transition-colors"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="w-5 h-5 text-pnp-textSecondary"
          aria-hidden="true"
        >
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {badge && (
          <span
            aria-live="polite"
            className="absolute -top-0.5 -right-0.5 min-w-[20px] h-[18px] flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-bold px-1 leading-none pointer-events-none"
          >
            {badge}
          </span>
        )}
      </button>

      {open && createPortal(
        <>
          <div
            className={`fixed inset-0 z-40 ${isMobile ? "bg-black/60" : ""}`}
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <div
            ref={panelRef}
            className={isMobile ? "fixed bottom-0 left-0 right-0 z-50 animate-slide-up" : ""}
            style={!isMobile ? { position: "fixed", top: dropdownPos.top, left: dropdownPos.left, zIndex: 50 } : undefined}
          >
            <NotificationDropdown onClose={() => setOpen(false)} isMobile={isMobile} />
          </div>
        </>,
        document.body
      )}
    </>
  );
}
