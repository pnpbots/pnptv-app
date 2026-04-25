import React, { useState, useCallback, useEffect } from "react";
import { Modal } from "@pnptv/ui-kit";
import { useI18n } from "@/lib/i18n";
import { getFollowersList, getFollowingList, type FollowListUser } from "@/lib/api";

// ── Props ─────────────────────────────────────────────────────────────────────

export interface FollowListModalProps {
  open: boolean;
  mode: "followers" | "following";
  targetUserId: string;
  onClose: () => void;
  onNavigate: (userId: string) => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function FollowListModal({
  open,
  mode,
  targetUserId,
  onClose,
  onNavigate,
}: FollowListModalProps) {
  const t = useI18n();
  const p = t.profile;
  const [users, setUsers] = useState<FollowListUser[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(async (cursor?: string) => {
    try {
      const res = mode === "followers"
        ? await getFollowersList(targetUserId, cursor)
        : await getFollowingList(targetUserId, cursor);
      if (res.success) {
        setUsers((prev) => cursor ? [...prev, ...res.users] : res.users);
        setNextCursor(res.nextCursor);
      }
    } catch { /* silent */ }
    setLoading(false);
    setLoadingMore(false);
  }, [mode, targetUserId]);

  useEffect(() => {
    if (!open) return;
    setUsers([]);
    setNextCursor(null);
    setLoading(true);
    load();
  }, [open, load]);

  const handleLoadMore = () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    load(nextCursor);
  };

  return (
    <Modal open={open} onClose={onClose} title={mode === "followers" ? p.followersTitle : p.followingTitle}>
      {loading ? (
        <div className="space-y-3 py-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 animate-pulse">
              <div className="w-10 h-10 rounded-full bg-white/10 flex-shrink-0" />
              <div className="flex-1 space-y-1.5">
                <div className="h-3 bg-white/10 rounded w-32" />
                <div className="h-2.5 bg-white/10 rounded w-20" />
              </div>
            </div>
          ))}
        </div>
      ) : users.length === 0 ? (
        <div className="py-8 text-center">
          <p className="text-white font-medium mb-1">{mode === "followers" ? p.noFollowers : p.noFollowing}</p>
          <p className="text-sm" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>
            {mode === "followers" ? p.noFollowersDesc : p.noFollowingDesc}
          </p>
        </div>
      ) : (
        <div className="space-y-1 py-2">
          {users.map((u) => (
            <button
              key={u.id}
              onClick={() => { onClose(); onNavigate(u.id); }}
              className="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-white/5 transition-colors text-left"
            >
              {u.photoUrl && (u.photoUrl.startsWith("/") || u.photoUrl.startsWith("http")) ? (
                <img src={u.photoUrl} alt={`${u.displayName || u.username || "User"}'s avatar`} className="w-10 h-10 rounded-full object-cover flex-shrink-0" />
              ) : (
                <div
                  className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0"
                  style={{ background: "linear-gradient(135deg, #D4007A, #E69138)", color: "#fff" }}
                >
                  {(u.firstName || u.username || "?")[0].toUpperCase()}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-white truncate">
                  {u.firstName}{u.lastName ? ` ${u.lastName}` : ""}
                </p>
                {u.username && (
                  <p className="text-xs truncate" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>@{u.username}</p>
                )}
              </div>
            </button>
          ))}
          {nextCursor && (
            <div className="pt-2 text-center">
              <button
                onClick={handleLoadMore}
                disabled={loadingMore}
                className="text-sm font-medium px-4 py-1.5 rounded-lg border border-white/10 hover:bg-white/5 transition-colors"
                style={{ color: "#D4007A" }}
              >
                {loadingMore ? p.loading : p.loadMore}
              </button>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
