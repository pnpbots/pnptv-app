/**
 * Audio Management Command Handler
 * Admin command to setup background audio for Jitsi rooms
 */

const { Markup } = require('telegraf');
const logger = require('../../../utils/logger');
const audioStreamer = require('../../../services/audioStreamer');
const PermissionService = require('../../../services/permissionService');

const registerAudioManagementHandlers = (bot) => {
  /**
   * Setup background audio command
   * Usage: /audio-setup <soundcloud_url> <track_name>
   */
  bot.command('audio-setup', async (ctx) => {
    try {
      // Check admin permission
      const userId = ctx.from?.id;
      const isAdmin = userId && (
        PermissionService.isEnvSuperAdmin(userId) ||
        PermissionService.isEnvAdmin(userId)
      );

      if (!isAdmin) {
        return ctx.reply('🔒 Only administrators can manage audio');
      }

      const args = ctx.message.text.split(' ').slice(1);
      if (args.length === 0) {
        return ctx.reply(
          '📝 Usage: `/audio-setup <soundcloud_url> [track_name]`\n\n' +
          'Example: `/audio-setup https://on.soundcloud.com/Wagr6GkKB9ZO4MAfil my-track`',
          { parse_mode: 'Markdown' }
        );
      }

      const soundcloudUrl = args[0];
      const trackName = args[1] || 'background-music';

      await ctx.reply('⏳ Downloading and setting up audio from SoundCloud...');

      const result = await audioStreamer.setupBackgroundAudio(soundcloudUrl, trackName);

      await ctx.reply(
        `✅ Audio setup successful!\n\n` +
        `📝 Track: ${result.trackName}\n` +
        `📊 File Size: ${Math.round(result.fileSize / 1024 / 1024 * 100) / 100} MB\n` +
        `🎵 Stream URL: ${result.streamUrl}\n\n` +
        `The audio will now play in the background for all participants in the Jitsi room.`,
        { parse_mode: 'Markdown' }
      );

      logger.info('Audio setup completed via command', {
        userId,
        trackName,
        fileSize: result.fileSize
      });
    } catch (error) {
      logger.error('Error in audio-setup command:', error);
      await ctx.reply(
        `❌ Failed to setup audio:\n\`${error.message}\``,
        { parse_mode: 'Markdown' }
      );
    }
  });

  /**
   * List audio files command
   */
  bot.command('audio-list', async (ctx) => {
    try {
      const userId = ctx.from?.id;
      const isAdmin = userId && (
        PermissionService.isEnvSuperAdmin(userId) ||
        PermissionService.isEnvAdmin(userId)
      );

      if (!isAdmin) {
        return ctx.reply('🔒 Only administrators can manage audio');
      }

      const files = audioStreamer.listAudioFiles();
      const current = audioStreamer.getCurrentTrack();

      let message = '🎵 Available Audio Files:\n\n';

      if (files.length === 0) {
        message += 'No audio files found.';
      } else {
        files.forEach((file, index) => {
          const isCurrent = current && current.name === file.name ? '▶️ ' : '';
          const size = Math.round(file.size / 1024 / 1024 * 100) / 100;
          message += `${isCurrent}${index + 1}. ${file.name}\n   📊 ${size} MB\n   🔗 ${file.url}\n\n`;
        });
      }

      if (current) {
        message += `\n▶️ Currently Playing: ${current.name}`;
      }

      await ctx.reply(message, { parse_mode: 'Markdown' });
    } catch (error) {
      logger.error('Error in audio-list command:', error);
      await ctx.reply('❌ Failed to list audio files');
    }
  });

  /**
   * Stop background audio command
   */
  bot.command('audio-stop', async (ctx) => {
    try {
      const userId = ctx.from?.id;
      const isAdmin = userId && (
        PermissionService.isEnvSuperAdmin(userId) ||
        PermissionService.isEnvAdmin(userId)
      );

      if (!isAdmin) {
        return ctx.reply('🔒 Only administrators can manage audio');
      }

      audioStreamer.stopBackgroundAudio();
      await ctx.reply('⏹️ Background audio stopped');

      logger.info('Background audio stopped via command', { userId });
    } catch (error) {
      logger.error('Error in audio-stop command:', error);
      await ctx.reply('❌ Failed to stop audio');
    }
  });

  /**
   * Delete audio file command
   */
  bot.command('audio-delete', async (ctx) => {
    try {
      const userId = ctx.from?.id;
      const isAdmin = userId && (
        PermissionService.isEnvSuperAdmin(userId) ||
        PermissionService.isEnvAdmin(userId)
      );

      if (!isAdmin) {
        return ctx.reply('🔒 Only administrators can manage audio');
      }

      const args = ctx.message.text.split(' ').slice(1);
      if (args.length === 0) {
        return ctx.reply('📝 Usage: `/audio-delete <filename>`', { parse_mode: 'Markdown' });
      }

      const filename = args[0];
      const deleted = audioStreamer.deleteAudioFile(filename);

      if (deleted) {
        await ctx.reply(`✅ Audio file "${filename}" deleted`);
        logger.info('Audio file deleted via command', { userId, filename });
      } else {
        await ctx.reply(`❌ Audio file "${filename}" not found`);
      }
    } catch (error) {
      logger.error('Error in audio-delete command:', error);
      await ctx.reply(`❌ Failed to delete audio: ${error.message}`);
    }
  });

  /**
   * Audio management menu
   */
  bot.command('audio-menu', async (ctx) => {
    try {
      const userId = ctx.from?.id;
      const isAdmin = userId && (
        PermissionService.isEnvSuperAdmin(userId) ||
        PermissionService.isEnvAdmin(userId)
      );

      if (!isAdmin) {
        return ctx.reply('🔒 Only administrators can manage audio');
      }

      const current = audioStreamer.getCurrentTrack();
      const statusText = current && current.isPlaying ? `Currently playing: ${current.name}` : 'No audio playing';

      await ctx.reply(
        `🎵 Audio Management\n\n${statusText}\n\nSelect an option:`,
        Markup.inlineKeyboard([
          [Markup.button.callback('➕ Setup Audio', 'audio_setup_prompt')],
          [Markup.button.callback('📋 List Files', 'audio_list_files')],
          [Markup.button.callback('⏹️ Stop Audio', 'audio_stop_playing')],
          [Markup.button.callback('🗑️ Delete File', 'audio_delete_file')]
        ])
      );
    } catch (error) {
      logger.error('Error in audio-menu command:', error);
      await ctx.reply('❌ Failed to open audio menu');
    }
  });

  /**
   * Callback handlers for audio menu
   */
  bot.action('audio_setup_prompt', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.editMessageText(
      '📝 Send the SoundCloud URL you want to play as background audio:\n\n' +
      'Example: `https://on.soundcloud.com/Wagr6GkKB9ZO4MAfil`',
      { parse_mode: 'Markdown' }
    );
  });

  bot.action('audio_list_files', async (ctx) => {
    await ctx.answerCbQuery();
    const files = audioStreamer.listAudioFiles();

    if (files.length === 0) {
      return ctx.editMessageText('📭 No audio files found.');
    }

    let message = '🎵 Available Audio Files:\n\n';
    files.forEach((file, index) => {
      const size = Math.round(file.size / 1024 / 1024 * 100) / 100;
      message += `${index + 1}. ${file.name} (${size} MB)\n`;
    });

    await ctx.editMessageText(message);
  });

  bot.action('audio_stop_playing', async (ctx) => {
    await ctx.answerCbQuery();
    audioStreamer.stopBackgroundAudio();
    await ctx.editMessageText('✅ Background audio stopped');
  });

  bot.action('audio_delete_file', async (ctx) => {
    await ctx.answerCbQuery();
    const files = audioStreamer.listAudioFiles();

    if (files.length === 0) {
      return ctx.editMessageText('📭 No audio files to delete.');
    }

    const buttons = files.map(file =>
      [Markup.button.callback(`🗑️ ${file.name}`, `audio_confirm_delete_${file.file}`)]
    );

    await ctx.editMessageText(
      'Select file to delete:',
      Markup.inlineKeyboard(buttons)
    );
  });

  // Dynamic delete confirmation callbacks
  bot.action(/audio_confirm_delete_(.+)/, async (ctx) => {
    await ctx.answerCbQuery();
    const filename = ctx.match[1];

    try {
      audioStreamer.deleteAudioFile(filename);
      await ctx.editMessageText(`✅ File "${filename}" deleted successfully`);
    } catch (error) {
      await ctx.editMessageText(`❌ Failed to delete: ${error.message}`);
    }
  });
};

module.exports = registerAudioManagementHandlers;
