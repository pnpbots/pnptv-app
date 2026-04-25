import React, { useState, useEffect, useCallback } from "react";
import {
  getCreatorAvailabilitySchedule,
  saveCreatorAvailabilitySchedule,
  setCreatorOnlineStatus,
  getNextShowDate,
  setNextShowDate,
  type AvailabilityDayRow,
  type WeeklyAvailabilitySchedule,
} from "@/lib/api";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
const TIMEZONES = [
  "UTC",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Bogota",
  "America/Mexico_City",
  "America/Sao_Paulo",
  "America/Argentina/Buenos_Aires",
  "America/Lima",
  "America/Santiago",
  "Europe/London",
  "Europe/Madrid",
  "Europe/Berlin",
  "Europe/Paris",
  "Asia/Tokyo",
  "Asia/Bangkok",
  "Australia/Sydney",
];
const BREAK_MINUTE_OPTIONS = [0, 5, 10, 15, 20, 30] as const;

interface SlotRow {
  enabled: boolean;
  startTime: string;
  endTime: string;
}

const defaultSlots = (): SlotRow[] =>
  DAYS.map(() => ({ enabled: false, startTime: "09:00", endTime: "17:00" }));

// Determine if the backend returned the legacy object format or the new array format
function isArrayFormat(s: unknown): s is AvailabilityDayRow[] {
  return Array.isArray(s);
}

export function CreatorAvailabilitySettings() {
  const [online, setOnline] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [timezone, setTimezone] = useState("UTC");
  const [breakMinutes, setBreakMinutes] = useState<number>(10);
  const [schedule, setSchedule] = useState<SlotRow[]>(defaultSlots());
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Next show date state
  const [nextShowDate, setNextShowDateState] = useState<string>("");
  const [nextShowSaving, setNextShowSaving] = useState(false);
  const [nextShowError, setNextShowError] = useState<string | null>(null);
  const [nextShowSaved, setNextShowSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;

    Promise.all([
      getCreatorAvailabilitySchedule(),
      getNextShowDate(),
    ])
      .then(([res, showDateRes]) => {
        if (cancelled) return;

        // Bug C-01 fix: backend returns `online` (not `isOnline`)
        setOnline(res.online ?? res.isOnline ?? false);

        if (res.schedule) {
          const updated = defaultSlots();
          let loadedBreak: number | undefined;

          if (isArrayFormat(res.schedule)) {
            // New array format: [{ day_of_week: 0, start_time, end_time, timezone, break_minutes }]
            (res.schedule as AvailabilityDayRow[]).forEach((row) => {
              const idx = row.day_of_week; // 0=Sunday, matching our DAYS array
              if (idx >= 0 && idx < 7) {
                updated[idx] = {
                  enabled: true,
                  startTime: row.start_time,
                  endTime: row.end_time,
                };
                if (row.timezone) setTimezone(row.timezone);
                if (row.break_minutes !== undefined && loadedBreak === undefined) {
                  loadedBreak = row.break_minutes;
                }
              }
            });
          } else {
            // Legacy object format: { sun: { enabled, startTime, endTime, timezone, breakMinutes } }
            const legacySchedule = res.schedule as WeeklyAvailabilitySchedule;
            DAY_KEYS.forEach((key, idx) => {
              const slot = legacySchedule[key];
              if (slot) {
                updated[idx] = {
                  enabled: slot.enabled,
                  startTime: slot.startTime,
                  endTime: slot.endTime,
                };
                if (slot.timezone) setTimezone(slot.timezone);
                if (slot.breakMinutes !== undefined && loadedBreak === undefined) {
                  loadedBreak = slot.breakMinutes;
                }
              }
            });
          }

          setSchedule(updated);
          if (loadedBreak !== undefined) setBreakMinutes(loadedBreak);
        }

        // Next show date
        if (showDateRes.nextShowDate) {
          // Convert UTC ISO string to datetime-local format (YYYY-MM-DDTHH:mm)
          const d = new Date(showDateRes.nextShowDate);
          const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000)
            .toISOString()
            .slice(0, 16);
          setNextShowDateState(local);
        }
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message || "Failed to load settings");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const handleToggleOnline = useCallback(async () => {
    setToggling(true);
    setError(null);
    try {
      // Bug: backend returns `online` not `isOnline`
      const res = await setCreatorOnlineStatus(!online);
      setOnline(res.online ?? (res as any).isOnline ?? !online);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to update status");
    } finally {
      setToggling(false);
    }
  }, [online]);

  const updateSlot = (idx: number, field: keyof SlotRow, value: string | boolean) => {
    setSchedule((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: value };
      return next;
    });
    setSaved(false);
  };

  // Bug C-04 fix: transform frontend SlotRow[] → backend array payload
  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const slots = schedule
        .map((slot, idx) => ({
          dayOfWeek: idx,
          startTime: slot.startTime,
          endTime: slot.endTime,
          timezone,
          breakMinutes,
          enabled: slot.enabled,
        }))
        .filter((s) => s.enabled);

      await saveCreatorAvailabilitySchedule(slots);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to save schedule");
    } finally {
      setSaving(false);
    }
  };

  const handleSaveNextShow = async () => {
    setNextShowSaving(true);
    setNextShowError(null);
    try {
      const isoDate = nextShowDate ? new Date(nextShowDate).toISOString() : null;
      await setNextShowDate(isoDate);
      setNextShowSaved(true);
      setTimeout(() => setNextShowSaved(false), 3000);
    } catch (err: unknown) {
      setNextShowError(err instanceof Error ? err.message : "Failed to save next show date");
    } finally {
      setNextShowSaving(false);
    }
  };

  const handleClearNextShow = async () => {
    setNextShowSaving(true);
    setNextShowError(null);
    try {
      await setNextShowDate(null);
      setNextShowDateState("");
      setNextShowSaved(true);
      setTimeout(() => setNextShowSaved(false), 3000);
    } catch (err: unknown) {
      setNextShowError(err instanceof Error ? err.message : "Failed to clear next show date");
    } finally {
      setNextShowSaving(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    background: "var(--pnp-surface-hover, #2C2C2E)",
    border: "1px solid rgba(255,255,255,0.1)",
    color: "#EBEBF5",
    borderRadius: 8,
    padding: "6px 10px",
    fontSize: 13,
    outline: "none",
  };

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-12 rounded-xl animate-pulse" style={{ background: "var(--pnp-surface-hover, #2C2C2E)" }} />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Online/Offline toggle */}
      <div
        className="flex items-center justify-between p-4 rounded-xl"
        style={{ background: "var(--pnp-surface, #1C1C1E)", border: "1px solid rgba(255,255,255,0.08)" }}
      >
        <div className="flex items-center gap-3">
          <div
            className="w-3 h-3 rounded-full"
            style={{
              background: online ? "#34C759" : "#636366",
              boxShadow: online ? "0 0 8px rgba(52,199,89,0.5)" : "none",
            }}
          />
          <span className="text-white font-medium text-sm">
            {online ? "You are Online" : "You are Offline"}
          </span>
        </div>
        <button
          onClick={handleToggleOnline}
          disabled={toggling}
          className="px-4 py-1.5 rounded-full text-xs font-semibold text-white transition-opacity disabled:opacity-50"
          style={{
            background: online ? "#636366" : "linear-gradient(135deg, #D4007A, #E69138)",
          }}
        >
          {toggling ? "..." : online ? "Go Offline" : "Go Online"}
        </button>
      </div>

      {/* Next Show Date */}
      <div
        className="p-4 rounded-xl space-y-3"
        style={{ background: "var(--pnp-surface, #1C1C1E)", border: "1px solid rgba(255,255,255,0.08)" }}
      >
        <label className="block text-xs font-semibold" style={{ color: "var(--pnp-text-secondary, #8E8E93)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
          Next Show Date
        </label>
        {nextShowDate && (
          <p className="text-xs" style={{ color: "#AEAEB2" }}>
            Currently set:{" "}
            <span className="font-medium" style={{ color: "#EBEBF5" }}>
              {new Date(nextShowDate).toLocaleDateString(undefined, {
                weekday: "short",
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          </p>
        )}
        <input
          type="datetime-local"
          value={nextShowDate}
          onChange={(e) => { setNextShowDateState(e.target.value); setNextShowSaved(false); }}
          style={{ ...inputStyle, width: "100%", colorScheme: "dark" }}
        />
        {nextShowError && (
          <p className="text-xs" style={{ color: "#FF6B6B" }}>{nextShowError}</p>
        )}
        <div className="flex gap-2">
          <button
            onClick={handleSaveNextShow}
            disabled={nextShowSaving || !nextShowDate}
            className="flex-1 py-2 rounded-xl text-xs font-semibold text-white transition-opacity disabled:opacity-50"
            style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
          >
            {nextShowSaving ? "Saving..." : nextShowSaved ? "Saved!" : "Set Date"}
          </button>
          {nextShowDate && (
            <button
              onClick={handleClearNextShow}
              disabled={nextShowSaving}
              className="px-4 py-2 rounded-xl text-xs font-semibold transition-opacity disabled:opacity-50"
              style={{ background: "rgba(255,255,255,0.08)", color: "var(--pnp-text-secondary, #8E8E93)" }}
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Timezone selector */}
      <div>
        <label className="block text-xs font-semibold mb-1.5" style={{ color: "var(--pnp-text-secondary, #8E8E93)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
          Timezone
        </label>
        <select value={timezone} onChange={(e) => setTimezone(e.target.value)} style={{ ...inputStyle, width: "100%" }}>
          {TIMEZONES.map((tz) => (
            <option key={tz} value={tz}>{tz.replace(/_/g, " ")}</option>
          ))}
        </select>
      </div>

      {/* Break time between calls */}
      <div>
        <label className="block text-xs font-semibold mb-1.5" style={{ color: "var(--pnp-text-secondary, #8E8E93)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
          Break Between Calls
        </label>
        <select
          value={breakMinutes}
          onChange={(e) => { setBreakMinutes(Number(e.target.value)); setSaved(false); }}
          style={{ ...inputStyle, width: "100%" }}
        >
          {BREAK_MINUTE_OPTIONS.map((mins) => (
            <option key={mins} value={mins}>
              {mins === 0 ? "No break" : `${mins} minutes`}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs" style={{ color: "#636366" }}>
          Minimum gap required between consecutive bookings.
        </p>
      </div>

      {/* Weekly schedule */}
      <div>
        <label className="block text-xs font-semibold mb-3" style={{ color: "var(--pnp-text-secondary, #8E8E93)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
          Weekly Availability
        </label>
        <div className="space-y-2">
          {DAYS.map((day, i) => (
            <div
              key={day}
              className="flex items-center gap-3 p-3 rounded-xl"
              style={{
                background: schedule[i].enabled ? "rgba(212,0,122,0.06)" : "#1C1C1E",
                border: `1px solid ${schedule[i].enabled ? "rgba(212,0,122,0.2)" : "rgba(255,255,255,0.06)"}`,
              }}
            >
              <input
                type="checkbox"
                checked={schedule[i].enabled}
                onChange={(e) => updateSlot(i, "enabled", e.target.checked)}
                className="accent-[#D4007A] w-4 h-4 flex-shrink-0"
              />
              <span className="text-sm font-medium w-20 flex-shrink-0" style={{ color: schedule[i].enabled ? "#EBEBF5" : "#636366" }}>
                {day.slice(0, 3)}
              </span>
              {schedule[i].enabled && (
                <>
                  <input
                    type="time"
                    value={schedule[i].startTime}
                    onChange={(e) => updateSlot(i, "startTime", e.target.value)}
                    style={{ ...inputStyle, width: 110 }}
                  />
                  <span style={{ color: "#636366", fontSize: 12 }}>to</span>
                  <input
                    type="time"
                    value={schedule[i].endTime}
                    onChange={(e) => updateSlot(i, "endTime", e.target.value)}
                    style={{ ...inputStyle, width: 110 }}
                  />
                </>
              )}
            </div>
          ))}
        </div>
      </div>

      {error && <p className="text-xs" style={{ color: "#FF6B6B" }}>{error}</p>}

      <button
        onClick={handleSave}
        disabled={saving}
        className="w-full py-3 rounded-xl font-semibold text-sm text-white transition-opacity disabled:opacity-50"
        style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
      >
        {saving ? "Saving..." : saved ? "Saved!" : "Save Schedule"}
      </button>
    </div>
  );
}
