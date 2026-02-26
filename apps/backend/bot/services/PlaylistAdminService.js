const { Markup } = require('telegraf');
const logger = require('../../utils/logger');
const MediaPlayerModel = require('../../models/mediaPlayerModel');
const InvidiousService = require('./invidiousService');
const { getPool } = require('../../config/postgres');
const { cache } = require('../../config/redis');

/**
 * PlaylistAdminService - Simple playlist creation from YouTube links and uploaded videos
 * Supports importing YouTube playlists and creating playlists from individual media
 */
class PlaylistAdminService {
  constructor(bot) {
    this.bot = bot;
    this.playlistSessions = new Map(); // Active playlist creation sessions
    this.adminChannelId = process.env.VIDEORAMA_ADMIN_UPLOAD_CHANNEL_ID;
  }

  /**
   * Start a new playlist creation session
   */
  async startPlaylistCreation(ctx) {
    const userId = ctx.from.id;
    const chatId = ctx.chat.id;

    if (this.adminChannelId && chatId.toString() !== this.adminChannelId) {
      await ctx.reply('This command can only be used in the designated admin channel.');
      return;
    }

    this.playlistSessions.set(userId, {
      step: 'select_type',
      data: {
        items: [],
        name: '',
        description: '',
        isPublic: true,
        category: 'music',
      }
    });

    await ctx.reply(
      '🎵 *Create Playlist*\n\nChoose how you want to create your playlist:',
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('📝 From YouTube Links', 'playlist_create:youtube_links')],
          [Markup.button.callback('📺 Import YouTube Playlist', 'playlist_create:youtube_playlist')],
          [Markup.button.callback('🎬 From Existing Media', 'playlist_create:existing_media')],
          [Markup.button.callback('❌ Cancel', 'playlist_cancel')],
        ])
      }
    );
  }

  /**
   * Handle callback queries for playlist creation
   */
  async handleCallbackQuery(ctx) {
    const userId = ctx.from.id;
    const session = this.playlistSessions.get(userId);
    const callbackData = ctx.callbackQuery?.data || ctx.match?.input || '';

    if (callbackData === 'playlist_cancel') {
      await ctx.answerCbQuery('Playlist creation cancelled');
      this.playlistSessions.delete(userId);
      await ctx.editMessageText('Playlist creation cancelled.');
      return true;
    }

    if (!session && !callbackData.startsWith('playlist_create:')) {
      await ctx.answerCbQuery('No active playlist session. Start with /createplaylist');
      return true;
    }

    try {
      await ctx.answerCbQuery();

      const [action, value] = callbackData.split(':');

      switch (action) {
        case 'playlist_create':
          return this.handleTypeSelection(ctx, session || this.playlistSessions.get(userId), value);
        case 'playlist_category':
          return this.handleCategorySelection(ctx, session, value);
        case 'playlist_visibility':
          return this.handleVisibilitySelection(ctx, session, value === 'public');
        case 'playlist_add_more':
          return this.handleAddMore(ctx, session);
        case 'playlist_done':
          return this.handleDoneAdding(ctx, session);
        case 'playlist_confirm':
          return this.finalizePlaylist(ctx, session);
        case 'playlist_select_media':
          return this.handleMediaSelection(ctx, session, value);
        default:
          return false;
      }
    } catch (error) {
      logger.error('Error in playlist callback:', error);
      await ctx.reply('An error occurred. Please try again.');
      return true;
    }
  }

  /**
   * Handle playlist type selection
   */
  async handleTypeSelection(ctx, session, type) {
    const userId = ctx.from.id;

    if (!session) {
      session = {
        step: 'select_type',
        data: { items: [], name: '', description: '', isPublic: true, category: 'music' }
      };
      this.playlistSessions.set(userId, session);
    }

    session.data.creationType = type;

    if (type === 'youtube_links') {
      session.step = 'waiting_youtube_links';
      await ctx.editMessageText(
        '🔗 *Add YouTube Links*\n\n' +
        'Send me YouTube video URLs (one per line or separated by spaces).\n\n' +
        'Example:\n' +
        '`https://youtube.com/watch?v=abc123`\n' +
        '`https://youtu.be/xyz789`\n\n' +
        'I will automatically fetch the video details.',
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('❌ Cancel', 'playlist_cancel')]
          ])
        }
      );
    } else if (type === 'youtube_playlist') {
      session.step = 'waiting_playlist_url';
      await ctx.editMessageText(
        '📺 *Import YouTube Playlist*\n\n' +
        'Send me a YouTube playlist URL:\n\n' +
        'Example:\n' +
        '`https://youtube.com/playlist?list=PLxxxxxx`',
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('❌ Cancel', 'playlist_cancel')]
          ])
        }
      );
    } else if (type === 'existing_media') {
      session.step = 'selecting_existing_media';
      await this.showExistingMedia(ctx, session);
    }

    return true;
  }

  /**
   * Handle incoming messages during playlist creation
   */
  async handleMessage(ctx) {
    const userId = ctx.from.id;
    const session = this.playlistSessions.get(userId);

    if (!session) return false;

    const text = ctx.message?.text;
    if (!text) return false;

    try {
      switch (session.step) {
        case 'waiting_youtube_links':
          return this.handleYouTubeLinks(ctx, session, text);
        case 'waiting_playlist_url':
          return this.handlePlaylistUrl(ctx, session, text);
        case 'waiting_name':
          return this.handlePlaylistName(ctx, session, text);
        case 'waiting_description':
          return this.handlePlaylistDescription(ctx, session, text);
        default:
          return false;
      }
    } catch (error) {
      logger.error('Error handling playlist message:', error);
      await ctx.reply('An error occurred. Please try again.');
      return true;
    }
  }

  /**
   * Handle YouTube links input
   */
  async handleYouTubeLinks(ctx, session, text) {
    const userId = ctx.from.id;
    const urls = this.extractYouTubeUrls(text);

    if (urls.length === 0) {
      await ctx.reply('No valid YouTube URLs found. Please send valid YouTube video URLs.');
      return true;
    }

    await ctx.reply(`Found ${urls.length} YouTube URL(s). Fetching details...`);

    const fetchedItems = [];
    for (const url of urls) {
      try {
        const videoId = this.extractVideoId(url);
        if (videoId) {
          const details = await InvidiousService.getVideoDetails(videoId);
          if (details) {
            fetchedItems.push({
              title: details.title,
              artist: details.author,
              duration: details.lengthSeconds,
              url: url,
              coverUrl: details.videoThumbnails?.[details.videoThumbnails.length - 1]?.url,
              type: 'video',
              source: 'youtube',
              videoId: videoId,
            });
          }
        }
      } catch (error) {
        logger.warn(`Failed to fetch details for ${url}:`, error.message);
      }
    }

    if (fetchedItems.length === 0) {
      await ctx.reply('Could not fetch details for any of the provided URLs. Please try different URLs.');
      return true;
    }

    session.data.items.push(...fetchedItems);

    const itemsList = session.data.items.map((item, i) =>
      `${i + 1}. ${item.title} - ${item.artist || 'Unknown'}`
    ).join('\n');

    await ctx.reply(
      `✅ Added ${fetchedItems.length} item(s) to playlist!\n\n` +
      `*Current items (${session.data.items.length}):*\n${itemsList}`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('➕ Add More Links', 'playlist_add_more')],
          [Markup.button.callback('✅ Done Adding', 'playlist_done')],
          [Markup.button.callback('❌ Cancel', 'playlist_cancel')],
        ])
      }
    );

    return true;
  }

  /**
   * Handle YouTube playlist URL
   */
  async handlePlaylistUrl(ctx, session, text) {
    const playlistId = this.extractPlaylistId(text);

    if (!playlistId) {
      await ctx.reply('Invalid YouTube playlist URL. Please send a valid playlist URL.');
      return true;
    }

    await ctx.reply('Fetching playlist details...');

    try {
      const playlistInfo = await InvidiousService.getPlaylistInfo(playlistId);

      if (!playlistInfo || !playlistInfo.videos || playlistInfo.videos.length === 0) {
        await ctx.reply('Could not fetch playlist or playlist is empty.');
        return true;
      }

      // Import videos from playlist
      const items = playlistInfo.videos.slice(0, 50).map(video => ({
        title: video.title,
        artist: video.author,
        duration: video.lengthSeconds,
        url: `https://youtube.com/watch?v=${video.videoId}`,
        coverUrl: video.videoThumbnails?.[video.videoThumbnails.length - 1]?.url,
        type: 'video',
        source: 'youtube',
        videoId: video.videoId,
      }));

      session.data.items = items;
      session.data.name = playlistInfo.title || 'Imported Playlist';
      session.data.description = playlistInfo.description || '';

      await ctx.reply(
        `✅ Imported ${items.length} videos from "${playlistInfo.title}"\n\n` +
        `First 5 items:\n` +
        items.slice(0, 5).map((item, i) => `${i + 1}. ${item.title}`).join('\n') +
        (items.length > 5 ? `\n... and ${items.length - 5} more` : ''),
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('✅ Continue', 'playlist_done')],
            [Markup.button.callback('❌ Cancel', 'playlist_cancel')],
          ])
        }
      );
    } catch (error) {
      logger.error('Error fetching playlist:', error);
      await ctx.reply('Failed to fetch playlist. Please try again.');
    }

    return true;
  }

  /**
   * Show existing media for selection
   */
  async showExistingMedia(ctx, session) {
    try {
      const media = await MediaPlayerModel.getMediaLibrary('all', 20);

      if (media.length === 0) {
        await ctx.editMessageText(
          'No media found in the library. Upload some media first with /uploadvideorama',
          Markup.inlineKeyboard([[Markup.button.callback('❌ Cancel', 'playlist_cancel')]])
        );
        return;
      }

      const rows = media.slice(0, 8).map(item => [
        Markup.button.callback(
          `${item.type === 'video' ? '📹' : '🎵'} ${item.title.substring(0, 30)}`,
          `playlist_select_media:${item.id}`
        )
      ]);

      rows.push([Markup.button.callback('✅ Done Selecting', 'playlist_done')]);
      rows.push([Markup.button.callback('❌ Cancel', 'playlist_cancel')]);

      await ctx.editMessageText(
        `*Select Media for Playlist*\n\n` +
        `Selected: ${session.data.items.length} items\n\n` +
        `Tap items to add them:`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard(rows)
        }
      );
    } catch (error) {
      logger.error('Error showing existing media:', error);
      await ctx.reply('Failed to load media library.');
    }
  }

  /**
   * Handle media selection from existing library
   */
  async handleMediaSelection(ctx, session, mediaId) {
    try {
      const media = await MediaPlayerModel.getMediaById(mediaId);
      if (media) {
        // Check if already added
        const alreadyAdded = session.data.items.some(item => item.id === mediaId);
        if (!alreadyAdded) {
          session.data.items.push({
            id: media.id,
            title: media.title,
            artist: media.artist,
            duration: media.duration,
            url: media.url,
            coverUrl: media.cover_url,
            type: media.type,
            source: 'library',
          });
          await ctx.answerCbQuery(`Added: ${media.title}`);
        } else {
          await ctx.answerCbQuery('Already added to playlist');
        }
      }

      await this.showExistingMedia(ctx, session);
    } catch (error) {
      logger.error('Error selecting media:', error);
    }

    return true;
  }

  /**
   * Handle "Add More" button
   */
  async handleAddMore(ctx, session) {
    session.step = 'waiting_youtube_links';
    await ctx.editMessageText(
      '🔗 Send more YouTube URLs to add to the playlist:',
      Markup.inlineKeyboard([[Markup.button.callback('❌ Cancel', 'playlist_cancel')]])
    );
    return true;
  }

  /**
   * Handle "Done Adding" button - move to naming step
   */
  async handleDoneAdding(ctx, session) {
    if (session.data.items.length === 0) {
      await ctx.answerCbQuery('Please add at least one item first');
      return true;
    }

    session.step = 'waiting_name';

    const suggestedName = session.data.name || `Playlist ${new Date().toLocaleDateString()}`;

    await ctx.editMessageText(
      `*Name Your Playlist*\n\n` +
      `Items: ${session.data.items.length}\n\n` +
      `Send the name for your playlist (or type "skip" to use: "${suggestedName}"):`,
      { parse_mode: 'Markdown' }
    );

    return true;
  }

  /**
   * Handle playlist name input
   */
  async handlePlaylistName(ctx, session, text) {
    session.data.name = text.toLowerCase() === 'skip'
      ? (session.data.name || `Playlist ${new Date().toLocaleDateString()}`)
      : text.trim();

    session.step = 'waiting_description';

    await ctx.reply(
      `*Playlist Description*\n\n` +
      `Add a description for "${session.data.name}" (or type "skip"):`,
      { parse_mode: 'Markdown' }
    );

    return true;
  }

  /**
   * Handle playlist description input
   */
  async handlePlaylistDescription(ctx, session, text) {
    session.data.description = text.toLowerCase() === 'skip' ? '' : text.trim();

    // Move to category selection
    const categories = ['music', 'videos', 'podcasts', 'documentaries', 'comedy', 'mixed'];

    await ctx.reply(
      '*Select Category:*',
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          categories.slice(0, 3).map(cat => Markup.button.callback(cat, `playlist_category:${cat}`)),
          categories.slice(3).map(cat => Markup.button.callback(cat, `playlist_category:${cat}`)),
        ])
      }
    );

    return true;
  }

  /**
   * Handle category selection
   */
  async handleCategorySelection(ctx, session, category) {
    session.data.category = category;

    await ctx.editMessageText(
      '*Playlist Visibility:*',
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('🌐 Public', 'playlist_visibility:public')],
          [Markup.button.callback('🔒 Private', 'playlist_visibility:private')],
        ])
      }
    );

    return true;
  }

  /**
   * Handle visibility selection
   */
  async handleVisibilitySelection(ctx, session, isPublic) {
    session.data.isPublic = isPublic;

    // Show confirmation
    const itemsList = session.data.items.slice(0, 5).map((item, i) =>
      `${i + 1}. ${item.title}`
    ).join('\n');

    await ctx.editMessageText(
      `*Confirm Playlist Creation*\n\n` +
      `📝 Name: ${session.data.name}\n` +
      `📁 Category: ${session.data.category}\n` +
      `👁 Visibility: ${isPublic ? 'Public' : 'Private'}\n` +
      `🎵 Items: ${session.data.items.length}\n\n` +
      `First items:\n${itemsList}` +
      (session.data.items.length > 5 ? `\n... and ${session.data.items.length - 5} more` : ''),
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('✅ Create Playlist', 'playlist_confirm')],
          [Markup.button.callback('❌ Cancel', 'playlist_cancel')],
        ])
      }
    );

    return true;
  }

  /**
   * Finalize and create the playlist
   */
  async finalizePlaylist(ctx, session) {
    const userId = ctx.from.id;

    try {
      await ctx.editMessageText('Creating playlist...');

      // Create the playlist
      const playlist = await MediaPlayerModel.createPlaylist(userId, {
        name: session.data.name,
        description: session.data.description,
        isPublic: session.data.isPublic,
        coverUrl: session.data.items[0]?.coverUrl || null,
      });

      if (!playlist) {
        throw new Error('Failed to create playlist');
      }

      // Add items to the playlist
      // First, ensure all YouTube items are added to media_library
      for (const item of session.data.items) {
        let mediaId = item.id;

        if (!mediaId && item.source === 'youtube') {
          // Create media entry for YouTube video
          const newMedia = await MediaPlayerModel.createMedia({
            title: item.title,
            artist: item.artist,
            url: item.url,
            type: item.type,
            duration: item.duration,
            coverUrl: item.coverUrl,
            category: session.data.category,
            uploaderId: userId.toString(),
            uploaderName: ctx.from.username || ctx.from.first_name,
            isPublic: true,
            metadata: {
              source: 'youtube',
              videoId: item.videoId,
            }
          });

          if (newMedia) {
            mediaId = newMedia.id;
          }
        }

        if (mediaId) {
          await MediaPlayerModel.addToPlaylist(playlist.id, mediaId, userId.toString());
        }
      }

      await ctx.editMessageText(
        `✅ *Playlist Created!*\n\n` +
        `📝 Name: ${session.data.name}\n` +
        `🎵 Items: ${session.data.items.length}\n\n` +
        `Your playlist is now available in Videorama!`,
        { parse_mode: 'Markdown' }
      );

      // Invalidate cache
      await cache.del('playlists:public');
      await cache.del(`playlists:user:${userId}`);

      logger.info('Playlist created', {
        playlistId: playlist.id,
        name: session.data.name,
        itemCount: session.data.items.length,
        userId
      });

    } catch (error) {
      logger.error('Error creating playlist:', error);
      await ctx.editMessageText('❌ Failed to create playlist. Please try again.');
    } finally {
      this.playlistSessions.delete(userId);
    }

    return true;
  }

  /**
   * Extract YouTube URLs from text
   */
  extractYouTubeUrls(text) {
    const regex = /(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/[^\s]+/gi;
    return text.match(regex) || [];
  }

  /**
   * Extract video ID from YouTube URL
   */
  extractVideoId(url) {
    let match = url.match(/(?:youtube\.com\/(?:[^\/\n\s]+\/\S+\/|(?:v|e(?:mbed)?)\/|\S*?[?&]v=)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
    return match ? match[1] : null;
  }

  /**
   * Extract playlist ID from YouTube URL
   */
  extractPlaylistId(url) {
    const match = url.match(/[?&]list=([a-zA-Z0-9_-]+)/);
    return match ? match[1] : null;
  }

  /**
   * Quick add media to playlist command
   * Usage: /addtoplaylist <playlist_id> <youtube_url>
   */
  async quickAddToPlaylist(ctx, playlistId, url) {
    const userId = ctx.from.id;

    try {
      const videoId = this.extractVideoId(url);
      if (!videoId) {
        await ctx.reply('Invalid YouTube URL');
        return;
      }

      await ctx.reply('Fetching video details...');

      const details = await InvidiousService.getVideoDetails(videoId);
      if (!details) {
        await ctx.reply('Could not fetch video details');
        return;
      }

      // Create media entry
      const newMedia = await MediaPlayerModel.createMedia({
        title: details.title,
        artist: details.author,
        url: url,
        type: 'video',
        duration: details.lengthSeconds,
        coverUrl: details.videoThumbnails?.[details.videoThumbnails.length - 1]?.url,
        category: 'videos',
        uploaderId: userId.toString(),
        uploaderName: ctx.from.username || ctx.from.first_name,
        isPublic: true,
        metadata: { source: 'youtube', videoId }
      });

      if (newMedia) {
        await MediaPlayerModel.addToPlaylist(playlistId, newMedia.id, userId.toString());
        await ctx.reply(`✅ Added "${details.title}" to playlist!`);
      }
    } catch (error) {
      logger.error('Error in quickAddToPlaylist:', error);
      await ctx.reply('Failed to add video to playlist');
    }
  }
}

module.exports = PlaylistAdminService;
