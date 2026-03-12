import React, { useState, useEffect, useRef, useCallback } from "react";

// ─── Types ──────────────────────────────────────────────────────────────────

interface VideoCallModBotProps {
  /** LiveKit Room object (from useRoomContext / onRoomConnected). May be null. */
  room: any | null;
  /** Only show for admins */
  isAdmin: boolean;
}

interface RoomParticipant {
  participantId: string;
  displayName: string;
}

const PRESET_MESSAGES = [
  "Welcome to PNPtv! Have fun and be respectful.",
  "Remember: this is a safe space for everyone.",
  "Follow us on social media @pnptv!",
  "Need help? Use the support chat.",
  "Be kind, be bold, be you.",
];

const ROTATION_INTERVALS = [
  { label: "15s", value: 15 },
  { label: "30s", value: 30 },
  { label: "1m", value: 60 },
  { label: "2m", value: 120 },
  { label: "5m", value: 300 },
];

// ─── Component ──────────────────────────────────────────────────────────────

export function VideoCallModBot({ room, isAdmin }: VideoCallModBotProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [participants, setParticipants] = useState<RoomParticipant[]>([]);
  const [customMessage, setCustomMessage] = useState("");
  const [isRotating, setIsRotating] = useState(false);
  const [rotationInterval, setRotationInterval] = useState(30);
  const [currentStageIdx, setCurrentStageIdx] = useState(0);
  const [messageSent, setMessageSent] = useState<string | null>(null);

  const rotationTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const participantsRef = useRef<RoomParticipant[]>([]);
  const stageIdxRef = useRef(0);

  // Keep refs in sync
  useEffect(() => { participantsRef.current = participants; }, [participants]);
  useEffect(() => { stageIdxRef.current = currentStageIdx; }, [currentStageIdx]);

  // Poll participants from LiveKit room
  useEffect(() => {
    if (!room || !isOpen) return;

    const fetchParticipants = () => {
      try {
        // LiveKit Room exposes remoteParticipants as a Map<string, RemoteParticipant>
        const remote: RoomParticipant[] = [];
        if (room.remoteParticipants instanceof Map) {
          room.remoteParticipants.forEach((p: any) => {
            remote.push({
              participantId: p.identity,
              displayName: p.name || p.identity || "Unknown",
            });
          });
        }
        // Include local participant
        if (room.localParticipant) {
          remote.unshift({
            participantId: room.localParticipant.identity,
            displayName: (room.localParticipant.name || room.localParticipant.identity || "You") + " (you)",
          });
        }
        setParticipants(remote);
      } catch {
        // Room not ready yet
      }
    };

    fetchParticipants();
    const interval = setInterval(fetchParticipants, 5000);
    return () => clearInterval(interval);
  }, [room, isOpen]);

  // Send a data message to all participants via LiveKit data channel
  const sendChatMessage = useCallback(
    (text: string) => {
      if (!text.trim()) return;
      try {
        // LiveKit data messages are sent as Uint8Array
        if (room?.localParticipant?.publishData) {
          const payload = JSON.stringify({ type: "mod_message", text: text.trim() });
          room.localParticipant.publishData(
            new TextEncoder().encode(payload),
            { reliable: true }
          );
        }
        setMessageSent(text.trim());
        setTimeout(() => setMessageSent(null), 2000);
      } catch {
        // silent
      }
    },
    [room]
  );

  // Pin a participant (stub — LiveKit pinning is client-side; moderator sends a data msg)
  const pinToStage = useCallback(
    (participantId: string) => {
      try {
        if (room?.localParticipant?.publishData) {
          const payload = JSON.stringify({ type: "mod_pin", participantId });
          room.localParticipant.publishData(
            new TextEncoder().encode(payload),
            { reliable: true }
          );
        }
      } catch {
        // silent
      }
    },
    [room]
  );

  // Mute a participant (stub — LiveKit server-side muting requires server SDK call)
  const muteParticipant = useCallback(
    (participantId: string) => {
      try {
        if (room?.localParticipant?.publishData) {
          const payload = JSON.stringify({ type: "mod_mute", participantId });
          room.localParticipant.publishData(
            new TextEncoder().encode(payload),
            { reliable: true }
          );
        }
      } catch {
        // silent
      }
    },
    [room]
  );

  // Kick a participant (stub — LiveKit server-side kick requires server SDK call)
  const kickParticipant = useCallback(
    (participantId: string, displayName: string) => {
      if (!window.confirm(`Kick "${displayName}" from the call?`)) return;
      try {
        if (room?.localParticipant?.publishData) {
          const payload = JSON.stringify({ type: "mod_kick", participantId });
          room.localParticipant.publishData(
            new TextEncoder().encode(payload),
            { reliable: true }
          );
        }
      } catch {
        // silent
      }
    },
    [room]
  );

  // Stage rotation logic
  const startRotation = useCallback(() => {
    if (rotationTimer.current) clearInterval(rotationTimer.current);

    setIsRotating(true);

    const rotate = () => {
      const pList = participantsRef.current;
      if (pList.length === 0) return;

      const nextIdx = (stageIdxRef.current + 1) % pList.length;
      setCurrentStageIdx(nextIdx);
      stageIdxRef.current = nextIdx;

      try {
        const pid = pList[nextIdx]?.participantId;
        if (pid) {
          pinToStage(pid);
        }
      } catch {
        // silent
      }
    };

    rotate();
    rotationTimer.current = setInterval(rotate, rotationInterval * 1000);
  }, [rotationInterval, pinToStage]);

  const stopRotation = useCallback(() => {
    setIsRotating(false);
    if (rotationTimer.current) {
      clearInterval(rotationTimer.current);
      rotationTimer.current = null;
    }
  }, []);

  // Pick a random participant (avoiding the current stage index when possible)
  const shuffleStage = useCallback(() => {
    const pList = participantsRef.current;
    if (pList.length === 0) return;

    let randomIdx: number;
    if (pList.length === 1) {
      randomIdx = 0;
    } else {
      do {
        randomIdx = Math.floor(Math.random() * pList.length);
      } while (randomIdx === stageIdxRef.current);
    }

    setCurrentStageIdx(randomIdx);
    stageIdxRef.current = randomIdx;

    const pid = pList[randomIdx]?.participantId;
    if (pid) {
      pinToStage(pid);
    }
  }, [pinToStage]);

  // Restart rotation with new interval when it changes while active
  useEffect(() => {
    if (isRotating && participants.length > 0) {
      if (rotationTimer.current) clearInterval(rotationTimer.current);
      const rotate = () => {
        const pList = participantsRef.current;
        if (pList.length === 0) return;
        const nextIdx = (stageIdxRef.current + 1) % pList.length;
        setCurrentStageIdx(nextIdx);
        stageIdxRef.current = nextIdx;
        try {
          const pid = pList[nextIdx]?.participantId;
          if (pid) pinToStage(pid);
        } catch { /* silent */ }
      };
      rotationTimer.current = setInterval(rotate, rotationInterval * 1000);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rotationInterval]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (rotationTimer.current) clearInterval(rotationTimer.current);
    };
  }, []);

  if (!isAdmin) return null;

  // Floating toggle button
  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="w-10 h-10 rounded-full bg-pnp-accent/20 hover:bg-pnp-accent/30 flex items-center justify-center active:scale-95 transition-all border border-pnp-accent/30"
        aria-label="Open moderation bot"
        title="Mod Bot"
      >
        <svg className="w-5 h-5 text-pnp-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      </button>
    );
  }

  return (
    <div className="w-72 flex flex-col bg-pnp-background/90 backdrop-blur-sm rounded-xl border border-white/5 overflow-hidden max-h-[80vh]">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/5 bg-pnp-accent/5">
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4 text-pnp-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          <span className="text-xs font-semibold text-pnp-textPrimary">Mod Bot</span>
        </div>
        <button
          onClick={() => setIsOpen(false)}
          className="w-6 h-6 flex items-center justify-center rounded hover:bg-white/10 active:scale-95 transition-all"
        >
          <svg className="w-3.5 h-3.5 text-pnp-textSecondary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {/* ── Preset Messages ────────────────────────────────────────────── */}
        <div className="p-3 border-b border-white/5">
          <p className="text-[10px] font-semibold text-pnp-textSecondary uppercase tracking-wider mb-2">Quick Messages</p>
          <div className="space-y-1">
            {PRESET_MESSAGES.map((msg, i) => (
              <button
                key={i}
                onClick={() => sendChatMessage(msg)}
                className="w-full text-left text-[11px] text-pnp-textPrimary px-2.5 py-1.5 rounded-lg bg-pnp-surface/30 hover:bg-pnp-surface/60 active:scale-[0.98] transition-all truncate"
              >
                {msg}
              </button>
            ))}
          </div>

          {/* Custom message */}
          <div className="flex items-center gap-1.5 mt-2">
            <input
              type="text"
              value={customMessage}
              onChange={(e) => setCustomMessage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && customMessage.trim()) {
                  sendChatMessage(customMessage);
                  setCustomMessage("");
                }
              }}
              placeholder="Custom message..."
              className="flex-1 min-w-0 text-[11px] bg-pnp-surface/30 border border-white/5 rounded-lg px-2 py-1.5 text-pnp-textPrimary placeholder:text-pnp-textSecondary/50 focus:outline-none focus:ring-1 focus:ring-pnp-accent/50"
              maxLength={500}
            />
            <button
              onClick={() => { sendChatMessage(customMessage); setCustomMessage(""); }}
              disabled={!customMessage.trim()}
              className="w-7 h-7 flex items-center justify-center rounded-lg bg-pnp-accent/20 hover:bg-pnp-accent/30 disabled:opacity-30 active:scale-95 transition-all"
            >
              <svg className="w-3.5 h-3.5 text-pnp-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
              </svg>
            </button>
          </div>

          {/* Sent confirmation */}
          {messageSent && (
            <p className="text-[9px] text-emerald-400 mt-1 truncate">Sent: {messageSent}</p>
          )}
        </div>

        {/* ── Stage Rotation ─────────────────────────────────────────────── */}
        <div className="p-3 border-b border-white/5">
          <p className="text-[10px] font-semibold text-pnp-textSecondary uppercase tracking-wider mb-2">Stage Rotation</p>

          {/* Interval selector */}
          <div className="flex items-center gap-1 mb-2">
            {ROTATION_INTERVALS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setRotationInterval(opt.value)}
                className={`px-2 py-1 rounded text-[10px] font-medium transition-all ${
                  rotationInterval === opt.value
                    ? "bg-pnp-accent text-white"
                    : "bg-pnp-surface/30 text-pnp-textSecondary hover:bg-pnp-surface/50"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {/* Start/Stop button */}
          <button
            onClick={isRotating ? stopRotation : startRotation}
            disabled={participants.length === 0}
            className={`w-full py-2 rounded-lg text-xs font-semibold transition-all active:scale-[0.98] disabled:opacity-30 ${
              isRotating
                ? "bg-red-500/20 text-red-400 hover:bg-red-500/30 border border-red-500/30"
                : "bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 border border-emerald-500/30"
            }`}
          >
            {isRotating ? `Rotating (every ${rotationInterval}s)` : "Start Rotation"}
          </button>

          {/* Shuffle Stage button */}
          <button
            onClick={shuffleStage}
            disabled={participants.length === 0}
            className="w-full mt-1.5 py-2 rounded-lg text-xs font-semibold transition-all active:scale-[0.98] disabled:opacity-30 bg-indigo-500/20 text-indigo-400 hover:bg-indigo-500/30 border border-indigo-500/30 flex items-center justify-center gap-1.5"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
            </svg>
            Shuffle
          </button>
        </div>

        {/* ── Participants ────────────────────────────────────────────────── */}
        <div className="p-3">
          <p className="text-[10px] font-semibold text-pnp-textSecondary uppercase tracking-wider mb-2">
            Participants ({participants.length})
          </p>

          {participants.length === 0 && (
            <p className="text-[10px] text-pnp-textSecondary italic">
              {room ? "No participants yet" : "Waiting for video call..."}
            </p>
          )}

          <div className="space-y-1">
            {participants.map((p) => (
              <div
                key={p.participantId}
                className="flex items-center gap-2 p-1.5 rounded-lg hover:bg-white/5 group"
              >
                <div className="w-6 h-6 rounded-full bg-pnp-accent/20 flex items-center justify-center flex-shrink-0">
                  <span className="text-[9px] font-bold text-pnp-accent">
                    {p.displayName[0]?.toUpperCase() || "?"}
                  </span>
                </div>

                <span className="text-[11px] text-pnp-textPrimary truncate flex-1 min-w-0">
                  {p.displayName}
                </span>

                {/* Actions (visible on hover) */}
                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                  {/* Pin to stage */}
                  <button
                    onClick={() => pinToStage(p.participantId)}
                    className="w-6 h-6 flex items-center justify-center rounded hover:bg-white/10 active:scale-90 transition-all"
                    title="Pin to stage"
                  >
                    <svg className="w-3 h-3 text-pnp-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />
                    </svg>
                  </button>
                  {/* Mute */}
                  <button
                    onClick={() => muteParticipant(p.participantId)}
                    className="w-6 h-6 flex items-center justify-center rounded hover:bg-white/10 active:scale-90 transition-all"
                    title="Mute"
                  >
                    <svg className="w-3 h-3 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 9.75L19.5 12m0 0l2.25 2.25M19.5 12l2.25-2.25M19.5 12l-2.25 2.25m-10.5-6l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75z" />
                    </svg>
                  </button>
                  {/* Kick */}
                  <button
                    onClick={() => kickParticipant(p.participantId, p.displayName)}
                    className="w-6 h-6 flex items-center justify-center rounded hover:bg-white/10 active:scale-90 transition-all"
                    title="Kick"
                  >
                    <svg className="w-3 h-3 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M22 10.5h-6m-2.25-4.125a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zM4 19.235v-.11a6.375 6.375 0 0112.75 0v.109A12.318 12.318 0 0110.374 21c-2.331 0-4.512-.645-6.374-1.766z" />
                    </svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
