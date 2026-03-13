import React, { useState, useEffect, useCallback } from "react";
import {
  getCreatorAvailabilitySchedule,
  saveCreatorAvailabilitySchedule,
  setCreatorOnlineStatus,
  type WeeklyAvailabilitySchedule,
} from "@/lib/api";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAY_KEYS: Array<keyof WeeklyAvailabilitySchedule> = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const TIMEZONES = [
  "UTC",
  "America/New_York",
  "America/Chicago",
  "America/Los_Angeles",
  "America/Bogota",
  "Europe/London",
];

interface SlotRow {
  enabled: boolean;
  startTime: string;
  endTime: string;
}

const defaultSlots = (): SlotRow[] =>
  DAYS.map(() => ({ enabled: false, startTime: "09:00", endTime: "17:00" }));

export function CreatorAvailabilitySettings() {
  const [online, setOnline] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [timezone, setTimezone] = useState("UTC");
  const [schedule, setSchedule] = useState<SlotRow[]>(defaultSlots());
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nextShowDate, setNextShowDate] = useState("");

  useEffect(() => {
    getCreatorAvailabilitySchedule()
      .then((res) => {
        setOnline(res.isOnline ?? false);
        if (res.schedule) {
          const updated = defaultSlots();
          DAY_KEYS.forEach((key, idx) => {
            const slot = res.schedule![key];
            if (slot) {
              updated[idx] = {
                enabled: slot.enabled,
                startTime: slot.startTime,
                endTime: slot.endTime,
              };
              if (slot.timezone) setTimezone(slot.timezone);
            }
          });
          setSchedule(updated);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleToggleOnline = useCallback(async () => {
    setToggling(true);
    try {
      const res = await setCreatorOnlineStatus(!online);
      setOnline(res.isOnline);
    } catch {
      setError("Failed to update status");
    } finally {
      setToggling(false);
    }
  }, [online]);

  const updateSlot = (idx: number, field: keyof SlotRow, value: any) => {
    setSchedule((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: value };
      return next;
    });
    setSaved(false);
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const weeklySchedule = DAY_KEYS.reduce<WeeklyAvailabilitySchedule>((acc, key, idx) => {
        acc[key] = {
          enabled: schedule[idx].enabled,
          startTime: schedule[idx].startTime,
          endTime: schedule[idx].endTime,
          timezone,
        };
        return acc;
      }, {} as WeeklyAvailabilitySchedule);
      await saveCreatorAvailabilitySchedule(weeklySchedule);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch {
      setError("Failed to save schedule");
    } finally {
      setSaving(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    background: "#2C2C2E",
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
          <div key={i} className="h-12 rounded-xl animate-pulse" style={{ background: "#2C2C2E" }} />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Online/Offline toggle */}
      <div
        className="flex items-center justify-between p-4 rounded-xl"
        style={{ background: "#1C1C1E", border: "1px solid rgba(255,255,255,0.08)" }}
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

      {/* Timezone selector */}
      <div>
        <label className="block text-xs font-semibold mb-1.5" style={{ color: "#8E8E93", textTransform: "uppercase", letterSpacing: "0.05em" }}>
          Timezone
        </label>
        <select value={timezone} onChange={(e) => setTimezone(e.target.value)} style={{ ...inputStyle, width: "100%" }}>
          {TIMEZONES.map((tz) => (
            <option key={tz} value={tz}>{tz.replace(/_/g, " ")}</option>
          ))}
        </select>
      </div>

      {/* Weekly schedule */}
      <div>
        <label className="block text-xs font-semibold mb-3" style={{ color: "#8E8E93", textTransform: "uppercase", letterSpacing: "0.05em" }}>
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

      {/* Next show date */}
      <div>
        <label className="block text-xs font-semibold mb-1.5" style={{ color: "#8E8E93", textTransform: "uppercase", letterSpacing: "0.05em" }}>
          Next Show Date
        </label>
        <input
          type="datetime-local"
          value={nextShowDate}
          onChange={(e) => setNextShowDate(e.target.value)}
          style={{ ...inputStyle, width: "100%" }}
        />
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
