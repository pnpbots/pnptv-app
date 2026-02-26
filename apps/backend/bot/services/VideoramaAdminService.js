const axios = require('axios');
const path = require('path');
const fs = require('fs').promises;
const { v4: uuidv4 } = require('uuid');
const { Markup } = require('telegraf');
const logger = require('../../utils/logger');
const VideoMediaService = require('./videoMediaService');
const MediaPlayerModel = require('../../models/mediaPlayerModel');
const InvidiousService = require('./invidiousService'); // Assuming this service can handle YouTube/Vimeo links
const config = require('../../config/config');

class VideoramaAdminService {
  constructor(bot) {
    this.bot = bot;
    this.uploadSessions = new Map(); // Store active upload sessions: Map<userId, { step, data }>
    this.adminUploadChannelId = process.env.VIDEORAMA_ADMIN_UPLOAD_CHANNEL_ID;
  }

  /**
   * Initiates the media upload conversation for Videorama.
   * @param {Object} ctx - The Telegraf context object.
   */
  async startUpload(ctx) {
    const userId = ctx.from.id;
    const chatId = ctx.chat.id;

    if (chatId.toString() !== this.adminUploadChannelId) {
      await ctx.reply('This command can only be used in the designated Videorama admin upload channel.');
      return;
    }

    this.uploadSessions.set(userId, { step: 'select_type', data: {} });
    await ctx.reply(
      '🎬 Welcome to Videorama Media Upload! Please select the type of content you want to upload:',
      Markup.inlineKeyboard([
        [Markup.button.callback('📹 Video (File)', 'upload_videorama_type:video_file')],
        [Markup.button.callback('🎵 Music (File)', 'upload_videorama_type:music_file')],
        [Markup.button.callback('🔗 Video/Music (Link)', 'upload_videorama_type:link')],
        [Markup.button.callback('🎙️ Podcast (File)', 'upload_videorama_type:podcast_file')],
        [Markup.button.callback('❌ Cancel', 'upload_videorama_cancel')],
      ])
    );
  }

  /**
   * Handles messages during an active upload session.
   * @param {Object} ctx - The Telegraf context object.
   */
  async handleMessage(ctx) {
    const userId = ctx.from.id;
    const chatId = ctx.chat.id;
    const session = this.uploadSessions.get(userId);

    if (!session || chatId.toString() !== this.adminUploadChannelId) {
      return false; // Not an active session or not in the correct channel
    }

    try {
      switch (session.step) {
        case 'waiting_media_file':
          return this.handleMediaFileStep(ctx, session);
        case 'waiting_media_link':
          return this.handleMediaLinkStep(ctx, session);
        case 'waiting_title':
          return this.handleTitleStep(ctx, session);
        case 'waiting_artist':
          return this.handleArtistStep(ctx, session);
        case 'waiting_description':
          return this.handleDescriptionStep(ctx, session);
        case 'waiting_category_selection':
          return this.handleCategorySelection(ctx, session);
        case 'waiting_is_explicit':
          return this.handleIsExplicitStep(ctx, session);
        default:
          return false;
      }
    } catch (error) {
      logger.error('Error in Videorama upload session:', error);
      await ctx.reply('An error occurred during the upload process. Please try again or cancel.',
        Markup.inlineKeyboard([[Markup.button.callback('❌ Cancel', 'upload_videorama_cancel')]])
      );
      this.uploadSessions.delete(userId);
      return true;
    }
  }

  /**
   * Handles callback queries for the upload process.
   * @param {Object} ctx - The Telegraf context object.
   */
  async handleCallbackQuery(ctx) {
    const userId = ctx.from.id;
    const session = this.uploadSessions.get(userId);
    const [action, value] = ctx.match.input.split(':');

    if (!session) {
      await ctx.answerCbQuery('No active upload session found. Start a new one with /uploadvideorama.');
      return true;
    }

    try {
      await ctx.answerCbQuery(); // Dismiss loading animation

      switch (action) {
        case 'upload_videorama_type':
          return this.handleTypeSelection(ctx, session, value);
        case 'upload_videorama_category':
          return this.handleCategorySelection(ctx, session, value);
        case 'upload_videorama_is_explicit':
          return this.handleIsExplicitConfirmation(ctx, session, value === 'yes');
        case 'upload_videorama_cancel':
          await ctx.reply('Videorama media upload cancelled.');
          this.uploadSessions.delete(userId);
          return true;
        default:
          return false;
      }
    } catch (error) {
      logger.error('Error handling Videorama upload callback query:', error);
      await ctx.reply('An error occurred. Please try again or cancel.',
        Markup.inlineKeyboard([[Markup.button.callback('❌ Cancel', 'upload_videorama_cancel')]])
      );
      this.uploadSessions.delete(userId);
      return true;
    }
  }

  async handleTypeSelection(ctx, session, type) {
    session.data.type = type.replace('_file', ''); // e.g., 'video_file' -> 'video'
    session.data.is_file_upload = type.endsWith('_file');

    if (session.data.is_file_upload) {
      session.step = 'waiting_media_file';
      await ctx.editMessageText(`Please send the ${session.data.type} file you want to upload. Max size: 2GB.`);
    } else { // Link upload
      session.step = 'waiting_media_link';
      await ctx.editMessageText(`Please send the direct URL or YouTube/Vimeo link for the ${session.data.type || 'media'}.`);
    }
    return true;
  }

  async handleMediaFileStep(ctx, session) {
    const userId = ctx.from.id;
    let fileId, fileSize, mimeType;

    if (ctx.message.video) {
      fileId = ctx.message.video.file_id;
      fileSize = ctx.message.video.file_size;
      mimeType = ctx.message.video.mime_type;
      session.data.type = 'video'; // Ensure type is 'video' even if initially set to 'music' or 'podcast' for file-based videos
    } else if (ctx.message.audio) {
      fileId = ctx.message.audio.file_id;
      fileSize = ctx.message.audio.file_size;
      mimeType = ctx.message.audio.mime_type;
      session.data.type = 'music'; // Ensure type is 'music'
    } else if (ctx.message.document) {
      // Check if document is actually a video or audio
      if (ctx.message.document.mime_type.startsWith('video/')) {
        fileId = ctx.message.document.file_id;
        fileSize = ctx.message.document.file_size;
        mimeType = ctx.message.document.mime_type;
        session.data.type = 'video';
      } else if (ctx.message.document.mime_type.startsWith('audio/')) {
        fileId = ctx.message.document.file_id;
        fileSize = ctx.message.document.file_size;
        mimeType = ctx.message.document.mime_type;
        session.data.type = 'music';
      } else {
        await ctx.reply('Unsupported file type. Please send a video, audio, or a document that is an audio/video file.');
        return true;
      }
    } else {
      await ctx.reply('Please send a video or audio file.');
      return true;
    }

    if (!fileId) {
      await ctx.reply('Could not get file ID from the message.');
      return true;
    }

    if (fileSize > config.MAX_FILE_SIZE) { // Using a general MAX_FILE_SIZE, consider specific limits for videorama if needed
      await ctx.reply(`File is too large (${(fileSize / (1024 * 1024)).toFixed(2)} MB). Max allowed: ${(config.MAX_FILE_SIZE / (1024 * 1024)).toFixed(2)} MB.`);
      return true;
    }

    session.data.telegram_file_id = fileId;
    session.data.file_size_bytes = fileSize;
    session.data.mime_type = mimeType;
    session.step = 'waiting_title';
    await ctx.reply('Great! Now, what is the title of this media?');
    return true;
  }

  async handleMediaLinkStep(ctx, session) {
    const userId = ctx.from.id;
    const url = ctx.message.text;

    if (!url || !url.startsWith('http')) {
      await ctx.reply('Please provide a valid URL starting with "http".');
      return true;
    }

    session.data.url = url;

    // Try to fetch metadata for YouTube/Vimeo links
    if (url.includes('youtube.com') || url.includes('youtu.be') || url.includes('vimeo.com')) {
      try {
        await ctx.reply('Fetching metadata from link, please wait...');
        const videoId = this.extractVideoId(url); // Helper function to extract ID
        if (videoId) {
          const videoDetails = await InvidiousService.getVideoDetails(videoId);
          if (videoDetails) {
            session.data.title = videoDetails.title;
            session.data.artist = videoDetails.author;
            session.data.duration = videoDetails.lengthSeconds;
            session.data.coverUrl = videoDetails.videoThumbnails[videoDetails.videoThumbnails.length - 1]?.url; // Get highest quality thumbnail
            session.data.description = videoDetails.description;
            session.data.type = 'video'; // Assume video for YouTube/Vimeo
            await ctx.reply(`Found details: "${session.data.title}" by "${session.data.artist}".`);
          }
        }
      } catch (error) {
        logger.warn(`Could not fetch Invidious details for link: ${url}. Error: ${error.message}`);
        await ctx.reply('Could not automatically fetch media details from the link. You will need to provide them manually.');
      }
    }

    session.step = 'waiting_title';
    await ctx.reply('Great! Now, what is the title of this media? (You can skip if already pre-filled)');
    return true;
  }

  async handleTitleStep(ctx, session) {
    const userId = ctx.from.id;
    const title = ctx.message.text;
    session.data.title = title;
    session.step = 'waiting_artist';
    await ctx.reply('Who is the artist/uploader of this media?');
    return true;
  }

  async handleArtistStep(ctx, session) {
    const userId = ctx.from.id;
    const artist = ctx.message.text;
    session.data.artist = artist;
    session.step = 'waiting_description';
    await ctx.reply('Please provide a brief description for the media.');
    return true;
  }

  async handleDescriptionStep(ctx, session) {
    const userId = ctx.from.id;
    const description = ctx.message.text;
    session.data.description = description;

    // Suggest categories
    const categories = await MediaPlayerModel.getCategories();
    session.step = 'waiting_category_selection';

    // Create rows of 2 buttons each for better layout
    const rows = [];
    for (let i = 0; i < categories.length; i += 2) {
      const row = [Markup.button.callback(categories[i], `upload_videorama_category:${categories[i]}`)];
      if (categories[i + 1]) {
        row.push(Markup.button.callback(categories[i + 1], `upload_videorama_category:${categories[i + 1]}`));
      }
      rows.push(row);
    }
    rows.push([Markup.button.callback('❌ Cancel', 'upload_videorama_cancel')]);

    await ctx.reply(
      'Choose a category for this media:',
      Markup.inlineKeyboard(rows)
    );
    return true;
  }

  async handleCategorySelection(ctx, session, category) {
    session.data.category = category;
    session.step = 'waiting_is_explicit';
    await ctx.reply(
      `Is this media explicit content?`,
      Markup.inlineKeyboard([
        [
          Markup.button.callback('✅ Yes', 'upload_videorama_is_explicit:yes'),
          Markup.button.callback('❌ No', 'upload_videorama_is_explicit:no'),
        ]
      ])
    );
    return true;
  }

  async handleIsExplicitConfirmation(ctx, session, isExplicit) {
    session.data.is_explicit = isExplicit;
    await this.finalizeUpload(ctx, session);
    return true;
  }

  /**
   * Finalizes the upload process and saves the media to the database.
   * @param {Object} ctx - The Telegraf context object.
   * @param {Object} session - The current upload session data.
   */
  async finalizeUpload(ctx, session) {
    const userId = ctx.from.id;
    const { type, is_file_upload, url, telegram_file_id, file_size_bytes, mime_type, title, artist, description, category, is_explicit } = session.data;
    let finalMediaUrl = url;

    try {
      await ctx.reply('Processing your media, please wait...');

      if (is_file_upload && telegram_file_id) {
        const fileLink = await this.bot.telegram.getFileLink(telegram_file_id);
        const downloadUrl = fileLink.href;
        const tempFilePath = path.join(config.UPLOAD_DIR, `${uuidv4()}_${telegram_file_id}`);

        // Download the file
        const response = await axios({
          method: 'get',
          url: downloadUrl,
          responseType: 'stream',
        });
        await fs.mkdir(config.UPLOAD_DIR, { recursive: true });
        const writer = fs.createWriteStream(tempFilePath);
        response.data.pipe(writer);

        await new Promise((resolve, reject) => {
          writer.on('finish', resolve);
          writer.on('error', reject);
        });

        logger.info(`Downloaded Telegram file to ${tempFilePath}`);

        // Upload to S3 if it's a video or large audio, otherwise use temp path directly
        if (type === 'video' || file_size_bytes > (10 * 1024 * 1024)) { // > 10MB to S3
          const s3UploadResult = await VideoMediaService.uploadVideoToS3(tempFilePath, path.basename(tempFilePath), file_size_bytes);
          finalMediaUrl = s3UploadResult.url;
        } else {
          // For smaller audio, we might consider keeping it on local storage or handling differently
          // For now, let's assume all videorama content should be accessible via URL
          // If not S3, the temporary file needs to be served. This is a simplification.
          // For production, this path needs to be a public URL, or the file needs to be moved to a permanent web-accessible location.
          finalMediaUrl = tempFilePath; // Placeholder: this needs to be a publicly accessible URL
        }

        await fs.unlink(tempFilePath); // Clean up temporary file

      } else if (!url) {
        await ctx.reply('Error: Media URL is missing for link upload.');
        this.uploadSessions.delete(userId);
        return;
      }

      // Create MediaPlayer record
      const mediaData = {
        title,
        artist: artist || 'Unknown',
        url: finalMediaUrl,
        type: type, // 'video', 'music', 'podcast'
        duration: session.data.duration || 0, // Invidious would provide this
        coverUrl: session.data.coverUrl || null,
        description: description || null,
        category: category || 'general',
        uploaderId: userId.toString(),
        uploaderName: ctx.from.username || ctx.from.first_name,
        isPublic: true, // All videorama uploads are public by default
        isExplicit: is_explicit,
        metadata: {
          telegram_file_id: telegram_file_id || null,
          mime_type: mime_type || null,
          source_url: url || null, // Original link for link uploads
        },
      };

      const newMedia = await MediaPlayerModel.createMedia(mediaData);

      if (newMedia) {
        await ctx.reply(`✅ Successfully uploaded "${newMedia.title}" to Videorama!`);
      } else {
        await ctx.reply('❌ Failed to create media record in the database.');
      }
    } catch (error) {
      logger.error('Failed to finalize Videorama upload:', error);
      await ctx.reply(`❌ An unexpected error occurred during finalization: ${error.message}`);
    } finally {
      this.uploadSessions.delete(userId);
    }
  }

  // Helper to extract video ID from YouTube/Vimeo URLs
  extractVideoId(url) {
    let videoId = null;
    let match = url.match(/(?:youtube\.com\/(?:[^\/\n\s]+\/\S+\/|(?:v|e(?:mbed)?)\/|\S*?[?&]v=)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
    if (match) {
      videoId = match[1];
    } else {
      match = url.match(/(?:vimeo\.com\/(?:.*?\/)?|player\.vimeo\.com\/video\/)([0-9]+)/);
      if (match) {
        videoId = match[1];
      }
    }
    return videoId;
  }
}

module.exports = VideoramaAdminService;
