<template>
	<div class="video-cards-layout">
		<div v-if="loading" class="state">Loading…</div>
		<div v-else-if="errorMsg" class="state error">{{ errorMsg }}</div>
		<div v-else-if="!items.length" class="state">No files found.</div>
		<div v-else class="grid">
			<div v-for="item in items" :key="item.id" class="card">
				<div
					v-if="isVideo(item)"
					class="thumb video-thumb"
					:class="{ playing: playing[item.id] }"
					@mouseenter="onHover(item, true)"
					@mouseleave="onHover(item, false)"
				>
					<!-- Full-controls player when expanded -->
					<video
						v-if="playing[item.id]"
						:src="assetUrl(item.id)"
						controls
						autoplay
						preload="metadata"
						playsinline
						@click.stop
					/>
					<template v-else>
						<!-- Animated preview on hover -->
						<video
							v-if="hovered[item.id]"
							:src="previewUrl(item.id)"
							autoplay
							muted
							loop
							playsinline
							preload="auto"
						/>
						<!-- Static poster otherwise -->
						<img
							v-else
							:src="posterUrl(item.id)"
							:alt="item.title || item.filename_download"
							loading="lazy"
							@error="onPosterFail($event, item)"
						/>
						<button class="play-btn" @click.stop="playFull(item)" title="Play">
							<svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true">
								<polygon points="6,4 20,12 6,20" fill="currentColor" />
							</svg>
						</button>
						<span class="duration-chip" v-if="durations[item.id]">{{ durations[item.id] }}</span>
					</template>
				</div>
				<div v-else class="thumb">
					<img
						v-if="isImage(item)"
						:src="thumbUrl(item.id)"
						:alt="item.title || item.filename_download"
						@click="openFile(item)"
					/>
					<div v-else class="file-icon" @click="openFile(item)">
						<span>{{ extLabel(item) }}</span>
					</div>
				</div>
				<div class="meta" @click="openFile(item)">
					<div class="title" :title="item.title || item.filename_download">
						{{ item.title || item.filename_download }}
					</div>
					<div class="sub">
						<span>{{ item.type || '—' }}</span>
						<span>{{ formatBytes(item.filesize) }}</span>
					</div>
				</div>
			</div>
		</div>

		<div v-if="totalPages > 1" class="pagination">
			<button :disabled="page <= 1" @click="setPage(page - 1)">‹ Prev</button>
			<span>Page {{ page }} / {{ totalPages }}</span>
			<button :disabled="page >= totalPages" @click="setPage(page + 1)">Next ›</button>
			<select :value="limit" class="limit" @change="setLimit(Number(($event.target as HTMLSelectElement).value))">
				<option :value="25">25 per page</option>
				<option :value="50">50 per page</option>
				<option :value="100">100 per page</option>
				<option :value="200">200 per page</option>
			</select>
		</div>
	</div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import { useApi } from '@directus/extensions-sdk';
import { useRouter } from 'vue-router';

const props = defineProps<{
	collection?: string;
	layoutQuery?: any;
	filter?: any;
	search?: string;
}>();

const emit = defineEmits<{
	(e: 'update:layoutQuery', v: any): void;
}>();

const api = useApi();
const router = useRouter();

const items = ref<any[]>([]);
const total = ref(0);
const loading = ref(false);
const errorMsg = ref('');

const hovered = ref<Record<string, boolean>>({});
const playing = ref<Record<string, boolean>>({});
const posterMissing = ref<Record<string, boolean>>({});
const durations = ref<Record<string, string>>({});

let hoverTimer: number | null = null;
function onHover(item: any, isOver: boolean) {
	if (playing.value[item.id]) return;
	if (isOver) {
		if (hoverTimer) window.clearTimeout(hoverTimer);
		hoverTimer = window.setTimeout(() => {
			hovered.value = { ...hovered.value, [item.id]: true };
		}, 220);
	} else {
		if (hoverTimer) window.clearTimeout(hoverTimer);
		hovered.value = { ...hovered.value, [item.id]: false };
	}
}

function playFull(item: any) {
	playing.value = { ...playing.value, [item.id]: true };
	hovered.value = { ...hovered.value, [item.id]: false };
}

function onPosterFail(_e: Event, item: any) {
	posterMissing.value = { ...posterMissing.value, [item.id]: true };
}

const page = computed(() => props.layoutQuery?.page ?? 1);
const limit = computed(() => props.layoutQuery?.limit ?? 50);
const sort = computed(() => props.layoutQuery?.sort ?? ['-uploaded_on']);

function setPage(v: number) {
	emit('update:layoutQuery', { ...(props.layoutQuery ?? {}), page: v });
}
function setLimit(v: number) {
	emit('update:layoutQuery', { ...(props.layoutQuery ?? {}), limit: v, page: 1 });
}

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / Math.max(1, limit.value))));

const baseUrl = computed(() => {
	const m = window.location.pathname.match(/^(.*?)\/admin\b/);
	return m ? m[1] : '';
});

function assetUrl(id: string) {
	return `${baseUrl.value}/assets/${id}`;
}
function thumbUrl(id: string) {
	return `${baseUrl.value}/assets/${id}?key=system-medium-contain`;
}
function posterUrl(id: string) {
	return posterMissing.value[id]
		? `${baseUrl.value}/assets/${id}?key=system-medium-contain`
		: `${baseUrl.value}/video-thumb/${id}.jpg`;
}
function previewUrl(id: string) {
	return `${baseUrl.value}/video-thumb/${id}_preview.mp4`;
}
function fmtDuration(sec: number) {
	if (!Number.isFinite(sec) || sec <= 0) return '';
	const s = Math.floor(sec);
	const m = Math.floor(s / 60);
	const r = s % 60;
	return `${m}:${String(r).padStart(2, '0')}`;
}
function isVideo(item: any) {
	return typeof item?.type === 'string' && item.type.startsWith('video/');
}
function isImage(item: any) {
	return typeof item?.type === 'string' && item.type.startsWith('image/');
}
function extLabel(item: any) {
	const name = item?.filename_download || '';
	const idx = name.lastIndexOf('.');
	if (idx === -1) return '?';
	return name.slice(idx + 1).toUpperCase().slice(0, 5);
}
function formatBytes(b?: number) {
	if (!b || b < 0) return '';
	const units = ['B', 'KB', 'MB', 'GB', 'TB'];
	let i = 0;
	let v = b;
	while (v >= 1024 && i < units.length - 1) {
		v /= 1024;
		i++;
	}
	return `${v.toFixed(v >= 10 ? 0 : 1)} ${units[i]}`;
}

function openFile(item: any) {
	router.push(`/files/${item.id}`);
}

async function loadItems() {
	loading.value = true;
	errorMsg.value = '';
	try {
		const params: Record<string, any> = {
			fields: ['id', 'title', 'type', 'filesize', 'filename_download', 'filename_disk', 'uploaded_on', 'duration'],
			limit: limit.value,
			page: page.value,
			sort: (Array.isArray(sort.value) && sort.value.length ? sort.value : ['-uploaded_on']).join(','),
			meta: 'filter_count',
		};
		if (props.search) params.search = props.search;
		if (props.filter) params.filter = JSON.stringify(props.filter);

		const res = await api.get('/files', { params });
		items.value = res.data?.data ?? [];
		total.value = res.data?.meta?.filter_count ?? items.value.length;
		const map: Record<string, string> = {};
		for (const it of items.value) {
			if (it?.duration) {
				const seconds = typeof it.duration === 'number' ? it.duration / 1000 : Number(it.duration) / 1000;
				const label = fmtDuration(seconds);
				if (label) map[it.id] = label;
			}
		}
		durations.value = map;
	} catch (err: any) {
		errorMsg.value = err?.message || 'Failed to load files';
		items.value = [];
		total.value = 0;
	} finally {
		loading.value = false;
	}
}

watch(
	() => [props.filter, props.search, page.value, limit.value, sort.value],
	() => loadItems(),
	{ deep: true },
);
onMounted(() => loadItems());
</script>

<style scoped>
.video-cards-layout {
	padding: 16px 24px 32px;
}
.state {
	padding: 48px;
	text-align: center;
	color: var(--theme--foreground-subdued, #888);
}
.state.error {
	color: var(--theme--danger, #e35168);
}
.grid {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
	gap: 16px;
}
.card {
	display: flex;
	flex-direction: column;
	background: var(--theme--background-subdued, #1c1c1e);
	border: 1px solid var(--theme--border-color-subdued, #2a2a2e);
	border-radius: var(--theme--border-radius, 8px);
	overflow: hidden;
	transition: border-color 0.15s ease;
}
.card:hover {
	border-color: var(--theme--primary, #6644ff);
}
.thumb {
	position: relative;
	width: 100%;
	aspect-ratio: 16 / 10;
	background: #000;
	display: flex;
	align-items: center;
	justify-content: center;
	overflow: hidden;
}
.thumb video,
.thumb img {
	width: 100%;
	height: 100%;
	object-fit: contain;
	background: #000;
	display: block;
	transition: filter 0.2s ease;
}
.thumb img {
	cursor: pointer;
}
.video-thumb {
	cursor: pointer;
}
.video-thumb:hover img {
	filter: brightness(0.55);
}
.video-thumb.playing {
	cursor: default;
}
.play-btn {
	position: absolute;
	inset: 0;
	margin: auto;
	width: 56px;
	height: 56px;
	border-radius: 50%;
	border: none;
	background: rgba(0, 0, 0, 0.55);
	color: #fff;
	display: flex;
	align-items: center;
	justify-content: center;
	cursor: pointer;
	backdrop-filter: blur(2px);
	transition: transform 0.15s ease, background 0.15s ease;
}
.play-btn:hover {
	background: var(--theme--primary, #6644ff);
	transform: scale(1.06);
}
.play-btn svg {
	margin-left: 3px;
}
.duration-chip {
	position: absolute;
	bottom: 8px;
	right: 8px;
	background: rgba(0, 0, 0, 0.75);
	color: #fff;
	font-size: 11px;
	padding: 2px 6px;
	border-radius: 4px;
	font-variant-numeric: tabular-nums;
	pointer-events: none;
}
.file-icon {
	width: 100%;
	height: 100%;
	display: flex;
	align-items: center;
	justify-content: center;
	font-weight: 700;
	font-size: 22px;
	color: var(--theme--foreground-subdued, #aaa);
	cursor: pointer;
	background: linear-gradient(135deg, #2a2a2e 0%, #1a1a1e 100%);
}
.meta {
	padding: 10px 12px;
	cursor: pointer;
}
.title {
	font-weight: 600;
	font-size: 14px;
	color: var(--theme--foreground, #fff);
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
.sub {
	margin-top: 4px;
	display: flex;
	gap: 8px;
	font-size: 12px;
	color: var(--theme--foreground-subdued, #888);
}
.sub span {
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
.pagination {
	margin-top: 24px;
	display: flex;
	align-items: center;
	justify-content: center;
	gap: 12px;
	color: var(--theme--foreground-subdued, #aaa);
}
.pagination button {
	padding: 6px 14px;
	border-radius: 6px;
	border: 1px solid var(--theme--border-color-subdued, #2a2a2e);
	background: var(--theme--background-subdued, #1c1c1e);
	color: var(--theme--foreground, #fff);
	cursor: pointer;
}
.pagination button:disabled {
	opacity: 0.4;
	cursor: not-allowed;
}
.limit {
	margin-left: 12px;
	background: var(--theme--background-subdued, #1c1c1e);
	color: var(--theme--foreground, #fff);
	border: 1px solid var(--theme--border-color-subdued, #2a2a2e);
	border-radius: 6px;
	padding: 6px 8px;
}
</style>
