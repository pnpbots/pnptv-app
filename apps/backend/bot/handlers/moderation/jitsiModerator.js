const { Markup } = require('telegraf');
const JitsiModeratorBot = require('../../services/jitsiModeratorBot');
const JitsiService = require('../../services/jitsiService');
const logger = require('../../../utils/logger');

// Singleton instance
let moderatorBot = null;

/**
 * Initialize the Jitsi Moderator Bot
 */
function initModerator() {
    if (!moderatorBot) {
        moderatorBot = new JitsiModeratorBot({
            jitsiDomain: process.env.JITSI_DOMAIN || 'meet.jit.si',
            mucDomain: process.env.JITSI_MUC_DOMAIN || 'conference.jit.si',
            botNickname: 'PNPtv-Moderator',
            autoModeration: true,
            muteThreshold: 3,
            kickThreshold: 5,
            cooldownDuration: 1000
        });

        // Set up event listeners
        setupEventListeners();
    }
    return moderatorBot;
}

/**
 * Setup event listeners for the moderator bot
 */
function setupEventListeners() {
    moderatorBot.on('room:joined', (data) => {
        logger.info(`Bot event: Joined room ${data.room}`);
    });

    moderatorBot.on('participant:joined', (data) => {
        logger.info(`Bot event: ${data.name} joined ${data.room}`);
    });

    moderatorBot.on('participant:left', (data) => {
        logger.info(`Bot event: ${data.name} left ${data.room}`);
    });

    moderatorBot.on('action:mute', (data) => {
        logger.info(`Bot action: Muted ${data.target} in ${data.room}`);
    });

    moderatorBot.on('action:kick', (data) => {
        logger.info(`Bot action: Kicked ${data.participant} from ${data.room}: ${data.reason}`);
    });

    moderatorBot.on('violation:recorded', (data) => {
        logger.warn(`Bot violation: ${data.participant} in ${data.room} (${data.count} violations)`);
    });

    moderatorBot.on('error', (error) => {
        logger.error('Moderator Bot Error:', error);
    });
}

/**
 * Register Jitsi Moderator Commands
 */
function registerJitsiModeratorHandlers(bot) {
    const moderator = initModerator();

    // Main moderator menu command
    bot.command('jitsimod', async (ctx) => {
        try {
            const isAdmin = ctx.from.id === parseInt(process.env.ADMIN_ID || '0');
            if (!isAdmin) {
                return ctx.reply('❌ This command is only available for admins.');
            }

            return ctx.reply(
                '🤖 *Jitsi Moderator Bot*\n\n' +
                'Control and moderate your Jitsi meetings automatically.',
                Markup.inlineKeyboard([
                    [Markup.button.callback('📊 Room Status', 'jitsimod_status')],
                    [Markup.button.callback('➕ Join Room', 'jitsimod_join')],
                    [Markup.button.callback('🔇 Mute All', 'jitsimod_mute_all')],
                    [Markup.button.callback('👥 Participants', 'jitsimod_participants')],
                    [Markup.button.callback('⚙️ Settings', 'jitsimod_settings')],
                    [Markup.button.callback('🚪 Leave Room', 'jitsimod_leave')],
                ])
            );
        } catch (error) {
            logger.error('Error in jitsimod command:', error);
            return ctx.reply('❌ Error: ' + error.message);
        }
    });

    // Show room status
    bot.action('jitsimod_status', async (ctx) => {
        try {
            const status = moderator.getStatus();
            const activeRooms = moderator.getActiveRooms();

            let statusText = '📊 *Moderator Bot Status*\n\n' +
                `Connected: ${status.isConnected ? '✅ Yes' : '❌ No'}\n` +
                `Active Rooms: ${status.activeRooms}\n`;

            if (status.activeRooms > 0) {
                statusText += '\n*Rooms:*\n';
                activeRooms.forEach(room => {
                    statusText += `• ${room.name} (${room.stats.participantCount} members)\n`;
                });
            }

            statusText += `\nReconnect Attempts: ${status.reconnectAttempts}`;

            return ctx.editMessageText(statusText, {
                parse_mode: 'Markdown',
                reply_markup: Markup.inlineKeyboard([
                    [Markup.button.callback('🔄 Refresh', 'jitsimod_status')],
                    [Markup.button.callback('← Back', 'jitsimod_back')]
                ]).reply_markup
            });
        } catch (error) {
            logger.error('Error showing status:', error);
            return ctx.answerCallbackQuery('❌ Error loading status', true);
        }
    });

    // Join room input
    bot.action('jitsimod_join', async (ctx) => {
        try {
            await ctx.editMessageText(
                '📝 *Join Room*\n\n' +
                'Send the room name to join (e.g., pnptv-meeting-1)',
                {
                    parse_mode: 'Markdown',
                    reply_markup: Markup.inlineKeyboard([
                        [Markup.button.callback('← Back', 'jitsimod_back')]
                    ]).reply_markup
                }
            );

            // Store state for next message
            ctx.session.jitsimodState = 'waiting_room_name';
        } catch (error) {
            logger.error('Error in join action:', error);
            ctx.answerCallbackQuery('❌ Error', true);
        }
    });

    // Handle room name input
    bot.on('text', async (ctx, next) => {
        try {
            if (ctx.session?.jitsimodState === 'waiting_room_name') {
                const roomName = ctx.message.text.toLowerCase().trim();

                if (!roomName || roomName.startsWith('/')) {
                    return ctx.reply('❌ Invalid room name. Please try again.');
                }

                // Join the room
                const result = await moderator.joinRoom(roomName);

                ctx.session.jitsimodState = null;
                ctx.session.currentRoom = roomName;

                return ctx.reply(
                    `✅ Bot joined room: *${roomName}*\n\n` +
                    `Participants: 0\n` +
                    `Status: Ready for moderation`,
                    {
                        parse_mode: 'Markdown',
                        reply_markup: Markup.inlineKeyboard([
                            [Markup.button.callback('🔇 Mute All', 'jitsimod_mute_all')],
                            [Markup.button.callback('👥 Participants', 'jitsimod_participants')],
                            [Markup.button.callback('← Back', 'jitsimod_back')]
                        ]).reply_markup
                    }
                );
            }
            return next();
        } catch (error) {
            logger.error('Error in text handler:', error);
            return next();
        }
    });

    // Mute all participants
    bot.action('jitsimod_mute_all', async (ctx) => {
        try {
            const roomName = ctx.session?.currentRoom;
            if (!roomName || !moderator.isInRoom(roomName)) {
                return ctx.answerCallbackQuery('⚠️ Bot is not in a room', true);
            }

            await moderator.muteParticipant(roomName, null, 'audio');
            return ctx.answerCallbackQuery('✅ All participants muted', false);
        } catch (error) {
            logger.error('Error muting all:', error);
            return ctx.answerCallbackQuery('❌ Error muting participants', true);
        }
    });

    // Show participants in current room
    bot.action('jitsimod_participants', async (ctx) => {
        try {
            const roomName = ctx.session?.currentRoom;
            if (!roomName || !moderator.isInRoom(roomName)) {
                return ctx.answerCallbackQuery('⚠️ Bot is not in a room', true);
            }

            const stats = moderator.getRoomStats(roomName);
            let participantsText = `👥 *Participants in ${roomName}*\n\n`;

            if (stats.participantCount === 0) {
                participantsText += 'No participants in the room.';
            } else {
                participantsText += `Total: ${stats.participantCount}\n\n`;
                stats.participants.forEach((p, idx) => {
                    participantsText += `${idx + 1}. ${p.name}\n`;
                    participantsText += `   Joined: ${new Date(p.joinedAt).toLocaleTimeString()}\n`;
                    if (p.violations > 0) {
                        participantsText += `   ⚠️ Violations: ${p.violations}\n`;
                    }
                    participantsText += '\n';
                });
            }

            return ctx.editMessageText(participantsText, {
                parse_mode: 'Markdown',
                reply_markup: Markup.inlineKeyboard([
                    [Markup.button.callback('🔄 Refresh', 'jitsimod_participants')],
                    [Markup.button.callback('← Back', 'jitsimod_back')]
                ]).reply_markup
            });
        } catch (error) {
            logger.error('Error showing participants:', error);
            return ctx.answerCallbackQuery('❌ Error loading participants', true);
        }
    });

    // Settings menu
    bot.action('jitsimod_settings', async (ctx) => {
        try {
            const roomName = ctx.session?.currentRoom;

            let settingsText = '⚙️ *Moderator Settings*\n\n';
            if (roomName && moderator.isInRoom(roomName)) {
                const stats = moderator.getRoomStats(roomName);
                settingsText +=
                    `Room: ${roomName}\n` +
                    `Auto-Moderation: ${stats.autoModerationEnabled ? '✅ On' : '❌ Off'}\n` +
                    `Mute Threshold: 3 violations\n` +
                    `Kick Threshold: 5 violations\n`;
            } else {
                settingsText += 'No active room selected.';
            }

            return ctx.editMessageText(settingsText, {
                parse_mode: 'Markdown',
                reply_markup: Markup.inlineKeyboard([
                    [
                        Markup.button.callback('💬 Send Message', 'jitsimod_message'),
                        Markup.button.callback('🔒 Lock Room', 'jitsimod_lock')
                    ],
                    [Markup.button.callback('← Back', 'jitsimod_back')]
                ]).reply_markup
            });
        } catch (error) {
            logger.error('Error in settings:', error);
            return ctx.answerCallbackQuery('❌ Error', true);
        }
    });

    // Send message to room
    bot.action('jitsimod_message', async (ctx) => {
        try {
            await ctx.editMessageText(
                '💬 *Send Message to Room*\n\n' +
                'Type your message:',
                {
                    parse_mode: 'Markdown',
                    reply_markup: Markup.inlineKeyboard([
                        [Markup.button.callback('← Back', 'jitsimod_settings')]
                    ]).reply_markup
                }
            );

            ctx.session.jitsimodState = 'waiting_message';
        } catch (error) {
            logger.error('Error in message action:', error);
            ctx.answerCallbackQuery('❌ Error', true);
        }
    });

    // Lock room
    bot.action('jitsimod_lock', async (ctx) => {
        try {
            const roomName = ctx.session?.currentRoom;
            if (!roomName || !moderator.isInRoom(roomName)) {
                return ctx.answerCallbackQuery('⚠️ Bot is not in a room', true);
            }

            await moderator.lockRoom(roomName, true);
            return ctx.answerCallbackQuery('🔒 Room locked', false);
        } catch (error) {
            logger.error('Error locking room:', error);
            return ctx.answerCallbackQuery('❌ Error locking room', true);
        }
    });

    // Leave room
    bot.action('jitsimod_leave', async (ctx) => {
        try {
            const roomName = ctx.session?.currentRoom;
            if (roomName && moderator.isInRoom(roomName)) {
                await moderator.leaveRoom(roomName);
                ctx.session.currentRoom = null;
                return ctx.answerCallbackQuery(`✅ Left room: ${roomName}`, false);
            }
            return ctx.answerCallbackQuery('⚠️ Bot is not in a room', true);
        } catch (error) {
            logger.error('Error leaving room:', error);
            return ctx.answerCallbackQuery('❌ Error', true);
        }
    });

    // Back button
    bot.action('jitsimod_back', async (ctx) => {
        try {
            ctx.session.jitsimodState = null;
            return ctx.scene.enter('jitsimod') || (await ctx.reply(
                '🤖 *Jitsi Moderator Bot*\n\n' +
                'Control and moderate your Jitsi meetings automatically.',
                Markup.inlineKeyboard([
                    [Markup.button.callback('📊 Room Status', 'jitsimod_status')],
                    [Markup.button.callback('➕ Join Room', 'jitsimod_join')],
                    [Markup.button.callback('🔇 Mute All', 'jitsimod_mute_all')],
                    [Markup.button.callback('👥 Participants', 'jitsimod_participants')],
                    [Markup.button.callback('⚙️ Settings', 'jitsimod_settings')],
                    [Markup.button.callback('🚪 Leave Room', 'jitsimod_leave')],
                ]).reply_markup
            ));
        } catch (error) {
            logger.error('Error in back action:', error);
            return ctx.answerCallbackQuery('❌ Error', true);
        }
    });

    logger.info('Jitsi Moderator handlers registered');
}

module.exports = registerJitsiModeratorHandlers;
