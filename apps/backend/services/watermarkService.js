'use strict';

const sharp = require('sharp');
const { execFile } = require('child_process');
const { promisify } = require('util');
const logger = require('../utils/logger');

const execFileAsync = promisify(execFile);
const ffmpegBin = (() => {
  try { return require('ffmpeg-static') || 'ffmpeg'; } catch { return 'ffmpeg'; }
})();

function xmlEscape(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

// Strip chars that would require complex escaping in ffmpeg drawtext filter
function safeDrawtextLabel(username) {
  return '@' + String(username).replace(/[^a-zA-Z0-9_.\-]/g, '');
}

/**
 * Composite a semi-transparent pill watermark (@username) on the bottom-right
 * of an image buffer. Returns the original buffer on any failure (non-fatal).
 *
 * @param {Buffer} inputBuffer - Input image (any format sharp understands)
 * @param {string} username
 * @returns {Promise<Buffer>}
 */
async function applyImageWatermark(inputBuffer, username) {
  const label = '@' + xmlEscape(username);
  const fontSize = 22;
  const pad = 12;
  // Approximate pill dimensions (sans-serif chars ~0.6× font-size wide)
  const pillW = Math.ceil((username.length + 1) * fontSize * 0.6) + pad * 2;
  const pillH = fontSize + pad;
  const rx = pillH / 2;

  const svg = `<svg width="${pillW}" height="${pillH}" xmlns="http://www.w3.org/2000/svg">
    <rect x="0" y="0" width="${pillW}" height="${pillH}" rx="${rx}" ry="${rx}" fill="rgba(0,0,0,0.55)"/>
    <text x="${pillW / 2}" y="${fontSize}" font-family="sans-serif" font-size="${fontSize}px" font-weight="bold" fill="rgba(255,255,255,0.90)" text-anchor="middle">${label}</text>
  </svg>`;

  try {
    const meta = await sharp(inputBuffer, { failOn: 'none' }).metadata();
    const w = meta.width || 800;
    const h = meta.height || 600;
    if (pillW >= w || pillH >= h) return inputBuffer;

    const margin = 12;
    return await sharp(inputBuffer, { failOn: 'none' })
      .composite([{
        input: Buffer.from(svg),
        top: Math.max(0, h - pillH - margin),
        left: Math.max(0, w - pillW - margin),
        blend: 'over',
      }])
      .toBuffer();
  } catch (err) {
    logger.warn('watermarkService.applyImageWatermark: failed, using original', { username, error: err.message });
    return inputBuffer;
  }
}

/**
 * Burn a drawtext watermark into a video file using ffmpeg.
 * Throws on failure — callers should catch and fall back to the original.
 *
 * @param {string} inputPath  - Source video path
 * @param {string} outputPath - Destination path for watermarked video
 * @param {string} username
 * @returns {Promise<void>}
 */
async function applyVideoWatermark(inputPath, outputPath, username) {
  const label = safeDrawtextLabel(username);
  const filter = `drawtext=text='${label}':fontsize=26:fontcolor=white@0.90:x=w-tw-14:y=h-th-14:box=1:boxcolor=black@0.50:boxborderw=8`;

  await execFileAsync(ffmpegBin, [
    '-y', '-i', inputPath,
    '-vf', filter,
    '-codec:a', 'copy',
    '-crf', '23',
    '-preset', 'fast',
    outputPath,
  ], { timeout: 10 * 60 * 1000 });
}

module.exports = { applyImageWatermark, applyVideoWatermark };
