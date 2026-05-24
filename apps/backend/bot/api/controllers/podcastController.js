const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');
const multer = require('multer');
const FileType = require('../../utils/fileType');

const UPLOAD_DIR = path.join(__dirname, '../../../../public/uploads/podcasts');

function ensureUploadDir() {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const ALLOWED_AUDIO_EXTENSIONS = new Set(['.mp3', '.ogg', '.wav', '.aac', '.m4a', '.flac', '.opus', '.webm']);

function safeBasename(name) {
  const base = path.basename(name || 'audio');
  return base.replace(/[^\w.\-]+/g, '_');
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    try {
      ensureUploadDir();
      cb(null, UPLOAD_DIR);
    } catch (e) {
      cb(e);
    }
  },
  filename: (req, file, cb) => {
    const rawExt = path.extname(file.originalname || '').toLowerCase();
    const ext = ALLOWED_AUDIO_EXTENSIONS.has(rawExt) ? rawExt : '.mp3';
    const base = safeBasename(path.basename(file.originalname || 'audio', path.extname(file.originalname || '')));
    const stamp = Date.now();
    cb(null, `${stamp}-${base}${ext}`);
  },
});

function fileFilter(req, file, cb) {
  const ok = typeof file.mimetype === 'string' && file.mimetype.startsWith('audio/');
  cb(ok ? null : new Error('Only audio uploads are allowed'), ok);
}

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB
    files: 1,
  },
});

async function uploadAudio(req, res) {
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'No file received' });
  }

  const headerBuf = Buffer.alloc(4100);
  const fd = await fsPromises.open(req.file.path, 'r');
  await fd.read(headerBuf, 0, 4100, 0);
  await fd.close();
  const detected = await FileType.fromBuffer(headerBuf);
  const ALLOWED_AUDIO = new Set(['audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/aac', 'audio/mp4', 'audio/x-m4a', 'audio/flac']);
  if (!detected || !ALLOWED_AUDIO.has(detected.mime)) {
    await fsPromises.unlink(req.file.path).catch(() => {});
    return res.status(400).json({ success: false, message: 'Only audio files are allowed.' });
  }

  const publicUrl = `/uploads/podcasts/${encodeURIComponent(req.file.filename)}`;
  return res.json({
    success: true,
    file: {
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      size: req.file.size,
      url: publicUrl,
    },
  });
}

module.exports = {
  upload,
  uploadAudio,
};

