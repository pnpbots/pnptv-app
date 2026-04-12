const { Markup } = require('telegraf');
const { t } = require('../../../utils/i18n');
const logger = require('../../../utils/logger');
const { getLanguage } = require('../../utils/helpers');
const UserService = require('../../../services/userService');

/**
 * PRIME Members Area menu handler
 * @param {Telegraf} bot - Bot instance
 */
const registerMembersAreaHandlers = (bot) => {
    // Main PRIME Members Area menu
    bot.action('show_members_area', async (ctx) => {
        const lang = getLanguage(ctx);
        try {
            const userId = ctx.from.id.toString();

            // Check if user has active subscription
            const hasSubscription = await UserService.hasActiveSubscription(userId);

            if (!hasSubscription) {
                await ctx.editMessageText(
                    lang === 'es'
                        ? '🔒 *Área de Miembros PRIME*\n\nEsta área está disponible solo para miembros PRIME.\n\n✨ Con PRIME obtienes acceso a:\n• Salas de Video Llamadas\n• Shows en Vivo\n• Radio PNPtv!\n• Y mucho más...'
                        : '🔒 *PRIME Members Area*\n\nThis area is only available for PRIME members.\n\n✨ With PRIME you get access to:\n• Video Call Rooms\n• Live Stream Shows\n• Radio PNPtv!\n• And much more...',
                    {
                        parse_mode: 'Markdown',
                        ...Markup.inlineKeyboard([
                            [Markup.button.callback(lang === 'es' ? '⭐ Obtener PRIME' : '⭐ Get PRIME', 'show_subscription_plans')],
                            [Markup.button.callback(lang === 'es' ? '🔙 Atrás' : '🔙 Back', 'back_to_main')]
                        ])
                    }
                );
                return;
            }

            // Show PRIME Members Area menu
            const message = lang === 'es'
                ? '💎 *Área de Miembros PRIME*\n\n¡Bienvenido al área exclusiva para miembros PRIME!\n\nSelecciona una opción:'
                : '💎 *PRIME Members Area*\n\nWelcome to the exclusive area for PRIME members!\n\nSelect an option:';

            // Build video rooms URL with user display name
            const displayName = ctx.from.first_name || ctx.from.username || 'Guest';
            const videoRoomsUrl = `https://meet.jit.si/pnptv-main-room-1#config.prejoinPageEnabled=false&config.startWithAudioMuted=true&config.startWithVideoMuted=false&userInfo.displayName=${encodeURIComponent(displayName)}`;

            await ctx.editMessageText(message, {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard([
                    [Markup.button.url(lang === 'es' ? '🎥 Ver Videos' : '🎥 Watch Videos', 'https://t.me/+BcIn29RC-xExMzAx')],
                    [Markup.button.url(lang === 'es' ? '📹 Salas de Video Llamadas' : '📹 Video Call Rooms', videoRoomsUrl)],
                    [Markup.button.callback(lang === 'es' ? '🎬 Shows en Vivo' : '🎬 Live Shows', 'show_live_shows')],
                    [Markup.button.callback(lang === 'es' ? '🔙 Atrás' : '🔙 Back', 'back_to_main')]
                ])
            });
        } catch (error) {
            logger.error('Error showing PRIME members area:', error);
            await ctx.answerCbQuery(
                lang === 'es'
                    ? 'Error al cargar el área de miembros'
                    : 'Error loading members area'
            );
        }
    });


    // Live Shows menu
    bot.action('show_live_shows', async (ctx) => {
        const lang = getLanguage(ctx);
        try {
            const userId = ctx.from.id.toString();

            // Check if user has active subscription
            const hasSubscription = await UserService.hasActiveSubscription(userId);

            if (!hasSubscription) {
                await ctx.answerCbQuery(
                    lang === 'es'
                        ? 'Necesitas PRIME para acceder'
                        : 'You need PRIME to access this'
                );
                return;
            }

            const message = lang === 'es'
                ? '🎬 *Shows en Vivo*\n\nSelecciona una opción:'
                : '🎬 *Live Shows*\n\nSelect an option:';

            await ctx.editMessageText(message, {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard([
                    [Markup.button.callback(lang === 'es' ? '📅 Próximos Shows' : '📅 Upcoming Shows', 'live_shows_upcoming')],
                    [Markup.button.callback(lang === 'es' ? '🔴 En Vivo Ahora' : '🔴 Live Now', 'live_shows_now')],
                    [Markup.button.callback(lang === 'es' ? '🎥 Mis Grabaciones' : '🎥 My Recordings', 'live_shows_recordings')],
                    [Markup.button.callback(lang === 'es' ? '⭐ Favoritos' : '⭐ Favorites', 'live_shows_favorites')],
                    [Markup.button.callback(lang === 'es' ? '🔙 Atrás' : '🔙 Back', 'show_members_area')]
                ])
            });

            await ctx.answerCbQuery();
        } catch (error) {
            logger.error('Error showing live shows:', error);
            await ctx.answerCbQuery(
                lang === 'es'
                    ? 'Error al cargar los shows'
                    : 'Error loading shows'
            );
        }
    });


    // Placeholder handlers for Live Shows
    bot.action('live_shows_upcoming', async (ctx) => {
        try {
            await ctx.answerCbQuery(
                getLanguage(ctx) === 'es'
                    ? 'Funcionalidad en desarrollo...'
                    : 'Feature coming soon...'
            );
        } catch (error) {
            logger.error('Error in live_shows_upcoming:', error);
        }
    });

    bot.action('live_shows_now', async (ctx) => {
        try {
            await ctx.answerCbQuery(
                getLanguage(ctx) === 'es'
                    ? 'Funcionalidad en desarrollo...'
                    : 'Feature coming soon...'
            );
        } catch (error) {
            logger.error('Error in live_shows_now:', error);
        }
    });

    bot.action('live_shows_recordings', async (ctx) => {
        try {
            await ctx.answerCbQuery(
                getLanguage(ctx) === 'es'
                    ? 'Funcionalidad en desarrollo...'
                    : 'Feature coming soon...'
            );
        } catch (error) {
            logger.error('Error in live_shows_recordings:', error);
        }
    });

    bot.action('live_shows_favorites', async (ctx) => {
        try {
            await ctx.answerCbQuery(
                getLanguage(ctx) === 'es'
                    ? 'Funcionalidad en desarrollo...'
                    : 'Feature coming soon...'
            );
        } catch (error) {
            logger.error('Error in live_shows_favorites:', error);
        }
    });
};

module.exports = registerMembersAreaHandlers;
