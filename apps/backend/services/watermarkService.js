'use strict';

const path = require('path');
const sharp = require('sharp');
const { execFile } = require('child_process');
const { promisify } = require('util');
const logger = require('../utils/logger');

const execFileAsync = promisify(execFile);
const ffmpegBin = (() => {
  try {
    const p = require('ffmpeg-static');
    if (p && require('fs').existsSync(p)) return p;
  } catch { /* ignore */ }
  return 'ffmpeg'; // use system ffmpeg (/usr/bin/ffmpeg)
})();

const LOGO_PATH = path.join(__dirname, '../../../public/Logo2-50.png');
// Target logo height for image compositing (px). Width auto-calculated from 793:182 ratio.
const LOGO_H = 22;
const LOGO_W = Math.round(793 / 182 * LOGO_H); // ≈ 96

function xmlEscape(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

// Strip chars that would break ffmpeg drawtext filter
function safeDrawtextLabel(username) {
  return '@' + String(username).replace(/[^a-zA-Z0-9_.\-]/g, '');
}

/**
 * Composite PNPtv logo (bottom-left) + @username pill (bottom-right) on an image buffer.
 * Returns the original buffer on any failure (non-fatal).
 */
async function applyImageWatermark(inputBuffer, username) {
  try {
    const meta = await sharp(inputBuffer, { failOn: 'none' }).metadata();
    const w = meta.width || 800;
    const h = meta.height || 600;
    const margin = 12;

    // Scale logo proportionally, cap at 18% of image width
    const maxLogoW = Math.floor(w * 0.18);
    const logoW = Math.min(LOGO_W, maxLogoW);
    const logoH = Math.round(logoW * 182 / 793);

    // Resize logo to target size and set 60% opacity via raw alpha channel manipulation
    const logoResized = await sharp(LOGO_PATH)
      .resize(logoW, logoH, { fit: 'fill' })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    // Apply 60% opacity: multiply alpha channel by 0.60
    const { data, info } = logoResized;
    const opacityData = Buffer.from(data);
    for (let i = 3; i < opacityData.length; i += 4) {
      opacityData[i] = Math.round(opacityData[i] * 0.60);
    }
    const logoBuffer = await sharp(opacityData, {
      raw: { width: info.width, height: info.height, channels: 4 },
    }).png().toBuffer();

    // Username pill (bottom-right)
    const label = '@' + xmlEscape(username);
    const fontSize = Math.max(11, Math.round(h * 0.022));
    const pad = 6;
    const pillW = Math.ceil((username.length + 1) * fontSize * 0.6) + pad * 2;
    const pillH = fontSize + pad;
    const rx = pillH / 2;
    const pillSvg = `<svg width="${pillW}" height="${pillH}" xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="${pillW}" height="${pillH}" rx="${rx}" ry="${rx}" fill="rgba(0,0,0,0.60)"/>
      <text x="${pillW / 2}" y="${fontSize}" font-family="sans-serif" font-size="${fontSize}px" font-weight="bold" fill="rgba(255,255,255,0.92)" text-anchor="middle">${label}</text>
    </svg>`;

    const composites = [];

    // Logo: bottom-left
    if (logoW < w && logoH < h) {
      composites.push({
        input: logoBuffer,
        raw: undefined, // already a PNG buffer
        top: Math.max(0, h - logoH - margin),
        left: margin,
        blend: 'over',
      });
    }

    // Username pill: bottom-right
    if (pillW < w && pillH < h) {
      composites.push({
        input: Buffer.from(pillSvg),
        top: Math.max(0, h - pillH - margin),
        left: Math.max(0, w - pillW - margin),
        blend: 'over',
      });
    }

    if (composites.length === 0) return inputBuffer;

    return await sharp(inputBuffer, { failOn: 'none' })
      .composite(composites)
      .toBuffer();
  } catch (err) {
    logger.warn('watermarkService.applyImageWatermark: failed, using original', { username, error: err.message });
    return inputBuffer;
  }
}

/**
 * Burn PNPtv logo (bottom-left) + @username drawtext (bottom-right) into a video.
 * Throws on failure — callers should catch and fall back to the original file.
 */
async function applyVideoWatermark(inputPath, outputPath, username) {
  const label = safeDrawtextLabel(username);

  // logo overlay: scale to ~5% of video height, placed bottom-left with 10px margin
  // drawtext: bottom-right with 10px margin
  const vf = [
    // Input 1 (logo) → scale to height=5% of video height, preserve alpha, 60% opacity
    `[1:v]scale=-1:ih*0.05,format=rgba,colorchannelmixer=aa=0.60[logo]`,
    // Overlay logo at bottom-left
    `[0:v][logo]overlay=x=10:y=H-h-10[withlogo]`,
    // Drawtext username at bottom-right
    `[withlogo]drawtext=text='${label}':fontsize=h*0.022:fontcolor=white@0.85:x=w-tw-10:y=h-th-10:box=1:boxcolor=black@0.50:boxborderw=5`,
  ].join(',');

  await execFileAsync(ffmpegBin, [
    '-y',
    '-i', inputPath,
    '-i', LOGO_PATH,
    '-filter_complex', vf,
    '-codec:a', 'copy',
    '-crf', '23',
    '-preset', 'fast',
    outputPath,
  ], { timeout: 10 * 60 * 1000 });
}

module.exports = { applyImageWatermark, applyVideoWatermark };
