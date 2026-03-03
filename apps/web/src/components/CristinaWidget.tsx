import React, { useState, useRef, useEffect, useCallback } from "react";
import { useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import {
  getSupportSuggestions,
  sendSupportMessage,
  clearSupportHistory,
  createSupportTicket,
  getSupportTicket,
  getTicketMessages,
  addTicketMessage,
  type SupportTicket,
  type TicketMessage,
  type TicketCategory,
} from "@/lib/api";

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

type WidgetView = "chat" | "ticketForm" | "ticketView";

interface CristinaWidgetProps {
  mode?: "widget" | "page";
}

export function CristinaWidget({ mode = "widget" }: CristinaWidgetProps) {
  const { user } = useAuth();
  const location = useLocation();
  const [isOpen, setIsOpen] = useState(mode === "page");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<SupportSuggestion[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Ticket state
  const [view, setView] = useState<WidgetView>("chat");
  const [ticket, setTicket] = useState<SupportTicket | null>(null);
  const [ticketMessages, setTicketMessages] = useState<TicketMessage[]>([]);
  const [selectedCategory, setSelectedCategory] =
    useState<TicketCategory | null>(null);
  const [ticketDescription, setTicketDescription] = useState("");
  const [isSubmittingTicket, setIsSubmittingTicket] = useState(false);

  // Compute derived values before hooks that depend on them.
  const isOnboarded = !!(user?.ageVerified && user?.termsAccepted);
  const lang = user?.language === "es" ? "es" : "en";

  // Gate ticket creation behind 3 user messages
  const MIN_TURNS_FOR_TICKET = 3;
  const userMessageCount = messages.filter((m) => m.role === "user").length;
  const canCreateTicket = userMessageCount >= MIN_TURNS_FOR_TICKET;
  const hasOpenTicket = !!(ticket && ticket.status !== "closed");

  // In widget mode, suppress the FAB and panel on routes that have their own
  // fixed bottom input bars (Hangouts chat, Direct Messages conversation) to
  // prevent the widget from overlapping the send button.
  const SUPPRESSED_PATHS = ["/chat", "/messages"];
  const isSuppressedRoute =
    mode === "widget" &&
    SUPPRESSED_PATHS.some((p) => location.pathname.startsWith(p));

  // All hooks are declared unconditionally before any early returns (Rules of Hooks).

  // Load suggestions on first open
  useEffect(() => {
    if (!isOnboarded || isSuppressedRoute) return;
    if (isOpen && suggestions.length === 0) {
      getSupportSuggestions(lang)
        .then((res) => {
          if (res.success) setSuggestions(res.suggestions);
        })
        .catch(() => {});
    }
  }, [isOpen, lang, isOnboarded, isSuppressedRoute]);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, ticketMessages, isLoading]);

  // Focus input when opened
  useEffect(() => {
    if (isOpen && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 300);
    }
  }, [isOpen]);

  // Check for existing open ticket when widget opens
  useEffect(() => {
    if (isOpen) {
      getSupportTicket()
        .then((data) => {
          if (data.success && data.ticket && data.ticket.status !== "closed") {
            setTicket(data.ticket);
          }
        })
        .catch(() => {});
    }
  }, [isOpen]);

  // Poll for ticket messages when in ticket view
  useEffect(() => {
    if (view !== "ticketView" || !ticket) return;

    // Initial fetch
    getTicketMessages()
      .then((data) => {
        if (data.success) setTicketMessages(data.messages);
      })
      .catch(() => {});

    const interval = setInterval(() => {
      setTicketMessages((prev) => {
        const lastMsg = prev[prev.length - 1];
        const since = lastMsg?.created_at;
        getTicketMessages(since)
          .then((data) => {
            if (data.success && data.messages.length > 0) {
              setTicketMessages((current) => {
                const existingIds = new Set(current.map((m) => m.id));
                const newMsgs = data.messages.filter(
                  (m) => !existingIds.has(m.id)
                );
                return newMsgs.length > 0 ? [...current, ...newMsgs] : current;
              });
            }
          })
          .catch(() => {});
        return prev;
      });
    }, 15000);

    return () => clearInterval(interval);
  }, [view, ticket]);

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

  const handleCreateTicket = async () => {
    if (!selectedCategory || ticketDescription.trim().length < 10) return;
    setIsSubmittingTicket(true);
    try {
      const data = await createSupportTicket(
        selectedCategory,
        ticketDescription.trim()
      );
      if (data.success) {
        setTicket(data.ticket);
        setView("ticketView");
        setSelectedCategory(null);
        setTicketDescription("");
      }
    } catch {
      // No-op: ticket creation failure is silent; user can retry
    } finally {
      setIsSubmittingTicket(false);
    }
  };

  const handleSendTicketMessage = async () => {
    if (!input.trim()) return;
    const msg = input.trim();
    setInput("");

    // Optimistic update
    const optimisticMsg: TicketMessage = {
      id: Date.now(),
      sender_type: "user",
      sender_name: "You",
      content: msg,
      created_at: new Date().toISOString(),
    };
    setTicketMessages((prev) => [...prev, optimisticMsg]);

    try {
      await addTicketMessage(msg);
    } catch {
      // Remove optimistic message on failure
      setTicketMessages((prev) =>
        prev.filter((m) => m.id !== optimisticMsg.id)
      );
    }
  };

  // Early exits — after ALL hooks have been declared.
  if (!isOnboarded) return null;
  if (isSuppressedRoute) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (view === "ticketView") {
      handleSendTicketMessage();
    } else {
      sendMessage(input);
    }
  };

  // FAB button (widget mode only)
  if (mode === "widget" && !isOpen) {
    return (
      <div className="fixed bottom-20 right-3 z-[38] flex flex-col items-end gap-2 sm:bottom-24 sm:right-4 safe-area-bottom">
        <button
          onClick={() => setIsOpen(true)}
          className="relative w-12 h-12 sm:w-14 sm:h-14 rounded-full shadow-lg flex items-center justify-center text-xl sm:text-2xl transition-transform hover:scale-110 active:scale-95"
          style={{
            background: "linear-gradient(135deg, #5BC8F5, #00D4E8)",
          }}
          aria-label="Open Cristina AI Support"
        >
          {/* Pulse ring */}
          <span
            className="absolute inset-0 rounded-full animate-ping"
            style={{
              background: "linear-gradient(135deg, #5BC8F5, #00D4E8)",
              opacity: 0.3,
              animationDuration: "2.5s",
            }}
          />
          {/* Glow halo */}
          <span
            className="absolute -inset-1 rounded-full"
            style={{
              background: "linear-gradient(135deg, #5BC8F5, #00D4E8)",
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
          : "fixed z-[42] flex flex-col overflow-hidden shadow-2xl " +
            "inset-0 w-full h-full " +
            "sm:inset-auto sm:bottom-24 sm:right-4 sm:w-[400px] sm:h-[600px] sm:rounded-2xl"
      }
      style={{
        background: "rgba(20, 20, 30, 0.98)",
        ...(mode === "page" ? { border: "1px solid rgba(255,255,255,0.08)" } : {}),
      }}
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
          {/* Ticket icon button — only visible after 3 turns or if user has an open ticket */}
          {(canCreateTicket || hasOpenTicket) && (
            <button
              onClick={() => (ticket ? setView("ticketView") : setView("ticketForm"))}
              className="relative p-1.5 rounded-lg hover:bg-white/10 transition-colors"
              title={lang === "es" ? "Ticket de soporte" : "Support ticket"}
            >
              <svg
                className="w-4 h-4 text-gray-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                />
              </svg>
              {hasOpenTicket && (
                <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-cyan-400 rounded-full" />
              )}
            </button>
          )}

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

      {/* ------------------------------------------------------------------ */}
      {/* TICKET FORM VIEW                                                     */}
      {/* ------------------------------------------------------------------ */}
      {view === "ticketForm" && (
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Back + title */}
          <div className="flex items-center gap-2 mb-2">
            <button
              onClick={() => setView("chat")}
              className="text-gray-400 hover:text-white transition-colors"
            >
              <svg
                className="w-5 h-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15 19l-7-7 7-7"
                />
              </svg>
            </button>
            <h3 className="text-white font-semibold text-sm">
              {lang === "es"
                ? "Crear Ticket de Soporte"
                : "Create Support Ticket"}
            </h3>
          </div>

          {/* Category selection */}
          <div>
            <p className="text-xs text-gray-400 mb-2">
              {lang === "es" ? "Selecciona una categoría:" : "Select a category:"}
            </p>
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  {
                    key: "payment" as TicketCategory,
                    emoji: "💳",
                    en: "Payment",
                    es: "Pago",
                  },
                  {
                    key: "account" as TicketCategory,
                    emoji: "👤",
                    en: "Account",
                    es: "Cuenta",
                  },
                  {
                    key: "bug" as TicketCategory,
                    emoji: "🐛",
                    en: "Bug Report",
                    es: "Reporte de Bug",
                  },
                  {
                    key: "feature" as TicketCategory,
                    emoji: "🚀",
                    en: "Feature",
                    es: "Sugerencia",
                  },
                  {
                    key: "technical" as TicketCategory,
                    emoji: "🛠",
                    en: "Technical",
                    es: "Técnico",
                  },
                  {
                    key: "general" as TicketCategory,
                    emoji: "📋",
                    en: "General",
                    es: "General",
                  },
                ] satisfies {
                  key: TicketCategory;
                  emoji: string;
                  en: string;
                  es: string;
                }[]
              ).map((cat) => (
                <button
                  key={cat.key}
                  onClick={() => setSelectedCategory(cat.key)}
                  className={`px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                    selectedCategory === cat.key
                      ? "bg-cyan-500/30 border border-cyan-400 text-cyan-200"
                      : "bg-white/5 border border-white/10 text-gray-300 hover:bg-white/10"
                  }`}
                >
                  {cat.emoji} {lang === "es" ? cat.es : cat.en}
                </button>
              ))}
            </div>
          </div>

          {/* Description */}
          <div>
            <p className="text-xs text-gray-400 mb-2">
              {lang === "es" ? "Describe tu problema:" : "Describe your issue:"}
            </p>
            <textarea
              value={ticketDescription}
              onChange={(e) =>
                setTicketDescription(e.target.value.slice(0, 2000))
              }
              placeholder={
                lang === "es"
                  ? "Escribe los detalles aquí..."
                  : "Write the details here..."
              }
              className="w-full h-32 px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white placeholder-gray-500 resize-none focus:outline-none focus:border-cyan-500/50"
            />
            <p className="text-xs text-gray-500 mt-1 text-right">
              {ticketDescription.length}/2000
            </p>
          </div>

          {/* Submit */}
          <button
            onClick={handleCreateTicket}
            disabled={
              !selectedCategory ||
              ticketDescription.trim().length < 10 ||
              isSubmittingTicket
            }
            className="w-full py-2.5 rounded-lg text-sm font-semibold transition-colors bg-gradient-to-r from-cyan-500 to-teal-500 text-white disabled:opacity-40 disabled:cursor-not-allowed hover:from-cyan-400 hover:to-teal-400"
          >
            {isSubmittingTicket
              ? lang === "es"
                ? "Enviando..."
                : "Submitting..."
              : lang === "es"
              ? "Enviar Ticket"
              : "Submit Ticket"}
          </button>
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* TICKET VIEW                                                          */}
      {/* ------------------------------------------------------------------ */}
      {view === "ticketView" && (
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {/* Back + title + status badge */}
          <div className="flex items-center gap-2 mb-2">
            <button
              onClick={() => setView("chat")}
              className="text-gray-400 hover:text-white transition-colors"
            >
              <svg
                className="w-5 h-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15 19l-7-7 7-7"
                />
              </svg>
            </button>
            <h3 className="text-white font-semibold text-sm">
              {lang === "es" ? "Ticket de Soporte" : "Support Ticket"}
            </h3>
            <span
              className={`ml-auto text-xs px-2 py-0.5 rounded-full ${
                ticket?.status === "open"
                  ? "bg-green-500/20 text-green-400"
                  : ticket?.status === "resolved"
                  ? "bg-yellow-500/20 text-yellow-400"
                  : "bg-gray-500/20 text-gray-400"
              }`}
            >
              {ticket?.status ?? "open"}
            </span>
          </div>

          {/* Ticket info card */}
          {ticket && (
            <div className="bg-white/5 rounded-lg p-3 border border-white/10">
              <div className="flex items-center gap-2 text-xs text-gray-400">
                <span className="capitalize">{ticket.category ?? "general"}</span>
                <span>•</span>
                <span>{new Date(ticket.created_at).toLocaleDateString()}</span>
                {ticket.first_response_at && (
                  <>
                    <span>•</span>
                    <span className="text-green-400">
                      {lang === "es" ? "Respondido" : "Replied"}
                    </span>
                  </>
                )}
              </div>
            </div>
          )}

          {/* Messages */}
          {ticketMessages.length === 0 ? (
            <div className="text-center text-gray-500 text-xs py-8">
              {lang === "es"
                ? "Esperando respuesta del equipo de soporte..."
                : "Waiting for support team response..."}
            </div>
          ) : (
            ticketMessages.map((msg) => (
              <div
                key={msg.id}
                className={`flex ${
                  msg.sender_type === "user" ? "justify-end" : "justify-start"
                }`}
              >
                <div
                  className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${
                    msg.sender_type === "user"
                      ? "bg-cyan-600/30 text-cyan-100 rounded-br-md"
                      : "bg-white/10 text-gray-200 rounded-bl-md"
                  }`}
                >
                  {msg.sender_type === "agent" && (
                    <p className="text-xs text-cyan-400 font-medium mb-1">
                      💬 {msg.sender_name}
                    </p>
                  )}
                  <p className="whitespace-pre-wrap break-words">{msg.content}</p>
                  <p className="text-xs text-gray-500 mt-1">
                    {new Date(msg.created_at).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </p>
                </div>
              </div>
            ))
          )}

          <div ref={messagesEndRef} />
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* CHAT VIEW (AI)                                                       */}
      {/* ------------------------------------------------------------------ */}
      {view === "chat" && (
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {/* Open ticket banner */}
          {ticket && ticket.status !== "closed" && (
            <div
              onClick={() => setView("ticketView")}
              className="mx-0 mt-0 px-3 py-2 bg-cyan-900/40 border border-cyan-500/30 rounded-lg cursor-pointer hover:bg-cyan-900/60 transition-colors"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs text-cyan-300">
                  📋{" "}
                  {lang === "es"
                    ? "Tienes un ticket de soporte abierto"
                    : "You have an open support ticket"}
                </span>
                <span className="text-xs text-cyan-400 font-medium">
                  {lang === "es" ? "Ver →" : "View →"}
                </span>
              </div>
            </div>
          )}

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
                      background: "rgba(0, 212, 232, 0.15)",
                      border: "1px solid rgba(0, 212, 232, 0.3)",
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
              className={`flex ${
                msg.role === "user" ? "justify-end" : "justify-start"
              } animate-fade-in-up`}
            >
              <div
                className={`max-w-[80%] px-3 py-2 rounded-2xl text-sm leading-relaxed ${
                  msg.role === "user" ? "text-white" : "text-pnp-textPrimary"
                }`}
                style={
                  msg.role === "user"
                    ? { background: "linear-gradient(135deg, #5BC8F5, #00D4E8)" }
                    : { background: "rgba(255, 255, 255, 0.06)" }
                }
              >
                {msg.content}
              </div>
            </div>
          ))}

          {/* "Still need help?" banner — shown after 3 user messages, no open ticket */}
          {canCreateTicket && !hasOpenTicket && !isLoading && (
            <div className="animate-fade-in-up">
              <button
                onClick={() => setView("ticketForm")}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs transition-colors hover:bg-white/10"
                style={{
                  background: "rgba(0, 212, 232, 0.08)",
                  border: "1px solid rgba(0, 212, 232, 0.2)",
                }}
              >
                <svg
                  className="w-3.5 h-3.5 text-cyan-400"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                  />
                </svg>
                <span className="text-cyan-300">
                  {lang === "es"
                    ? "¿Aún necesitas ayuda? → Crear ticket de soporte"
                    : "Still need help? → Create a support ticket"}
                </span>
              </button>
            </div>
          )}

          {isLoading && (
            <div className="flex justify-start animate-fade-in-up">
              <div
                className="px-4 py-3 rounded-2xl flex items-center gap-1"
                style={{ background: "rgba(255, 255, 255, 0.06)" }}
              >
                <span
                  className="w-2 h-2 rounded-full bg-pnp-textSecondary animate-bounce"
                  style={{ animationDelay: "0ms" }}
                />
                <span
                  className="w-2 h-2 rounded-full bg-pnp-textSecondary animate-bounce"
                  style={{ animationDelay: "150ms" }}
                />
                <span
                  className="w-2 h-2 rounded-full bg-pnp-textSecondary animate-bounce"
                  style={{ animationDelay: "300ms" }}
                />
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      )}

      {/* Input area — hidden in ticketForm view (form has its own submit button) */}
      {view !== "ticketForm" && (
        <form
          onSubmit={handleSubmit}
          className="flex items-center gap-2 p-3 pb-safe border-t border-pnp-border flex-shrink-0"
          style={{
            background: "rgba(30, 30, 45, 0.95)",
            paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))",
          }}
        >
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={
              view === "ticketView"
                ? lang === "es"
                  ? "Responder al ticket..."
                  : "Reply to ticket..."
                : lang === "es"
                ? "Escribe tu mensaje..."
                : "Type your message..."
            }
            maxLength={1000}
            disabled={isLoading}
            className="flex-1 bg-white/5 border border-pnp-border rounded-xl px-3 py-2 text-sm text-pnp-textPrimary placeholder-pnp-textSecondary focus:outline-none focus:border-cyan-400/50 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={!input.trim() || isLoading}
            className="p-2 rounded-xl transition-all disabled:opacity-30"
            style={{
              background:
                input.trim() && !isLoading
                  ? "linear-gradient(135deg, #5BC8F5, #00D4E8)"
                  : "rgba(255,255,255,0.05)",
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
      )}
    </div>
  );

  // Widget mode: show backdrop on mobile
  if (mode === "widget") {
    return (
      <>
        {/* Mobile backdrop */}
        <div
          className="fixed inset-0 bg-black/50 z-[41] sm:hidden"
          onClick={() => setIsOpen(false)}
        />
        {chatPanel}
      </>
    );
  }

  return chatPanel;
}

export default CristinaWidget;
