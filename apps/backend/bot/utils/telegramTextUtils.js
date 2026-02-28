'use strict';

const MAX_CONTENT_LENGTH = 5000;

/**
 * Convert Telegram MessageEntity-formatted text to plain text.
 * Strips formatting markers, appends bare URLs for text_link entities,
 * keeps hashtags and mentions as-is.
 */
function entitiesToPlainText(text, entities) {
  if (!text) return '';
  if (!entities || entities.length === 0) {
    return text.length > MAX_CONTENT_LENGTH
      ? text.slice(0, MAX_CONTENT_LENGTH - 3) + '...'
      : text;
  }

  // Collect URLs from text_link entities that aren't already visible in the text
  const appendUrls = [];
  for (const e of entities) {
    if (e.type === 'text_link' && e.url) {
      const linkText = text.slice(e.offset, e.offset + e.length);
      // Only append if the URL isn't already the link text
      if (linkText !== e.url) {
        appendUrls.push(e.url);
      }
    }
  }

  let result = text;
  if (appendUrls.length > 0) {
    result += '\n\n' + appendUrls.join('\n');
  }

  if (result.length > MAX_CONTENT_LENGTH) {
    result = result.slice(0, MAX_CONTENT_LENGTH - 3) + '...';
  }

  return result;
}

/**
 * Extract media info from a Telegram message object.
 * Returns { fileId, mediaType, mimetype } or null if no supported media.
 */
function extractMedia(msg) {
  if (!msg) return null;

  // Photo — take the largest size (last in array)
  if (msg.photo && msg.photo.length > 0) {
    return {
      fileId: msg.photo[msg.photo.length - 1].file_id,
      mediaType: 'image',
      mimetype: 'image/jpeg',
    };
  }

  // Video
  if (msg.video) {
    return {
      fileId: msg.video.file_id,
      mediaType: 'video',
      mimetype: msg.video.mime_type || 'video/mp4',
    };
  }

  // Animation (GIF) — treat as video
  if (msg.animation) {
    return {
      fileId: msg.animation.file_id,
      mediaType: 'video',
      mimetype: 'video/mp4',
    };
  }

  // Document with image mime type
  if (msg.document && msg.document.mime_type && msg.document.mime_type.startsWith('image/')) {
    return {
      fileId: msg.document.file_id,
      mediaType: 'image',
      mimetype: msg.document.mime_type,
    };
  }

  // Document with video mime type
  if (msg.document && msg.document.mime_type && msg.document.mime_type.startsWith('video/')) {
    return {
      fileId: msg.document.file_id,
      mediaType: 'video',
      mimetype: msg.document.mime_type,
    };
  }

  return null;
}

module.exports = { entitiesToPlainText, extractMedia };
