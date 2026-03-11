import React, { useState, useEffect } from 'react';

const API_BASE = import.meta.env.VITE_API_URL || 'https://pnptv.app';

async function apiFetch(path: string, options?: RequestInit) {
  const res = await fetch(`${API_BASE}${path}`, { credentials: 'include', ...options });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

interface MediaItem {
  id: number;
  name: string;
  alt_text?: string;
  file_url: string;
  thumbnail_url?: string;
  file_type: string;
  pack_name?: string;
}

interface MediaPack {
  id: number;
  slug: string;
  name: string;
  pack_type: string;
  item_count: number;
}

interface MediaPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (item: MediaItem) => void;
  defaultTab?: 'sticker' | 'gif' | 'emoji' | 'recent';
}

const TABS = [
  { key: 'recent', label: '🕐', title: 'Recent' },
  { key: 'sticker', label: '✨', title: 'Stickers' },
  { key: 'gif', label: '🎬', title: 'GIFs' },
  { key: 'emoji', label: '😄', title: 'Custom Emojis' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

export default function MediaPickerModal({
  isOpen,
  onClose,
  onSelect,
  defaultTab = 'sticker',
}: MediaPickerModalProps) {
  const [activeTab, setActiveTab] = useState<TabKey>(defaultTab);
  const [packs, setPacks] = useState<MediaPack[]>([]);
  const [recentItems, setRecentItems] = useState<MediaItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    apiFetch('/api/webapp/media-packs/favorites')
      .then(d => setRecentItems(d.items || []))
      .catch(() => {});
    if (activeTab !== 'recent') {
      setLoading(true);
      apiFetch(`/api/webapp/media-packs?type=${activeTab}`)
        .then(d => setPacks(d.packs || []))
        .catch(() => setPacks([]))
        .finally(() => setLoading(false));
    }
  }, [isOpen, activeTab]);

  useEffect(() => {
    if (!searchQuery || searchQuery.length < 2) { setSearchResults([]); return; }
    const t = setTimeout(() => {
      apiFetch(`/api/webapp/media-packs/search?q=${encodeURIComponent(searchQuery)}`)
        .then(d => setSearchResults(d.items || []))
        .catch(() => setSearchResults([]));
    }, 300);
    return () => clearTimeout(t);
  }, [searchQuery]);

  if (!isOpen) return null;

  const handleSelect = async (item: MediaItem) => {
    try { await apiFetch(`/api/webapp/media-packs/items/${item.id}/use`, { method: 'POST' }); } catch {}
    onSelect(item);
    onClose();
  };

  const handleTabChange = (tab: TabKey) => {
    setActiveTab(tab);
    setSearchQuery('');
    setSearchResults([]);
  };

  const displayItems = searchQuery.length >= 2
    ? searchResults
    : activeTab === 'recent' ? recentItems : [];

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60" />
      <div
        className="relative bg-zinc-900 border border-zinc-700 rounded-t-2xl sm:rounded-2xl w-full sm:w-96 max-h-[70vh] flex flex-col shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Tab bar */}
        <div className="flex items-center border-b border-zinc-800 px-2 pt-2 gap-1">
          {TABS.map(tab => (
            <button
              key={tab.key}
              onClick={() => handleTabChange(tab.key)}
              title={tab.title}
              className={`flex items-center justify-center w-10 h-10 rounded-lg text-lg transition-colors flex-shrink-0 ${
                activeTab === tab.key ? 'bg-zinc-700 text-white' : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800'
              }`}
            >
              {tab.label}
            </button>
          ))}
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search..."
            className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-violet-500 mx-1"
          />
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center text-zinc-500 hover:text-zinc-200 flex-shrink-0">
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-3 min-h-[200px]">
          {loading && <div className="flex items-center justify-center h-32 text-zinc-500 text-sm">Loading...</div>}

          {!loading && displayItems.length > 0 && (
            <div className="grid grid-cols-4 gap-2">
              {displayItems.map(item => (
                <button
                  key={item.id}
                  onClick={() => handleSelect(item)}
                  className="aspect-square rounded-lg overflow-hidden bg-zinc-800 hover:bg-zinc-700 transition-colors flex items-center justify-center group"
                  title={item.alt_text || item.name}
                >
                  <img
                    src={item.thumbnail_url || item.file_url}
                    alt={item.alt_text || item.name}
                    className="w-full h-full object-contain p-1 group-hover:scale-110 transition-transform"
                  />
                </button>
              ))}
            </div>
          )}

          {!loading && !searchQuery && activeTab !== 'recent' && packs.length > 0 && (
            <div className="space-y-4">
              {packs.map(pack => (
                <PackRow key={pack.id} pack={pack} onSelect={handleSelect} />
              ))}
            </div>
          )}

          {!loading && !searchQuery && activeTab !== 'recent' && packs.length === 0 && (
            <div className="flex flex-col items-center justify-center h-32 text-zinc-500 gap-2">
              <span className="text-3xl">✨</span>
              <span className="text-sm font-medium">Coming soon</span>
              <span className="text-xs text-zinc-600">Custom {activeTab}s will appear here</span>
            </div>
          )}

          {!loading && activeTab === 'recent' && recentItems.length === 0 && !searchQuery && (
            <div className="flex flex-col items-center justify-center h-32 text-zinc-500 gap-1">
              <span className="text-3xl">🕐</span>
              <span className="text-sm">No recently used items</span>
            </div>
          )}

          {!loading && searchQuery.length >= 2 && searchResults.length === 0 && (
            <div className="flex items-center justify-center h-24 text-zinc-500 text-sm">
              No results for "{searchQuery}"
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function PackRow({ pack, onSelect }: { pack: MediaPack; onSelect: (item: MediaItem) => void }) {
  const [items, setItems] = useState<MediaItem[]>([]);
  const [loaded, setLoaded] = useState(false);

  const load = async () => {
    if (loaded) return;
    try {
      const d = await apiFetch(`/api/webapp/media-packs/${pack.slug}/items`);
      setItems(d.items || []);
    } catch {}
    setLoaded(true);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">{pack.name}</span>
        {!loaded && (
          <button onClick={load} className="text-xs text-violet-400 hover:underline">
            Load ({pack.item_count})
          </button>
        )}
      </div>
      {loaded && items.length > 0 && (
        <div className="grid grid-cols-5 gap-1.5">
          {items.map(item => (
            <button
              key={item.id}
              onClick={() => onSelect(item)}
              className="aspect-square rounded-lg overflow-hidden bg-zinc-800 hover:bg-zinc-700 transition-colors"
              title={item.alt_text || item.name}
            >
              <img src={item.thumbnail_url || item.file_url} alt={item.name} className="w-full h-full object-contain p-1" />
            </button>
          ))}
        </div>
      )}
      {loaded && items.length === 0 && (
        <p className="text-xs text-zinc-600">No items in this pack yet.</p>
      )}
    </div>
  );
}
