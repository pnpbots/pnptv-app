import React, { useState, useEffect, useRef, useCallback } from "react";
import { chatWithMono as apiChatWithMono, resetMonoChat } from "@/lib/api";

interface MonoMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
}

const QUICK = [
  { label: "Top model candidates", prompt: "Who are the top members I should recruit as models? Give me names and how to contact them." },
  { label: "App installs", prompt: "How many people have installed the app? Break it down." },
  { label: "Revenue this month", prompt: "How is revenue looking this month vs last week?" },
  { label: "Growth trend", prompt: "How is user growth trending? Should I change strategy?" },
  { label: "Most popular content", prompt: "Who is creating the most popular content right now?" },
  { label: "Campaign performance", prompt: "How are my X campaigns performing? What should I change?" },
  { label: "Conversion rate", prompt: "What's my free-to-paid conversion rate and how can I improve it?" },
  { label: "Active users", prompt: "How many users are actually active vs just signed up?" },
];


export default function Mono() {
  const [messages, setMessages] = useState<MonoMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const msgCounter = useRef(0);
  const focusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (focusTimerRef.current) clearTimeout(focusTimerRef.current); }, []);

  useEffect(() => {
    setMessages([{
      id: "welcome",
      role: "assistant",
      content: "Hola! Soy Mono, tu asistente personal de PNPtv.\n\nTengo acceso en tiempo real a todos los datos de la plataforma: miembros, ingresos, installs, campanas, y mas.\n\nPreguntame lo que quieras.",
    }]);
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const send = useCallback(async (msg: string) => {
    if (!msg.trim() || loading) return;
    const id = () => String(++msgCounter.current);
    const userMsg: MonoMessage = { id: `u-${id()}`, role: "user", content: msg };
    setMessages((p) => [...p, userMsg]);
    setInput("");
    setLoading(true);
    try {
      const res = await apiChatWithMono(msg);
      setMessages((p) => [...p, { id: `a-${id()}`, role: "assistant", content: res.message }]);
    } catch (err) {
      console.error("Mono chat error:", err);
      setMessages((p) => [...p, { id: `e-${id()}`, role: "assistant", content: "No pude conectarme ahora mismo. Intenta de nuevo." }]);
    } finally {
      setLoading(false);
      focusTimerRef.current = setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [loading, apiChatWithMono]);

  const handleReset = async () => {
    try {
      await resetMonoChat();
      setMessages([{
        id: `w-${++msgCounter.current}`,
        role: "assistant",
        content: "Conversacion reiniciada. En que puedo ayudarte?",
      }]);
    } catch (err) {
      console.error("Mono reset error:", err);
      setMessages((p) => [...p, {
        id: `e-${++msgCounter.current}`,
        role: "assistant",
        content: "No pude reiniciar la conversacion. Intenta de nuevo.",
      }]);
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)] max-h-[800px]">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold text-pnp-textPrimary flex items-center gap-2">
            <span className="text-2xl">🐒</span> Mono
          </h1>
          <p className="text-sm text-pnp-textSecondary">Tu asistente personal de business intelligence — datos en tiempo real</p>
        </div>
        <button
          onClick={handleReset}
          className="text-xs text-pnp-textSecondary hover:text-pnp-textPrimary transition-colors px-3 py-1.5 rounded-lg border border-pnp-border hover:border-pnp-accent/50"
        >
          Nueva conversacion
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto space-y-3 pr-1 mb-3">
        {messages.map((msg) => (
          <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[85%] ${msg.role === "user" ? "" : "flex gap-2"}`}>
              {msg.role === "assistant" && (
                <div className="w-7 h-7 rounded-full bg-pnp-accent/20 flex items-center justify-center flex-shrink-0 mt-0.5 text-sm">
                  🐒
                </div>
              )}
              <div className={`rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap leading-relaxed ${
                msg.role === "user"
                  ? "bg-pnp-accent text-white rounded-br-sm"
                  : "bg-pnp-surface border border-pnp-border text-pnp-textPrimary rounded-bl-sm"
              }`}>
                {msg.content}
              </div>
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex justify-start gap-2">
            <div className="w-7 h-7 rounded-full bg-pnp-accent/20 flex items-center justify-center flex-shrink-0 text-sm">🐒</div>
            <div className="bg-pnp-surface border border-pnp-border rounded-2xl rounded-bl-sm px-4 py-2.5">
              <span className="text-pnp-textSecondary text-xs animate-pulse">Mono esta pensando...</span>
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {/* Quick actions */}
      <div className="flex gap-2 flex-wrap mb-3">
        {QUICK.map((q) => (
          <button
            key={q.label}
            onClick={() => send(q.prompt)}
            disabled={loading}
            className="text-xs px-2.5 py-1 rounded-full bg-pnp-surface border border-pnp-border text-pnp-textSecondary hover:border-pnp-accent/50 hover:text-pnp-textPrimary transition-colors disabled:opacity-40"
          >
            {q.label}
          </button>
        ))}
      </div>

      {/* Input */}
      <div className="flex gap-2 items-end">
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send(input);
            }
          }}
          placeholder="Preguntame sobre miembros, ingresos, installs, campanas..."
          className="flex-1 px-3 py-2.5 rounded-xl bg-pnp-surface border border-pnp-border text-sm text-pnp-textPrimary placeholder:text-pnp-textSecondary focus:border-pnp-accent focus:outline-none resize-none min-h-[42px] max-h-[120px]"
          rows={1}
          disabled={loading}
        />
        <button
          onClick={() => send(input)}
          disabled={!input.trim() || loading}
          className="px-5 py-2.5 rounded-xl bg-pnp-accent text-white text-sm font-medium hover:bg-pnp-accent/80 disabled:opacity-40 transition-colors flex-shrink-0"
        >
          Enviar
        </button>
      </div>
    </div>
  );
}
