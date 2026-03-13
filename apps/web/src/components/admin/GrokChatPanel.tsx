import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  chatWithGrokManager,
  resetGrokManagerChat,
  createAdminXCampaign,
  type XActiveAccount,
} from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import {
  GrokActionCard,
  RandomVideoActionCard,
  QUICK_ACTIONS,
  parseGrokAction,
  type GrokAction,
} from "./XCampaignHelpers";

// ── Types ────────────────────────────────────────────────────────────────────
interface GrokChatMessage {
  role: "user" | "assistant";
  content: string;
  id: string;
  action?: GrokAction | null;
}

export interface GrokChatPanelProps {
  accounts: XActiveAccount[];
  mediaFolderId: string | null;
  onApplyCampaign: (form: Partial<Record<string, unknown>>) => void;
  onVideoSaved?: (videoId: string) => void;
}

// ── Component ────────────────────────────────────────────────────────────────
export default function GrokChatPanel({
  accounts,
  mediaFolderId,
  onApplyCampaign,
  onVideoSaved,
}: GrokChatPanelProps) {
  const t = useI18n();
  const [grokOpen, setGrokOpen] = useState(false);
  const [grokMessages, setGrokMessages] = useState<GrokChatMessage[]>([]);
  const [grokInput, setGrokInput] = useState("");
  const [grokLoading, setGrokLoading] = useState(false);
  const grokEndRef = useRef<HTMLDivElement>(null);
  const grokInputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-welcome on first open
  useEffect(() => {
    if (grokOpen && grokMessages.length === 0) {
      setGrokMessages([
        {
          id: "welcome",
          role: "assistant",
          content:
            "Hey! I'm Grok, your X social media strategist. I have access to your campaigns, post performance, and user demographics in real time.\n\nWhat do you want to work on?",
        },
      ]);
    }
  }, [grokOpen, grokMessages.length]);

  // Scroll to bottom on new messages
  useEffect(() => {
    if (grokOpen) grokEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [grokMessages, grokOpen]);

  const sendGrokMessage = useCallback(
    async (msg: string) => {
      if (!msg.trim() || grokLoading) return;
      const userMsg: GrokChatMessage = { id: `u-${Date.now()}`, role: "user", content: msg };
      setGrokMessages((prev) => [...prev, userMsg]);
      setGrokInput("");
      setGrokLoading(true);
      try {
        const res = await chatWithGrokManager(msg);
        const { cleanText, action } = parseGrokAction(res.message);
        setGrokMessages((prev) => [
          ...prev,
          { id: `a-${Date.now()}`, role: "assistant", content: cleanText, action },
        ]);
      } catch {
        setGrokMessages((prev) => [
          ...prev,
          {
            id: `err-${Date.now()}`,
            role: "assistant",
            content: "Sorry, I couldn't connect to Grok right now. Try again in a moment.",
          },
        ]);
      } finally {
        setGrokLoading(false);
      }
    },
    [grokLoading],
  );

  const applyGrokCampaign = useCallback(
    async (action: GrokAction) => {
      const account = accounts.find(
        (a) => a.handle.toLowerCase() === action.accountHandle?.toLowerCase(),
      );
      if (!account) {
        // Surface error inside chat rather than bubbling up
        setGrokMessages((prev) => [
          ...prev,
          {
            id: `err-${Date.now()}`,
            role: "assistant",
            content: `Account @${action.accountHandle} not found. Connect it first.`,
          },
        ]);
        return;
      }
      try {
        await createAdminXCampaign({
          name: action.name || "Untitled Campaign",
          accountId: account.account_id,
          topic: action.topic || "general",
          grokMode: "xPost",
          language: action.language || "en",
          customPrompt: action.customPrompt,
          intervalMinutes: action.intervalMinutes || 480,
          activeHoursStart: action.activeHoursStart ?? 14,
          activeHoursEnd: action.activeHoursEnd ?? 23,
          mediaFolderId: action.attachVideos && mediaFolderId ? mediaFolderId : undefined,
        });
        setGrokMessages((prev) => [
          ...prev,
          {
            id: `sys-${Date.now()}`,
            role: "assistant",
            content: `✓ Campaign "${action.name}" created and added to your campaigns list (paused). Activate it when ready.`,
          },
        ]);
        // Notify parent to refresh lists
        onApplyCampaign({});
      } catch (err) {
        setGrokMessages((prev) => [
          ...prev,
          {
            id: `err-${Date.now()}`,
            role: "assistant",
            content: err instanceof Error ? err.message : "Failed to create campaign",
          },
        ]);
      }
    },
    [accounts, mediaFolderId, onApplyCampaign],
  );

  const resetGrokChat = useCallback(async () => {
    await resetGrokManagerChat().catch(() => {});
    setGrokMessages([]);
  }, []);

  return (
    <div className="mt-6 rounded-xl border border-pnp-border bg-pnp-surface overflow-hidden">
      {/* Header / toggle */}
      <button
        onClick={() => setGrokOpen((p) => !p)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/5 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-lg">⚡</span>
          <span className="text-sm font-semibold text-pnp-textPrimary">Grok Strategy Manager</span>
          <span className="text-xs text-pnp-textSecondary">
            — AI social media strategist with live campaign data
          </span>
        </div>
        <span className="text-pnp-textSecondary text-xs">{grokOpen ? "▲ Collapse" : "▼ Open"}</span>
      </button>

      {grokOpen && (
        <div className="border-t border-pnp-border">
          {/* Messages */}
          <div className="h-[400px] overflow-y-auto p-4 space-y-3 flex flex-col">
            {grokMessages.map((msg) => (
              <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[85%] ${msg.role === "user" ? "order-1" : "order-0"}`}>
                  {msg.role === "assistant" && (
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className="text-xs font-medium text-pnp-accent">Grok</span>
                    </div>
                  )}
                  <div
                    className={`rounded-xl px-3 py-2 text-sm whitespace-pre-wrap leading-relaxed ${
                      msg.role === "user"
                        ? "bg-pnp-accent text-white rounded-br-sm"
                        : "bg-pnp-background border border-pnp-border text-pnp-textPrimary rounded-bl-sm"
                    }`}
                  >
                    {msg.content}
                  </div>
                  {/* Action card — Grok proposed a campaign */}
                  {msg.action && msg.action.action === "create_campaign" && (
                    <GrokActionCard
                      action={msg.action}
                      accounts={accounts}
                      onApply={applyGrokCampaign}
                      t={t}
                    />
                  )}
                  {/* Action card — Grok proposed adding a random video */}
                  {msg.action && msg.action.action === "add_random_video" && (
                    <RandomVideoActionCard
                      action={msg.action}
                      mediaFolderId={mediaFolderId}
                      onSaved={() => onVideoSaved?.("")}
                      t={t}
                    />
                  )}
                </div>
              </div>
            ))}
            {grokLoading && (
              <div className="flex justify-start">
                <div className="bg-pnp-background border border-pnp-border rounded-xl rounded-bl-sm px-3 py-2">
                  <span className="text-pnp-textSecondary text-xs animate-pulse">Grok is thinking...</span>
                </div>
              </div>
            )}
            <div ref={grokEndRef} />
          </div>

          {/* Quick actions */}
          <div className="px-4 py-2 flex gap-2 flex-wrap border-t border-pnp-border/50">
            {QUICK_ACTIONS.map((qa) => (
              <button
                key={qa.label}
                onClick={() => sendGrokMessage(qa.prompt)}
                disabled={grokLoading}
                className="text-xs px-2.5 py-1 rounded-full bg-pnp-background border border-pnp-border text-pnp-textSecondary hover:border-pnp-accent/50 hover:text-pnp-textPrimary transition-colors disabled:opacity-40"
              >
                {qa.label}
              </button>
            ))}
          </div>

          {/* Input */}
          <div className="px-4 pb-4 pt-2 border-t border-pnp-border/50">
            <div className="flex gap-2 items-end">
              <textarea
                ref={grokInputRef}
                value={grokInput}
                onChange={(e) => setGrokInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    sendGrokMessage(grokInput);
                  }
                }}
                placeholder="Ask Grok anything about your campaigns, strategy, demographics..."
                className="flex-1 px-3 py-2 rounded-lg bg-pnp-background border border-pnp-border text-sm text-pnp-textPrimary placeholder:text-pnp-textSecondary focus:border-pnp-accent focus:outline-none resize-none min-h-[38px] max-h-[120px]"
                rows={1}
                disabled={grokLoading}
              />
              <button
                onClick={() => sendGrokMessage(grokInput)}
                disabled={!grokInput.trim() || grokLoading}
                className="px-4 py-2 rounded-lg bg-pnp-accent text-white text-sm font-medium hover:bg-pnp-accent/80 disabled:opacity-40 transition-colors flex-shrink-0"
              >
                Send
              </button>
            </div>
            <div className="flex justify-end mt-1">
              <button
                onClick={resetGrokChat}
                className="text-xs text-pnp-textSecondary hover:text-pnp-textPrimary transition-colors"
              >
                Clear conversation
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
