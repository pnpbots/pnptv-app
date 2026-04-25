import { defineEndpoint } from '@directus/extensions-sdk';
import { createReadStream, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const THUMBS_DIR = process.env.VIDEO_THUMBS_DIR || '/directus/uploads/_thumbs';

export default defineEndpoint({
	id: 'video-thumb',
	handler: (router) => {
		router.get('/:file', (req: any, res: any) => {
			const file: string = String(req.params.file || '');
			const m = file.match(/^([0-9a-f-]{36})(_preview)?\.(jpg|mp4)$/i);
			if (!m) return res.status(400).send('bad request');

			const id = m[1];
			const isPreview = !!m[2];
			const ext = m[3].toLowerCase();
			if (!UUID_RE.test(id)) return res.status(400).send('bad id');
			if (isPreview && ext !== 'mp4') return res.status(400).send('bad combo');
			if (!isPreview && ext !== 'jpg') return res.status(400).send('bad combo');

			const filename = isPreview ? `${id}_preview.mp4` : `${id}.jpg`;
			const filepath = join(THUMBS_DIR, filename);
			if (!existsSync(filepath)) return res.status(404).send('not generated yet');

			const stat = statSync(filepath);
			res.setHeader('Content-Type', ext === 'jpg' ? 'image/jpeg' : 'video/mp4');
			res.setHeader('Cache-Control', 'public, max-age=2592000, immutable');
			res.setHeader('Accept-Ranges', 'bytes');
			res.setHeader('Last-Modified', stat.mtime.toUTCString());

			const range = req.headers.range as string | undefined;
			if (range && ext === 'mp4') {
				const parts = range.replace(/bytes=/, '').split('-');
				const start = parseInt(parts[0] || '0', 10);
				const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
				if (Number.isNaN(start) || Number.isNaN(end) || start > end || end >= stat.size) {
					res.setHeader('Content-Range', `bytes */${stat.size}`);
					return res.status(416).end();
				}
				res.status(206);
				res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`);
				res.setHeader('Content-Length', String(end - start + 1));
				createReadStream(filepath, { start, end }).pipe(res);
			} else {
				res.setHeader('Content-Length', String(stat.size));
				createReadStream(filepath).pipe(res);
			}
		});
	},
});
