const { Markup } = require('telegraf');
const { t } = require('../../../utils/i18n');
const logger = require('../../../utils/logger');
const { getLanguage } = require('../../utils/helpers');
const StreamingService = require('../../services/streamingService');
const PermissionService = require('../../services/permissionService');
const { PERMISSIONS } = require('../../../models/permissionModel');

/**
 * Live Streaming handlers with JaaS (Jitsi as a Service)
 * Simple interface for hosts to stream and viewers to watch with chat
 * @param {Telegraf} bot - Bot instance
 */
const registerLiveStreamHandlers = (bot) => {
    // Show live streaming menu
    bot.action('show_livestream', async (ctx) => {
        try {
            const lang = getLanguage(ctx);
            const userId = ctx.from.id.toString();

            await ctx.editMessageText(
                lang === 'es'
                    ? '📡 *Transmisión en Vivo*\n\nCrea transmisiones en vivo interactivas para tus suscriptores.\n\n✨ Funciones:\n• Chat en tiempo real\n• Alta calidad de video\n• Sin límite de espectadores\n• Graba tu transmisión'
                    : '📡 *Live Streaming*\n\nCreate interactive live streams for your subscribers.\n\n✨ Features:\n• Real-time chat\n• High quality video\n• Unlimited viewers\n• Record your stream',
                {
                    parse_mode: 'Markdown',
                    ...Markup.inlineKeyboard([
                        [Markup.button.callback(lang === 'es' ? '🎥 Crear Transmisión' : '🎥 Create Stream', 'livestream_create')],
                        [Markup.button.callback(lang === 'es' ? '📺 Ver Transmisiones' : '📺 Watch Streams', 'livestream_browse')],
                        [Markup.button.callback(lang === 'es' ? '📊 Mis Transmisiones' : '📊 My Streams', 'livestream_my_streams')],
                        [Markup.button.callback(t('back', lang), 'back_to_main')]
                    ])
                }
            );
        } catch (error) {
            logger.error('Error showing livestream menu:', error);
        }
    });

    // Create stream - ask for title
    bot.action('livestream_create', async (ctx) => {
        try {
            const lang = getLanguage(ctx);
            const userId = ctx.from.id;

            // Check if user has permission to create live streams
            const hasPermission = await PermissionService.hasPermission(userId, PERMISSIONS.CREATE_LIVE_STREAM);

            if (!hasPermission) {
                await ctx.answerCbQuery(
                    lang === 'es'
                        ? '⚠️ No tienes permiso para crear transmisiones en vivo. Solo los administradores y artistas pueden crear transmisiones.'
                        : '⚠️ You don\'t have permission to create live streams. Only admins and performers can create streams.',
                    { show_alert: true }
                );
                return;
            }

            ctx.session.temp = ctx.session.temp || {};
            ctx.session.temp.creatingLiveStream = true;
            ctx.session.temp.liveStreamStep = 'title';
            await ctx.saveSession();

            await ctx.editMessageText(
                lang === 'es'
                    ? '🎥 *Crear Transmisión en Vivo*\n\nEscribe el título de tu transmisión:'
                    : '🎥 *Create Live Stream*\n\nEnter a title for your stream:',
                {
                    parse_mode: 'Markdown',
                    ...Markup.inlineKeyboard([
                        [Markup.button.callback(t('cancel', lang), 'show_livestream')]
                    ])
                }
            );
        } catch (error) {
            logger.error('Error in livestream create:', error);
        }
    });

    // Handle text input for stream creation
    bot.on('text', async (ctx, next) => {
        if (ctx.session.temp?.creatingLiveStream) {
            try {
                const lang = getLanguage(ctx);
                const step = ctx.session.temp.liveStreamStep;

                if (step === 'title') {
                    ctx.session.temp.liveStreamTitle = ctx.message.text;
                    ctx.session.temp.liveStreamStep = 'description';
                    await ctx.saveSession();

                    await ctx.reply(
                        lang === 'es'
                            ? '📝 *Descripción*\n\n Escribe una breve descripción de tu transmisión (o escribe "skip" para omitir):'
                            : '📝 *Description*\n\nEnter a brief description for your stream (or type "skip" to skip):',
                        {
                            parse_mode: 'Markdown',
                            ...Markup.inlineKeyboard([
                                [Markup.button.callback(lang === 'es' ? 'Omitir' : 'Skip', 'livestream_skip_description')],
                                [Markup.button.callback(t('cancel', lang), 'show_livestream')]
                            ])
                        }
                    );
                    return;
                }

                if (step === 'description') {
                    const description = ctx.message.text.toLowerCase() === 'skip' ? '' : ctx.message.text;
                    ctx.session.temp.liveStreamDescription = description;
                    await ctx.saveSession();

                    // Create the stream
                    await createLiveStream(ctx);
                    return;
                }
            } catch (error) {
                logger.error('Error in livestream creation text:', error);
                const lang = getLanguage(ctx);
                await ctx.reply(
                    lang === 'es'
                        ? '❌ Error al crear la transmisión. Por favor, intenta de nuevo.'
                        : '❌ Error creating stream. Please try again.'
                );
            }
            return;
        }

        return next();
    });

    // Skip description
    bot.action('livestream_skip_description', async (ctx) => {
        try {
            ctx.session.temp.liveStreamDescription = '';
            await ctx.saveSession();
            await createLiveStream(ctx);
        } catch (error) {
            logger.error('Error skipping description:', error);
        }
    });

    // Browse active streams
    bot.action('livestream_browse', async (ctx) => {
        try {
            const lang = getLanguage(ctx);

            const activeStreams = await StreamingService.getActiveStreams(10);

            if (activeStreams.length === 0) {
                await ctx.editMessageText(
                    lang === 'es'
                        ? '📺 *Transmisiones Activas*\n\nNo hay transmisiones en vivo en este momento.\n\n¡Sé el primero en transmitir!'
                        : '📺 *Active Streams*\n\nNo live streams at the moment.\n\nBe the first to go live!',
                    {
                        parse_mode: 'Markdown',
                        ...Markup.inlineKeyboard([
                            [Markup.button.callback(lang === 'es' ? '🎥 Crear Transmisión' : '🎥 Create Stream', 'livestream_create')],
                            [Markup.button.callback(t('back', lang), 'show_livestream')]
                        ])
                    }
                );
                return;
            }

            let message = lang === 'es'
                ? '📺 *Transmisiones Activas*\n\n'
                : '📺 *Active Streams*\n\n';

            const buttons = [];

            for (const stream of activeStreams) {
                message += `🔴 *${stream.title}*\n`;
                message += `👤 ${stream.hostName}\n`;
                message += `👥 ${stream.currentViewers} ${lang === 'es' ? 'espectadores' : 'viewers'}\n\n`;

                buttons.push([
                    Markup.button.callback(
                        `${stream.title.substring(0, 25)}... (👥 ${stream.currentViewers})`,
                        `livestream_watch_${stream.streamId}`
                    )
                ]);
            }

            buttons.push([Markup.button.callback(t('back', lang), 'show_livestream')]);

            await ctx.editMessageText(message, {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard(buttons)
            });
        } catch (error) {
            logger.error('Error browsing streams:', error);
        }
    });

    // Watch a stream
    bot.action(/^livestream_watch_(.+)$/, async (ctx) => {
        try {
            const lang = getLanguage(ctx);
            const streamId = ctx.match[1];
            const userId = ctx.from.id.toString();
            const userName = ctx.from.first_name || ctx.from.username || 'Viewer';

            // Join stream
            const result = await StreamingService.joinStream(streamId, {
                viewerId: userId,
                viewerTelegramId: ctx.from.id,
                viewerName: userName
            });

            const { stream, viewerUrl } = result;

            await ctx.editMessageText(
                lang === 'es'
                    ? `🔴 *${stream.title}*\n\n👤 Host: ${stream.hostName}\n👥 Espectadores: ${stream.currentViewers}\n\n📱 Haz clic en el botón para unirte a la transmisión.\n💬 El chat está integrado en la transmisión.`
                    : `🔴 *${stream.title}*\n\n👤 Host: ${stream.hostName}\n👥 Viewers: ${stream.currentViewers}\n\n📱 Click the button to join the stream.\n💬 Chat is integrated in the stream.`,
                {
                    parse_mode: 'Markdown',
                    ...Markup.inlineKeyboard([
                        [Markup.button.url(lang === 'es' ? '🎥 Ver Transmisión' : '🎥 Watch Stream', viewerUrl)],
                        [Markup.button.callback(lang === 'es' ? '🔄 Actualizar' : '🔄 Refresh', `livestream_watch_${streamId}`)],
                        [Markup.button.callback(t('back', lang), 'livestream_browse')]
                    ])
                }
            );
        } catch (error) {
            logger.error('Error watching stream:', error);
            const lang = getLanguage(ctx);
            await ctx.answerCbQuery(
                lang === 'es'
                    ? 'Error al unirse a la transmisión'
                    : 'Error joining stream'
            );
        }
    });

    // My streams
    bot.action('livestream_my_streams', async (ctx) => {
        try {
            const lang = getLanguage(ctx);
            const userId = ctx.from.id.toString();

            const streams = await StreamingService.getHostStreams(userId, 10);

            if (streams.length === 0) {
                await ctx.editMessageText(
                    lang === 'es'
                        ? '📊 *Mis Transmisiones*\n\nNo has creado ninguna transmisión todavía.\n\n¡Crea tu primera transmisión en vivo!'
                        : '📊 *My Streams*\n\nYou haven\'t created any streams yet.\n\nCreate your first live stream!',
                    {
                        parse_mode: 'Markdown',
                        ...Markup.inlineKeyboard([
                            [Markup.button.callback(lang === 'es' ? '🎥 Crear Transmisión' : '🎥 Create Stream', 'livestream_create')],
                            [Markup.button.callback(t('back', lang), 'show_livestream')]
                        ])
                    }
                );
                return;
            }

            let message = lang === 'es' ? '📊 *Mis Transmisiones*\n\n' : '📊 *My Streams*\n\n';
            const buttons = [];

            for (const stream of streams) {
                const statusIcon = stream.status === 'live' ? '🔴' : stream.status === 'ended' ? '⚫' : '⏸';

                message += `${statusIcon} *${stream.title}*\n`;
                message += `📊 ${stream.totalViews} ${lang === 'es' ? 'vistas' : 'views'} | `;
                message += `👥 ${lang === 'es' ? 'Pico' : 'Peak'}: ${stream.peakViewers}\n`;
                message += `💬 ${stream.totalComments} ${lang === 'es' ? 'mensajes' : 'messages'} | `;
                message += `❤️ ${stream.likes} ${lang === 'es' ? 'me gusta' : 'likes'}\n\n`;

                buttons.push([
                    Markup.button.callback(
                        `${stream.title.substring(0, 25)}... (${statusIcon})`,
                        `livestream_details_${stream.streamId}`
                    )
                ]);
            }

            buttons.push([Markup.button.callback(t('back', lang), 'show_livestream')]);

            await ctx.editMessageText(message, {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard(buttons)
            });
        } catch (error) {
            logger.error('Error showing my streams:', error);
        }
    });

    // Stream details
    bot.action(/^livestream_details_(.+)$/, async (ctx) => {
        try {
            const lang = getLanguage(ctx);
            const streamId = ctx.match[1];
            const userId = ctx.from.id.toString();

            const stats = await StreamingService.getStreamStatistics(streamId);

            const statusIcon = stats.status === 'live' ? '🔴' : stats.status === 'ended' ? '⚫' : '⏸';
            const statusText = stats.status === 'live'
                ? (lang === 'es' ? 'EN VIVO' : 'LIVE')
                : stats.status === 'ended'
                ? (lang === 'es' ? 'FINALIZADA' : 'ENDED')
                : (lang === 'es' ? 'PROGRAMADA' : 'SCHEDULED');

            let message = `${statusIcon} *${stats.title}*\n\n`;
            message += `📊 ${lang === 'es' ? 'Estado' : 'Status'}: *${statusText}*\n\n`;
            message += `👥 ${lang === 'es' ? 'Espectadores actuales' : 'Current viewers'}: ${stats.currentViewers}\n`;
            message += `📈 ${lang === 'es' ? 'Pico de espectadores' : 'Peak viewers'}: ${stats.peakViewers}\n`;
            message += `📊 ${lang === 'es' ? 'Total de vistas' : 'Total views'}: ${stats.totalViews}\n`;
            message += `💬 ${lang === 'es' ? 'Mensajes' : 'Messages'}: ${stats.totalComments}\n`;
            message += `❤️ ${lang === 'es' ? 'Me gusta' : 'Likes'}: ${stats.likes}\n`;

            if (stats.duration) {
                message += `⏱ ${lang === 'es' ? 'Duración' : 'Duration'}: ${Math.floor(stats.duration / 60)} ${lang === 'es' ? 'minutos' : 'minutes'}\n`;
            }

            const buttons = [];

            if (stats.status === 'live') {
                buttons.push([
                    Markup.button.callback(
                        lang === 'es' ? '🛑 Finalizar Transmisión' : '🛑 End Stream',
                        `livestream_end_${streamId}`
                    )
                ]);
            }

            buttons.push([Markup.button.callback(t('back', lang), 'livestream_my_streams')]);

            await ctx.editMessageText(message, {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard(buttons)
            });
        } catch (error) {
            logger.error('Error showing stream details:', error);
        }
    });

    // End stream
    bot.action(/^livestream_end_(.+)$/, async (ctx) => {
        try {
            const lang = getLanguage(ctx);
            const streamId = ctx.match[1];
            const userId = ctx.from.id.toString();

            await StreamingService.endStream(streamId, userId);

            await ctx.answerCbQuery(
                lang === 'es' ? '✅ Transmisión finalizada' : '✅ Stream ended'
            );

            await ctx.editMessageText(
                lang === 'es'
                    ? '✅ La transmisión ha sido finalizada exitosamente.'
                    : '✅ The stream has been ended successfully.',
                {
                    parse_mode: 'Markdown',
                    ...Markup.inlineKeyboard([
                        [Markup.button.callback(t('back', lang), 'livestream_my_streams')]
                    ])
                }
            );
        } catch (error) {
            logger.error('Error ending stream:', error);
            const lang = getLanguage(ctx);
            await ctx.answerCbQuery(
                lang === 'es' ? '❌ Error al finalizar la transmisión' : '❌ Error ending stream'
            );
        }
    });

    // Helper function to create stream
    async function createLiveStream(ctx) {
        const lang = getLanguage(ctx);

        try {
            const userId = ctx.from.id.toString();
            const userName = ctx.from.first_name || ctx.from.username || 'Host';

            const result = await StreamingService.createStream({
                hostId: userId,
                hostTelegramId: ctx.from.id,
                hostName: userName,
                title: ctx.session.temp.liveStreamTitle,
                description: ctx.session.temp.liveStreamDescription,
                isSubscribersOnly: false, // Can be configured later
                category: 'other'
            });

            const { stream, hostUrl, streamId } = result;

            // Start the stream immediately
            await StreamingService.startStream(streamId, userId);

            let message = lang === 'es'
                ? `✅ *Transmisión Creada*\n\n`
                : `✅ *Stream Created*\n\n`;

            message += `🎥 *${stream.title}*\n\n`;
            message += lang === 'es'
                ? `📱 Haz clic en el botón para comenzar a transmitir.\n\n💡 *Consejos:*\n• Puedes usar tu cámara y micrófono\n• Los espectadores pueden chatear en tiempo real\n• Comparte el código de tu transmisión con tus suscriptores`
                : `📱 Click the button to start streaming.\n\n💡 *Tips:*\n• You can use your camera and microphone\n• Viewers can chat in real-time\n• Share your stream code with your subscribers`;

            await ctx.reply(message, {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard([
                    [Markup.button.url(lang === 'es' ? '🎥 Comenzar a Transmitir' : '🎥 Start Streaming', hostUrl)],
                    [Markup.button.callback(lang === 'es' ? '📊 Ver Estadísticas' : '📊 View Stats', `livestream_details_${streamId}`)],
                    [Markup.button.callback(t('back', lang), 'show_livestream')]
                ])
            });

            // Clear session
            ctx.session.temp.creatingLiveStream = false;
            ctx.session.temp.liveStreamTitle = null;
            ctx.session.temp.liveStreamDescription = null;
            ctx.session.temp.liveStreamStep = null;
            await ctx.saveSession();

        } catch (error) {
            logger.error('Error creating live stream:', error);

            await ctx.reply(
                lang === 'es'
                    ? `❌ Error al crear la transmisión: ${error.message}\n\n¿Asegúrate de que JaaS esté configurado correctamente?`
                    : `❌ Error creating stream: ${error.message}\n\nMake sure JaaS is configured correctly.`,
                {
                    parse_mode: 'Markdown',
                    ...Markup.inlineKeyboard([
                        [Markup.button.callback(t('back', lang), 'show_livestream')]
                    ])
                }
            );

            // Clear session
            ctx.session.temp.creatingLiveStream = false;
            await ctx.saveSession();
        }
    }

    // Command shortcut
    bot.command('livestream', async (ctx) => {
        const lang = getLanguage(ctx);

        await ctx.reply(
            lang === 'es'
                ? '📡 *Transmisión en Vivo*\n\nCrea transmisiones en vivo interactivas para tus suscriptores.'
                : '📡 *Live Streaming*\n\nCreate interactive live streams for your subscribers.',
            {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard([
                    [Markup.button.callback(lang === 'es' ? '🎥 Crear Transmisión' : '🎥 Create Stream', 'livestream_create')],
                    [Markup.button.callback(lang === 'es' ? '📺 Ver Transmisiones' : '📺 Watch Streams', 'livestream_browse')],
                    [Markup.button.callback(lang === 'es' ? '📊 Mis Transmisiones' : '📊 My Streams', 'livestream_my_streams')]
                ])
            }
        );
    });
};

module.exports = registerLiveStreamHandlers;
