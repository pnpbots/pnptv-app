import React, { useState, useEffect, useCallback } from "react";
import { DataTable } from "@/components/admin/DataTable";
import { Pagination } from "@/components/admin/Pagination";
import { ConfirmModal } from "@/components/admin/ConfirmModal";
import { Badge } from "@pnptv/ui-kit";
import {
  getAdminPosts,
  deleteAdminPost,
  type AdminPost,
} from "@/lib/api";

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function truncate(text: string, maxLen: number): string {
  if (!text) return "—";
  return text.length > maxLen ? text.slice(0, maxLen) + "…" : text;
}

export default function ContentModeration() {
  const [posts, setPosts] = useState<AdminPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  const [deleteTarget, setDeleteTarget] = useState<AdminPost | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const load = useCallback(async (p: number) => {
    setLoading(true);
    try {
      const res = await getAdminPosts(p);
      setPosts(res.posts);
      setTotalPages(res.pagination.totalPages);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load posts");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(page);
  }, [load, page]);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleteLoading(true);
    try {
      await deleteAdminPost(deleteTarget.id);
      setDeleteTarget(null);
      await load(page);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete post");
      setDeleteTarget(null);
    } finally {
      setDeleteLoading(false);
    }
  };

  const columns = [
    {
      key: "author",
      header: "Author",
      render: (row: AdminPost) => (
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
            style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}>
            {(row.authorFirstName || row.authorUsername || "?")[0].toUpperCase()}
          </div>
          <div className="min-w-0">
            <div className="text-sm font-medium text-pnp-textPrimary truncate">
              {row.authorFirstName || row.authorUsername}
            </div>
            {row.authorUsername && (
              <div className="text-xs text-pnp-textSecondary">@{row.authorUsername}</div>
            )}
          </div>
        </div>
      ),
    },
    {
      key: "content",
      header: "Content",
      render: (row: AdminPost) => (
        <span className="text-sm text-pnp-textPrimary">{truncate(row.content, 80)}</span>
      ),
    },
    {
      key: "media",
      header: "Media",
      render: (row: AdminPost) =>
        row.mediaUrl ? (
          <Badge variant="accent">{row.mediaType ?? "media"}</Badge>
        ) : (
          <span className="text-pnp-textSecondary text-xs">—</span>
        ),
    },
    {
      key: "likesCount",
      header: "Likes",
      render: (row: AdminPost) => (
        <span className="text-pnp-textSecondary text-sm">{row.likesCount}</span>
      ),
    },
    {
      key: "repliesCount",
      header: "Replies",
      render: (row: AdminPost) => (
        <span className="text-pnp-textSecondary text-sm">{row.repliesCount}</span>
      ),
    },
    {
      key: "createdAt",
      header: "Date",
      render: (row: AdminPost) => (
        <span className="text-xs text-pnp-textSecondary">{formatDate(row.createdAt)}</span>
      ),
    },
    {
      key: "actions",
      header: "Actions",
      render: (row: AdminPost) => (
        <button
          onClick={(e) => { e.stopPropagation(); setDeleteTarget(row); }}
          className="text-xs text-red-400 hover:underline"
        >
          Delete
        </button>
      ),
    },
  ];

  return (
    <div className="page-container space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-pnp-textPrimary">Content Moderation</h1>
        <p className="text-sm text-pnp-textSecondary mt-1">
          Review and remove community posts
        </p>
      </div>

      {error && (
        <div className="px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-400 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="ml-2 text-red-400 hover:text-red-300">Dismiss</button>
        </div>
      )}

      <DataTable
        columns={columns}
        data={posts}
        loading={loading}
        emptyMessage="No posts found"
        getRowId={(row) => String(row.id)}
      />

      <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />

      <ConfirmModal
        open={!!deleteTarget}
        title="Delete Post"
        message={`Are you sure you want to permanently delete this post by @${deleteTarget?.authorUsername ?? "unknown"}? This action cannot be undone.`}
        confirmLabel="Delete Post"
        variant="danger"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
        loading={deleteLoading}
      />
    </div>
  );
}
