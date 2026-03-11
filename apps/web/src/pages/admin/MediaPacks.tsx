import React, { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useNavigate } from 'react-router-dom';

const API_BASE = import.meta.env.VITE_API_URL || 'https://pnptv.app';

async function apiFetch(path: string, options?: RequestInit) {
  const res = await fetch(`${API_BASE}${path}`, { credentials: 'include', ...options });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function apiJson(path: string, method: string, body: unknown) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

interface Pack {
  id: number;
  slug: string;
  name: string;
  description?: string;
  pack_type: 'sticker' | 'gif' | 'emoji';
  is_active: boolean;
  is_premium: boolean;
  item_count: number;
  created_at: string;
}

interface MediaItem {
  id: number;
  slug: string;
  name: string;
  alt_text?: string;
  file_url: string;
  thumbnail_url?: string;
  file_type: string;
  use_count: number;
  is_active: boolean;
}

const PACK_TYPE_LABELS: Record<string, string> = { sticker: 'Sticker', gif: 'GIF', emoji: 'Custom Emoji' };

export default function MediaPacks() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [packs, setPacks] = useState<Pack[]>([]);
  const [selectedPack, setSelectedPack] = useState<Pack | null>(null);
  const [items, setItems] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewPackForm, setShowNewPackForm] = useState(false);
  const [newPack, setNewPack] = useState({ slug: '', name: '', description: '', pack_type: 'sticker', is_premium: false });
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (user?.role !== 'admin' && user?.role !== 'superadmin') navigate('/');
  }, [user, navigate]);

  const loadPacks = async () => {
    setLoading(true);
    try {
      const d = await apiFetch('/api/webapp/media-packs');
      setPacks(d.packs || []);
    } catch { setPacks([]); }
    finally { setLoading(false); }
  };

  const loadItems = async (pack: Pack) => {
    try {
      const d = await apiFetch(`/api/webapp/media-packs/${pack.slug}/items`);
      setItems(d.items || []);
    } catch { setItems([]); }
  };

  useEffect(() => { loadPacks(); }, []);

  const handleSelectPack = (pack: Pack) => { setSelectedPack(pack); loadItems(pack); };

  const handleToggle = async (packId: number, currentlyActive: boolean) => {
    try {
      await apiJson(`/api/webapp/admin/media-packs/${packId}/toggle`, 'PATCH', { is_active: !currentlyActive });
      await loadPacks();
      if (selectedPack?.id === packId) setSelectedPack(p => p ? { ...p, is_active: !currentlyActive } : p);
    } catch (err) { console.error(err); }
  };

  const handleDeletePack = async (packId: number) => {
    if (!window.confirm('Delete this pack and all its items? This cannot be undone.')) return;
    try {
      const res = await fetch(`${API_BASE}/api/webapp/admin/media-packs/${packId}`, {
        method: 'DELETE', credentials: 'include',
      });
      if (!res.ok) throw new Error('Delete failed');
      setSelectedPack(null); setItems([]);
      await loadPacks();
    } catch (err) { console.error(err); }
  };

  const handleCreatePack = async () => {
    if (!newPack.slug.trim() || !newPack.name.trim()) { alert('Slug and name are required'); return; }
    setCreating(true);
    try {
      await apiJson('/api/webapp/admin/media-packs', 'POST', newPack);
      setShowNewPackForm(false);
      setNewPack({ slug: '', name: '', description: '', pack_type: 'sticker', is_premium: false });
      await loadPacks();
    } catch (err: any) { alert(err.message || 'Error creating pack'); }
    finally { setCreating(false); }
  };

  const handleDeleteItem = async (itemId: number) => {
    if (!window.confirm('Delete this item?')) return;
    try {
      await fetch(`${API_BASE}/api/webapp/admin/media-packs/items/${itemId}`, {
        method: 'DELETE', credentials: 'include',
      });
      if (selectedPack) await loadItems(selectedPack);
    } catch { console.error('Item delete failed'); }
  };

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-zinc-100">Media Packs</h1>
          <p className="text-zinc-400 text-sm mt-1">Manage sticker, GIF, and custom emoji packs</p>
        </div>
        <button
          onClick={() => setShowNewPackForm(v => !v)}
          className="flex items-center gap-1.5 px-3 py-2 bg-violet-600 hover:bg-violet-500 text-white rounded-lg text-sm font-medium transition-colors"
        >
          + New Pack
        </button>
      </div>

      {showNewPackForm && (
        <div className="bg-zinc-800 border border-zinc-700 rounded-xl p-4 mb-6">
          <h3 className="text-sm font-semibold text-zinc-300 mb-3">Create New Pack</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input
              placeholder="slug (e.g. pnptv-launch)"
              value={newPack.slug}
              onChange={e => setNewPack(p => ({ ...p, slug: e.target.value.replace(/\s+/g, '-').toLowerCase() }))}
              className="bg-zinc-900 border border-zinc-600 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-violet-500"
            />
            <input
              placeholder="Display name"
              value={newPack.name}
              onChange={e => setNewPack(p => ({ ...p, name: e.target.value }))}
              className="bg-zinc-900 border border-zinc-600 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-violet-500"
            />
            <select
              value={newPack.pack_type}
              onChange={e => setNewPack(p => ({ ...p, pack_type: e.target.value }))}
              className="bg-zinc-900 border border-zinc-600 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-violet-500"
            >
              <option value="sticker">Sticker Pack</option>
              <option value="gif">GIF Pack</option>
              <option value="emoji">Custom Emoji Pack</option>
            </select>
            <label className="flex items-center gap-2 text-sm text-zinc-300 cursor-pointer">
              <input
                type="checkbox"
                checked={newPack.is_premium}
                onChange={e => setNewPack(p => ({ ...p, is_premium: e.target.checked }))}
                className="w-4 h-4 accent-violet-500"
              />
              Premium-only pack
            </label>
          </div>
          <div className="flex gap-2 mt-3">
            <button
              onClick={handleCreatePack}
              disabled={creating}
              className="px-4 py-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors"
            >
              {creating ? 'Creating...' : 'Create Pack'}
            </button>
            <button
              onClick={() => setShowNewPackForm(false)}
              className="px-4 py-2 bg-zinc-700 hover:bg-zinc-600 text-zinc-200 rounded-lg text-sm transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Pack list */}
        <div className="lg:col-span-1 space-y-2">
          {loading && <div className="text-zinc-500 text-sm py-4 text-center">Loading packs...</div>}
          {!loading && packs.length === 0 && (
            <div className="text-zinc-500 text-sm text-center py-10 border border-zinc-700 rounded-xl">
              <div className="text-3xl mb-2">📦</div>No packs yet
            </div>
          )}
          {packs.map(pack => (
            <div
              key={pack.id}
              onClick={() => handleSelectPack(pack)}
              className={`p-3 rounded-xl border cursor-pointer transition-colors ${
                selectedPack?.id === pack.id
                  ? 'bg-violet-900/30 border-violet-500'
                  : 'bg-zinc-800 border-zinc-700 hover:border-zinc-500'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-zinc-100 truncate">{pack.name}</div>
                  <div className="text-xs text-zinc-500 mt-0.5">{PACK_TYPE_LABELS[pack.pack_type]} · {pack.item_count} items</div>
                </div>
                <div className="flex gap-1 flex-shrink-0">
                  {pack.is_premium && <span className="text-xs bg-amber-900/40 text-amber-300 px-1.5 py-0.5 rounded">PRO</span>}
                  <span className={`text-xs px-1.5 py-0.5 rounded ${pack.is_active ? 'bg-green-900/40 text-green-400' : 'bg-zinc-700 text-zinc-500'}`}>
                    {pack.is_active ? 'Active' : 'Off'}
                  </span>
                </div>
              </div>
              <div className="flex gap-3 mt-2">
                <button
                  onClick={e => { e.stopPropagation(); handleToggle(pack.id, pack.is_active); }}
                  className="text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
                >
                  {pack.is_active ? 'Disable' : 'Enable'}
                </button>
                <button
                  onClick={e => { e.stopPropagation(); handleDeletePack(pack.id); }}
                  className="text-xs text-red-400 hover:text-red-300 transition-colors"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Items */}
        <div className="lg:col-span-2">
          {!selectedPack ? (
            <div className="flex flex-col items-center justify-center h-full min-h-[200px] text-zinc-600 border border-zinc-800 rounded-xl">
              <span className="text-3xl mb-2">👈</span>
              <span className="text-sm">Select a pack to view its items</span>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-base font-semibold text-zinc-100">{selectedPack.name}</h2>
                <span className="text-sm text-zinc-500">{items.length} items</span>
              </div>
              {items.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-40 text-zinc-500 text-sm border border-zinc-700 rounded-xl gap-1">
                  <span className="text-3xl">📦</span>
                  <span>No items in this pack yet</span>
                  <code className="text-xs text-zinc-600 mt-1 bg-zinc-800 px-2 py-0.5 rounded">
                    POST /api/webapp/admin/media-packs/{selectedPack.id}/items
                  </code>
                </div>
              ) : (
                <div className="grid grid-cols-4 sm:grid-cols-5 gap-2">
                  {items.map(item => (
                    <div key={item.id} className="relative group">
                      <div className="aspect-square rounded-lg overflow-hidden bg-zinc-800 border border-zinc-700">
                        <img
                          src={item.thumbnail_url || item.file_url}
                          alt={item.alt_text || item.name}
                          className="w-full h-full object-contain p-1"
                        />
                      </div>
                      <div className="text-xs text-zinc-500 truncate mt-0.5 text-center">{item.name}</div>
                      <div className="text-xs text-zinc-600 text-center">{item.use_count} uses</div>
                      <button
                        onClick={() => handleDeleteItem(item.id)}
                        className="absolute top-1 right-1 hidden group-hover:flex items-center justify-center w-5 h-5 rounded-full bg-red-500 hover:bg-red-400 text-white text-xs"
                        aria-label="Delete item"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
