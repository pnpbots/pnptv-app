import React, { useState, useCallback, useRef, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useI18n, setGuestLang, type Lang } from "@/lib/i18n";
import { updateLanguage } from "@/lib/api";

const LANG_OPTIONS: { code: Lang; flag: string; label: string }[] = [
  { code: "en", flag: "\uD83C\uDDFA\uD83C\uDDF8", label: "English" },
  { code: "es", flag: "\uD83C\uDDEA\uD83C\uDDF8", label: "Espa\u00f1ol" },
  { code: "pt", flag: "\uD83C\uDDE7\uD83C\uDDF7", label: "Portugu\u00eas" },
  { code: "fr", flag: "\uD83C\uDDEB\uD83C\uDDF7", label: "Fran\u00e7ais" },
  { code: "de", flag: "\uD83C\uDDE9\uD83C\uDDEA", label: "Deutsch" },
  { code: "it", flag: "\uD83C\uDDEE\uD83C\uDDF9", label: "Italiano" },
  { code: "nl", flag: "\uD83C\uDDF3\uD83C\uDDF1", label: "Nederlands" },
  { code: "ru", flag: "\uD83C\uDDF7\uD83C\uDDFA", label: "\u0420\u0443\u0441\u0441\u043A\u0438\u0439" },
  { code: "tr", flag: "\uD83C\uDDF9\uD83C\uDDF7", label: "T\u00fcrk\u00e7e" },
  { code: "th", flag: "\uD83C\uDDF9\uD83C\uDDED", label: "\u0E44\u0E17\u0E22" },
  { code: "zh", flag: "\uD83C\uDDE8\uD83C\uDDF3", label: "\u4E2D\u6587" },
  { code: "ja", flag: "\uD83C\uDDEF\uD83C\uDDF5", label: "\u65E5\u672C\u8A9E" },
  { code: "vi", flag: "\uD83C\uDDFB\uD83C\uDDF3", label: "Ti\u1EBFng Vi\u1EC7t" },
  { code: "id", flag: "\uD83C\uDDEE\uD83C\uDDE9", label: "Indonesia" },
  { code: "ar", flag: "\uD83C\uDDF8\uD83C\uDDE6", label: "\u0627\u0644\u0639\u0631\u0628\u064A\u0629" },
];

interface LanguageSelectorProps {
  /** "topbar" opens dropdown downward, "sidebar" opens upward */
  position?: "topbar" | "sidebar";
}

export function LanguageSelector({ position = "topbar" }: LanguageSelectorProps) {
  const [open, setOpen] = useState(false);
  const { isAuthenticated } = useAuth();
  const { lang: currentLang } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const handleSelect = useCallback(async (code: Lang) => {
    setOpen(false);
    setGuestLang(code);
    if (isAuthenticated) {
      try { await updateLanguage(code); } catch { /* silent */ }
    }
    window.location.reload();
  }, [isAuthenticated]);

  const currentFlag = LANG_OPTIONS.find((l) => l.code === currentLang)?.flag || "\uD83C\uDF10";

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-8 h-8 rounded-full flex items-center justify-center text-sm transition-colors hover:bg-white/10"
        style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)" }}
        aria-label="Change language"
        aria-expanded={open}
      >
        <span className="text-sm leading-none">{currentFlag}</span>
      </button>

      {open && (
        <div
          className={`absolute z-50 rounded-xl py-1.5 max-h-72 overflow-y-auto scrollbar-hide ${
            position === "sidebar"
              ? "bottom-10 left-0"
              : "right-0 top-10"
          }`}
          style={{
            background: "#1C1C1E",
            border: "1px solid rgba(255,255,255,0.12)",
            minWidth: "160px",
            boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
          }}
        >
          {LANG_OPTIONS.map((l) => (
            <button
              key={l.code}
              onClick={() => handleSelect(l.code)}
              className="w-full px-3 py-2 flex items-center gap-2.5 text-left text-sm transition-colors hover:bg-white/5"
              style={{ color: l.code === currentLang ? "#D4007A" : "#ccc" }}
            >
              <span className="text-base">{l.flag}</span>
              <span className="truncate">{l.label}</span>
              {l.code === currentLang && (
                <svg className="w-3.5 h-3.5 ml-auto flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
