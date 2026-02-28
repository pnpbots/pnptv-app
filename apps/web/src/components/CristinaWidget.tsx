import React, { useState, useRef, useEffect, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { getSupportSuggestions, sendSupportMessage, clearSupportHistory } from "@/lib/api";

interface SupportSuggestion {
  id: string;
  label: string;
  icon: string;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

interface CristinaWidgetProps {
  mode?: "widget" | "page";
}

export function CristinaWidget({ mode = "widget" }: CristinaWidgetProps) {
  const { user } = useAuth();
  const [isOpen, setIsOpen] = useState(mode === "page");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<SupportSuggestion[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Don't render widget if user hasn't completed onboarding
  if (!user?.ageVerified || !user?.termsAccepted) return null;

  const lang = user.language === "es" ? "es" : "en";

  // Load suggestions on first open
  useEffect(() => {
    if (isOpen && suggestions.length === 0) {
      getSupportSuggestions(lang)
        .then((res) => {
          if (res.success) setSuggestions(res.suggestions);
        })
        .catch(() => {});
    }
  }, [isOpen, lang]);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  // Focus input when opened
  useEffect(() => {
    if (isOpen && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 300);
    }
  }, [isOpen]);

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || isLoading) return;

      const userMsg: ChatMessage = {
        id: `u-${Date.now()}`,
        role: "user",
        content: text.trim(),
        timestamp: Date.now(),
      };

      setMessages((prev) => [...prev, userMsg]);
      setInput("");
      setIsLoading(true);

      try {
        const res = await sendSupportMessage(text.trim(), lang);
        if (res.success && res.response) {
          setMessages((prev) => [
            ...prev,
            {
              id: `a-${Date.now()}`,
              role: "assistant",
              content: res.response,
              timestamp: Date.now(),
            },
          ]);
        }
      } catch {
        setMessages((prev) => [
          ...prev,
          {
            id: `e-${Date.now()}`,
            role: "assistant",
            content:
              lang === "es"
                ? "Lo siento, hubo un error. Por favor intenta de nuevo."
                : "Sorry, there was an error. Please try again.",
            timestamp: Date.now(),
          },
        ]);
      } finally {
        setIsLoading(false);
      }
    },
    [isLoading, lang]
  );

  const handleNewConversation = useCallback(async () => {
    try {
      await clearSupportHistory();
    } catch {}
    setMessages([]);
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(input);
  };

  // FAB button (widget mode only)
  if (mode === "widget" && !isOpen) {
    return (
      <div className="fixed bottom-24 right-4 z-50 flex flex-col items-end gap-2">
        <button
          onClick={() => setIsOpen(true)}
          className="relative w-14 h-14 rounded-full shadow-lg flex items-center justify-center text-2xl transition-transform hover:scale-110 active:scale-95"
          style={{
            background: "linear-gradient(135deg, #D4007A, #E69138)",
          }}
          aria-label="Open Cristina AI Support"
        >
          {/* Pulse ring */}
          <span
            className="absolute inset-0 rounded-full animate-ping"
            style={{
              background: "linear-gradient(135deg, #D4007A, #E69138)",
              opacity: 0.3,
              animationDuration: "2.5s",
            }}
          />
          {/* Glow halo */}
          <span
            className="absolute -inset-1 rounded-full"
            style={{
              background: "linear-gradient(135deg, #D4007A, #E69138)",
              opacity: 0.25,
              filter: "blur(8px)",
            }}
          />
          <span className="relative">🧜‍♀️</span>
        </button>
      </div>
    );
  }

  const chatPanel = (
    <div
      className={
        mode === "page"
          ? "flex flex-col h-[calc(100vh-12rem)] max-h-[800px] glass-card-sm rounded-2xl overflow-hidden"
          : "fixed z-50 flex flex-col overflow-hidden shadow-2xl " +
            "bottom-0 right-0 w-full h-[85vh] rounded-t-2xl " +
            "sm:bottom-24 sm:right-4 sm:w-[400px] sm:h-[600px] sm:rounded-2xl"
      }
      style={{ background: "rgba(20, 20, 30, 0.98)", border: "1px solid rgba(255,255,255,0.08)" }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3 border-b border-pnp-border flex-shrink-0"
        style={{ background: "rgba(30, 30, 45, 0.95)" }}
      >
        <div className="flex items-center gap-2">
          <span className="text-xl">🧜‍♀️</span>
          <div>
            <h3 className="text-sm font-semibold text-pnp-textPrimary">Cristina AI</h3>
            <p className="text-[10px] text-pnp-textSecondary">
              {lang === "es" ? "Soporte PNPtv" : "PNPtv Support"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={handleNewConversation}
            className="p-2 rounded-lg text-pnp-textSecondary hover:text-pnp-textPrimary hover:bg-white/5 transition-colors"
            title={lang === "es" ? "Nueva conversación" : "New conversation"}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
          {mode === "widget" && (
            <button
              onClick={() => setIsOpen(false)}
              className="p-2 rounded-lg text-pnp-textSecondary hover:text-pnp-textPrimary hover:bg-white/5 transition-colors"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 && !isLoading && (
          <div className="animate-fade-in-up">
            {/* Welcome message */}
            <div className="text-center mb-6 mt-4">
              <span className="text-4xl block mb-2">🧜‍♀️</span>
              <h4 className="text-sm font-semibold text-pnp-textPrimary mb-1">
                {lang === "es" ? "¡Hola! Soy Cristina" : "Hi! I'm Cristina"}
              </h4>
              <p className="text-xs text-pnp-textSecondary">
                {lang === "es"
                  ? "Tu asistente de soporte PNPtv. ¿En qué puedo ayudarte?"
                  : "Your PNPtv support assistant. How can I help you?"}
              </p>
            </div>
            {/* Suggestion chips */}
            <div className="flex flex-wrap gap-2 justify-center">
              {suggestions.map((s) => (
                <button
                  key={s.id}
                  onClick={() => sendMessage(s.label)}
                  className="px-3 py-1.5 rounded-full text-xs font-medium transition-all hover:scale-105 active:scale-95"
                  style={{
                    background: "rgba(212, 0, 122, 0.15)",
                    border: "1px solid rgba(212, 0, 122, 0.3)",
                    color: "rgba(255, 255, 255, 0.9)",
                  }}
                >
                  {s.icon} {s.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"} animate-fade-in-up`}
          >
            <div
              className={`max-w-[80%] px-3 py-2 rounded-2xl text-sm leading-relaxed ${
                msg.role === "user" ? "text-white" : "text-pnp-textPrimary"
              }`}
              style={
                msg.role === "user"
                  ? { background: "linear-gradient(135deg, #D4007A, #E69138)" }
                  : { background: "rgba(255, 255, 255, 0.06)" }
              }
            >
              {msg.content}
            </div>
          </div>
        ))}

        {isLoading && (
          <div className="flex justify-start animate-fade-in-up">
            <div
              className="px-4 py-3 rounded-2xl flex items-center gap-1"
              style={{ background: "rgba(255, 255, 255, 0.06)" }}
            >
              <span className="w-2 h-2 rounded-full bg-pnp-textSecondary animate-bounce" style={{ animationDelay: "0ms" }} />
              <span className="w-2 h-2 rounded-full bg-pnp-textSecondary animate-bounce" style={{ animationDelay: "150ms" }} />
              <span className="w-2 h-2 rounded-full bg-pnp-textSecondary animate-bounce" style={{ animationDelay: "300ms" }} />
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <form
        onSubmit={handleSubmit}
        className="flex items-center gap-2 p-3 border-t border-pnp-border flex-shrink-0"
        style={{ background: "rgba(30, 30, 45, 0.95)" }}
      >
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={lang === "es" ? "Escribe tu mensaje..." : "Type your message..."}
          maxLength={1000}
          disabled={isLoading}
          className="flex-1 bg-white/5 border border-pnp-border rounded-xl px-3 py-2 text-sm text-pnp-textPrimary placeholder-pnp-textSecondary focus:outline-none focus:border-pink-500/50 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={!input.trim() || isLoading}
          className="p-2 rounded-xl transition-all disabled:opacity-30"
          style={{
            background: input.trim() && !isLoading ? "linear-gradient(135deg, #D4007A, #E69138)" : "rgba(255,255,255,0.05)",
          }}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="white"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m22 2-7 20-4-9-9-4z" />
            <path d="M22 2 11 13" />
          </svg>
        </button>
      </form>
    </div>
  );

  // Widget mode: show backdrop on mobile
  if (mode === "widget") {
    return (
      <>
        {/* Mobile backdrop */}
        <div
          className="fixed inset-0 bg-black/50 z-40 sm:hidden"
          onClick={() => setIsOpen(false)}
        />
        {chatPanel}
      </>
    );
  }

  return chatPanel;
}

export default CristinaWidget;
