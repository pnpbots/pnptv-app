const { Markup } = require('telegraf');
const { t } = require('../../../utils/i18n');
const logger = require('../../../utils/logger');
const { getLanguage } = require('../../utils/helpers');
const JitsiService = require('../../services/jitsiService');

/**
 * Jitsi room handlers
 * Tiered call rooms: mini (10), medium (50), unlimited
 * @param {Telegraf} bot - Bot instance
 */
const registerJitsiHandlers = (bot) => {
    // Show Jitsi menu
    bot.action('show_jitsi', async (ctx) => {
        try {
            const lang = getLanguage(ctx);
            const userId = ctx.from.id.toString();

            // Check if user has premium access
            const hasPremium = await JitsiService.hasPremiumAccess(userId);

            if (!hasPremium) {
                await ctx.editMessageText(
                    lang === 'es'
                        ? '🔒 *Acceso Premium Requerido*\n\nLas salas de Jitsi están disponibles solo para miembros premium.\n\nActualiza tu plan para crear salas de videollamadas.'
                        : '🔒 *Premium Access Required*\n\nJitsi rooms are available only for premium members.\n\nUpgrade your plan to create video call rooms.',
                    {
                        parse_mode: 'Markdown',
                        ...Markup.inlineKeyboard([
                            [Markup.button.callback(lang === 'es' ? '⭐ Ver Planes' : '⭐ View Plans', 'show_plans')],
                            [Markup.button.callback(t('back', lang), 'back_to_main')]
                        ])
                    }
                );
                return;
            }

            await ctx.editMessageText(
                lang === 'es'
                    ? '📹 *Salas de Jitsi Meet*\n\nCrea salas de videollamadas para tus reuniones.\n\n🏠 Mini - hasta 10 personas\n🏢 Mediana - hasta 50 personas\n🌐 Ilimitada - sin límite'
                    : '📹 *Jitsi Meet Rooms*\n\nCreate video call rooms for your meetings.\n\n🏠 Mini - up to 10 people\n🏢 Medium - up to 50 people\n🌐 Unlimited - no limit',
                {
                    parse_mode: 'Markdown',
                    ...Markup.inlineKeyboard([
                        [Markup.button.callback(lang === 'es' ? '➕ Crear Sala' : '➕ Create Room', 'jitsi_create')],
                        [Markup.button.callback(lang === 'es' ? '🔗 Unirse a Sala' : '🔗 Join Room', 'jitsi_join')],
                        [Markup.button.callback(lang === 'es' ? '📋 Mis Salas' : '📋 My Rooms', 'jitsi_my_rooms')],
                        [Markup.button.callback(lang === 'es' ? '🌐 Salas Activas' : '🌐 Active Rooms', 'jitsi_active')],
                        [Markup.button.callback(t('back', lang), 'back_to_main')]
                    ])
                }
            );
        } catch (error) {
            logger.error('Error showing Jitsi menu:', error);
        }
    });

    // Create room - show tier selection
    bot.action('jitsi_create', async (ctx) => {
        try {
            const lang = getLanguage(ctx);
            const userId = ctx.from.id.toString();

            // Get available tiers for user
            const availableTiers = await JitsiService.getAvailableTiers(userId);

            if (availableTiers.length === 0) {
                await ctx.editMessageText(
                    lang === 'es'
                        ? '❌ No tienes acceso a crear salas. Actualiza tu plan.'
                        : '❌ You don\'t have access to create rooms. Upgrade your plan.',
                    Markup.inlineKeyboard([
                        [Markup.button.callback(t('back', lang), 'show_jitsi')]
                    ])
                );
                return;
            }

            let message = lang === 'es'
                ? '🎯 *Selecciona el tipo de sala*\n\n'
                : '🎯 *Select room type*\n\n';

            const buttons = [];

            for (const tierAccess of availableTiers) {
                const { tier, info, roomsRemaining, maxDuration } = tierAccess;

                message += `${info.icon} *${lang === 'es' ? info.nameEs : info.name}*\n`;
                message += `├ ${lang === 'es' ? 'Máx' : 'Max'}: ${info.maxParticipants} ${lang === 'es' ? 'personas' : 'people'}\n`;
                message += `├ ${lang === 'es' ? 'Duración' : 'Duration'}: ${maxDuration} min\n`;
                message += `└ ${lang === 'es' ? 'Disponibles hoy' : 'Available today'}: ${roomsRemaining}\n\n`;

                if (roomsRemaining > 0) {
                    buttons.push([
                        Markup.button.callback(
                            `${info.icon} ${lang === 'es' ? info.nameEs : info.name} (${roomsRemaining})`,
                            `jitsi_tier_${tier}`
                        )
                    ]);
                }
            }

            buttons.push([Markup.button.callback(t('back', lang), 'show_jitsi')]);

            await ctx.editMessageText(message, {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard(buttons)
            });
        } catch (error) {
            logger.error('Error in Jitsi create:', error);
        }
    });

    // Tier selected - ask for room title
    bot.action(/^jitsi_tier_(.+)$/, async (ctx) => {
        try {
            const lang = getLanguage(ctx);
            const tier = ctx.match[1];

            ctx.session.temp = ctx.session.temp || {};
            ctx.session.temp.creatingJitsiRoom = true;
            ctx.session.temp.jitsiRoomTier = tier;
            ctx.session.temp.jitsiRoomStep = 'title';
            await ctx.saveSession();

            const tierInfo = JitsiService.TIER_INFO[tier];

            await ctx.editMessageText(
                lang === 'es'
                    ? `${tierInfo.icon} *Creando sala ${tierInfo.nameEs}*\n\nEscribe el título de tu sala:`
                    : `${tierInfo.icon} *Creating ${tierInfo.name} room*\n\nEnter your room title:`,
                {
                    parse_mode: 'Markdown',
                    ...Markup.inlineKeyboard([
                        [Markup.button.callback(t('cancel', lang), 'show_jitsi')]
                    ])
                }
            );
        } catch (error) {
            logger.error('Error selecting Jitsi tier:', error);
        }
    });

    // Handle text input for room creation
    bot.on('text', async (ctx, next) => {
        if (ctx.session.temp?.creatingJitsiRoom) {
            try {
                const lang = getLanguage(ctx);
                const step = ctx.session.temp.jitsiRoomStep;

                if (step === 'title') {
                    ctx.session.temp.jitsiRoomTitle = ctx.message.text;
                    ctx.session.temp.jitsiRoomStep = 'privacy';
                    await ctx.saveSession();

                    await ctx.reply(
                        lang === 'es'
                            ? '🔐 *Privacidad de la sala*\n\nSelecciona el tipo de acceso:'
                            : '🔐 *Room Privacy*\n\nSelect access type:',
                        {
                            parse_mode: 'Markdown',
                            ...Markup.inlineKeyboard([
                                [
                                    Markup.button.callback(lang === 'es' ? '🌍 Pública' : '🌍 Public', 'jitsi_privacy_public'),
                                    Markup.button.callback(lang === 'es' ? '🔒 Privada' : '🔒 Private', 'jitsi_privacy_private')
                                ],
                                [Markup.button.callback(t('cancel', lang), 'show_jitsi')]
                            ])
                        }
                    );
                    return;
                }

                if (step === 'password') {
                    ctx.session.temp.jitsiRoomPassword = ctx.message.text;
                    // Create the room
                    await createJitsiRoom(ctx);
                    return;
                }
            } catch (error) {
                logger.error('Error in Jitsi room creation text:', error);
            }
            return;
        }

        return next();
    });

    // Handle privacy selection
    bot.action(/^jitsi_privacy_(.+)$/, async (ctx) => {
        try {
            const lang = getLanguage(ctx);
            const privacy = ctx.match[1];

            ctx.session.temp.jitsiRoomPublic = privacy === 'public';
            await ctx.saveSession();

            if (privacy === 'private') {
                ctx.session.temp.jitsiRoomStep = 'password';
                await ctx.saveSession();

                await ctx.editMessageText(
                    lang === 'es'
                        ? '🔑 *Contraseña de la sala*\n\nEscribe una contraseña para tu sala privada:'
                        : '🔑 *Room Password*\n\nEnter a password for your private room:',
                    {
                        parse_mode: 'Markdown',
                        ...Markup.inlineKeyboard([
                            [Markup.button.callback(t('cancel', lang), 'show_jitsi')]
                        ])
                    }
                );
            } else {
                // Create public room
                await createJitsiRoom(ctx);
            }
        } catch (error) {
            logger.error('Error in Jitsi privacy selection:', error);
        }
    });

    // Join room - ask for code
    bot.action('jitsi_join', async (ctx) => {
        try {
            const lang = getLanguage(ctx);

            ctx.session.temp = ctx.session.temp || {};
            ctx.session.temp.joiningJitsiRoom = true;
            await ctx.saveSession();

            await ctx.editMessageText(
                lang === 'es'
                    ? '🔗 *Unirse a Sala*\n\nEscribe el código de la sala (ej: ABC-1234):'
                    : '🔗 *Join Room*\n\nEnter the room code (e.g., ABC-1234):',
                {
                    parse_mode: 'Markdown',
                    ...Markup.inlineKeyboard([
                        [Markup.button.callback(t('cancel', lang), 'show_jitsi')]
                    ])
                }
            );
        } catch (error) {
            logger.error('Error in Jitsi join:', error);
        }
    });

    // Handle room code input
    bot.on('text', async (ctx, next) => {
        if (ctx.session.temp?.joiningJitsiRoom) {
            try {
                const lang = getLanguage(ctx);
                const roomCode = ctx.message.text.trim().toUpperCase();

                const room = await JitsiService.getRoom(roomCode);

                if (!room) {
                    await ctx.reply(
                        lang === 'es'
                            ? '❌ Sala no encontrada. Verifica el código e intenta de nuevo.'
                            : '❌ Room not found. Check the code and try again.',
                        Markup.inlineKeyboard([
                            [Markup.button.callback(t('back', lang), 'show_jitsi')]
                        ])
                    );
                    ctx.session.temp.joiningJitsiRoom = false;
                    await ctx.saveSession();
                    return;
                }

                if (room.status === 'ended') {
                    await ctx.reply(
                        lang === 'es'
                            ? '❌ Esta sala ya terminó.'
                            : '❌ This room has ended.',
                        Markup.inlineKeyboard([
                            [Markup.button.callback(t('back', lang), 'show_jitsi')]
                        ])
                    );
                    ctx.session.temp.joiningJitsiRoom = false;
                    await ctx.saveSession();
                    return;
                }

                const joinUrl = JitsiService.generateJoinUrl(room);
                const tierInfo = JitsiService.TIER_INFO[room.tier];

                await ctx.reply(
                    lang === 'es'
                        ? `✅ *Sala Encontrada*\n\n${tierInfo.icon} *${room.title}*\nCódigo: \`${room.room_code}\`\nParticipantes: ${room.current_participants}/${room.max_participants}\n\nHaz clic para unirte:`
                        : `✅ *Room Found*\n\n${tierInfo.icon} *${room.title}*\nCode: \`${room.room_code}\`\nParticipants: ${room.current_participants}/${room.max_participants}\n\nClick to join:`,
                    {
                        parse_mode: 'Markdown',
                        ...Markup.inlineKeyboard([
                            [Markup.button.url(lang === 'es' ? '🎥 Unirse a la Sala' : '🎥 Join Room', joinUrl)],
                            [Markup.button.callback(t('back', lang), 'show_jitsi')]
                        ])
                    }
                );

                ctx.session.temp.joiningJitsiRoom = false;
                await ctx.saveSession();
            } catch (error) {
                logger.error('Error joining Jitsi room:', error);
            }
            return;
        }

        return next();
    });

    // My rooms
    bot.action('jitsi_my_rooms', async (ctx) => {
        try {
            const lang = getLanguage(ctx);
            const userId = ctx.from.id.toString();

            const rooms = await JitsiService.getUserRooms(userId, { limit: 10 });

            if (rooms.length === 0) {
                await ctx.editMessageText(
                    lang === 'es'
                        ? '📋 *Mis Salas*\n\nNo has creado ninguna sala todavía.'
                        : '📋 *My Rooms*\n\nYou haven\'t created any rooms yet.',
                    {
                        parse_mode: 'Markdown',
                        ...Markup.inlineKeyboard([
                            [Markup.button.callback(lang === 'es' ? '➕ Crear Sala' : '➕ Create Room', 'jitsi_create')],
                            [Markup.button.callback(t('back', lang), 'show_jitsi')]
                        ])
                    }
                );
                return;
            }

            let message = lang === 'es' ? '📋 *Mis Salas*\n\n' : '📋 *My Rooms*\n\n';
            const buttons = [];

            for (const room of rooms) {
                const tierInfo = JitsiService.TIER_INFO[room.tier];
                const statusIcon = room.status === 'active' ? '🟢' : room.status === 'ended' ? '🔴' : '🟡';

                message += `${statusIcon} ${tierInfo.icon} *${room.title}*\n`;
                message += `└ Código: \`${room.room_code}\`\n\n`;

                if (room.status === 'active') {
                    buttons.push([
                        Markup.button.callback(
                            `${tierInfo.icon} ${room.room_code}`,
                            `jitsi_room_${room.room_code}`
                        )
                    ]);
                }
            }

            buttons.push([Markup.button.callback(t('back', lang), 'show_jitsi')]);

            await ctx.editMessageText(message, {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard(buttons)
            });
        } catch (error) {
            logger.error('Error showing my Jitsi rooms:', error);
        }
    });

    // Active rooms
    bot.action('jitsi_active', async (ctx) => {
        try {
            const lang = getLanguage(ctx);

            const rooms = await JitsiService.getActiveRooms();

            if (rooms.length === 0) {
                await ctx.editMessageText(
                    lang === 'es'
                        ? '🌐 *Salas Activas*\n\nNo hay salas activas en este momento.'
                        : '🌐 *Active Rooms*\n\nNo active rooms at this moment.',
                    {
                        parse_mode: 'Markdown',
                        ...Markup.inlineKeyboard([
                            [Markup.button.callback(t('back', lang), 'show_jitsi')]
                        ])
                    }
                );
                return;
            }

            let message = lang === 'es' ? '🌐 *Salas Activas*\n\n' : '🌐 *Active Rooms*\n\n';
            const buttons = [];

            for (const room of rooms.slice(0, 10)) {
                const tierInfo = JitsiService.TIER_INFO[room.tier];

                message += `${tierInfo.icon} *${room.title}*\n`;
                message += `├ Host: ${room.host_name}\n`;
                message += `└ 👥 ${room.current_participants}/${room.max_participants}\n\n`;

                if (room.is_public) {
                    buttons.push([
                        Markup.button.callback(
                            `${tierInfo.icon} ${room.title.substring(0, 20)}`,
                            `jitsi_room_${room.room_code}`
                        )
                    ]);
                }
            }

            buttons.push([Markup.button.callback(t('back', lang), 'show_jitsi')]);

            await ctx.editMessageText(message, {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard(buttons)
            });
        } catch (error) {
            logger.error('Error showing active Jitsi rooms:', error);
        }
    });

    // Room details
    bot.action(/^jitsi_room_(.+)$/, async (ctx) => {
        try {
            const lang = getLanguage(ctx);
            const roomCode = ctx.match[1];
            const userId = ctx.from.id.toString();

            const room = await JitsiService.getRoom(roomCode);

            if (!room) {
                await ctx.answerCbQuery(lang === 'es' ? 'Sala no encontrada' : 'Room not found');
                return;
            }

            const tierInfo = JitsiService.TIER_INFO[room.tier];
            const joinUrl = JitsiService.generateJoinUrl(room);
            const isHost = room.host_user_id === userId;

            let message = `${tierInfo.icon} *${room.title}*\n\n`;
            message += `📋 ${lang === 'es' ? 'Código' : 'Code'}: \`${room.room_code}\`\n`;
            message += `👤 Host: ${room.host_name}\n`;
            message += `👥 ${lang === 'es' ? 'Participantes' : 'Participants'}: ${room.current_participants}/${room.max_participants}\n`;
            message += `📊 ${lang === 'es' ? 'Estado' : 'Status'}: ${room.status}\n`;

            const buttons = [
                [Markup.button.url(lang === 'es' ? '🎥 Unirse' : '🎥 Join', joinUrl)]
            ];

            if (isHost && room.status === 'active') {
                buttons.push([
                    Markup.button.callback(
                        lang === 'es' ? '🛑 Terminar Sala' : '🛑 End Room',
                        `jitsi_end_${room.id}`
                    )
                ]);
            }

            buttons.push([Markup.button.callback(t('back', lang), 'show_jitsi')]);

            await ctx.editMessageText(message, {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard(buttons)
            });
        } catch (error) {
            logger.error('Error showing Jitsi room details:', error);
        }
    });

    // End room
    bot.action(/^jitsi_end_(.+)$/, async (ctx) => {
        try {
            const lang = getLanguage(ctx);
            const roomId = ctx.match[1];
            const userId = ctx.from.id.toString();

            await JitsiService.endRoom(roomId, userId);

            await ctx.answerCbQuery(
                lang === 'es' ? '✅ Sala terminada' : '✅ Room ended'
            );

            // Redirect to my rooms
            await ctx.editMessageText(
                lang === 'es'
                    ? '✅ La sala ha sido terminada exitosamente.'
                    : '✅ The room has been ended successfully.',
                Markup.inlineKeyboard([
                    [Markup.button.callback(t('back', lang), 'show_jitsi')]
                ])
            );
        } catch (error) {
            logger.error('Error ending Jitsi room:', error);
            const lang = getLanguage(ctx);
            await ctx.answerCbQuery(
                lang === 'es' ? '❌ Error al terminar la sala' : '❌ Error ending room'
            );
        }
    });

    // Helper function to create room
    async function createJitsiRoom(ctx) {
        const lang = getLanguage(ctx);

        try {
            const userId = ctx.from.id.toString();
            const result = await JitsiService.createRoom({
                userId,
                telegramId: ctx.from.id,
                displayName: ctx.from.first_name || ctx.from.username,
                tier: ctx.session.temp.jitsiRoomTier,
                title: ctx.session.temp.jitsiRoomTitle,
                isPublic: ctx.session.temp.jitsiRoomPublic,
                password: ctx.session.temp.jitsiRoomPassword
            });

            const { room, joinUrl, roomsRemaining } = result;
            const tierInfo = JitsiService.TIER_INFO[room.tier];

            let message = lang === 'es'
                ? `✅ *Sala Creada Exitosamente*\n\n`
                : `✅ *Room Created Successfully*\n\n`;

            message += `${tierInfo.icon} *${room.title}*\n\n`;
            message += `📋 ${lang === 'es' ? 'Código' : 'Code'}: \`${room.room_code}\`\n`;
            message += `👥 ${lang === 'es' ? 'Capacidad' : 'Capacity'}: ${room.max_participants}\n`;
            message += `🔐 ${lang === 'es' ? 'Privacidad' : 'Privacy'}: ${room.is_public ? (lang === 'es' ? 'Pública' : 'Public') : (lang === 'es' ? 'Privada' : 'Private')}\n`;

            if (room.room_password) {
                message += `🔑 ${lang === 'es' ? 'Contraseña' : 'Password'}: \`${room.room_password}\`\n`;
            }

            message += `\n📊 ${lang === 'es' ? 'Salas restantes hoy' : 'Rooms remaining today'}: ${roomsRemaining}`;

            await ctx.reply(message, {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard([
                    [Markup.button.url(lang === 'es' ? '🎥 Abrir Sala' : '🎥 Open Room', joinUrl)],
                    [Markup.button.callback(lang === 'es' ? '📋 Mis Salas' : '📋 My Rooms', 'jitsi_my_rooms')],
                    [Markup.button.callback(t('back', lang), 'show_jitsi')]
                ])
            });

            // Notify Live & Radio topic if room is public


            // Clear session
            ctx.session.temp.creatingJitsiRoom = false;
            ctx.session.temp.jitsiRoomTier = null;
            ctx.session.temp.jitsiRoomTitle = null;
            ctx.session.temp.jitsiRoomPublic = null;
            ctx.session.temp.jitsiRoomPassword = null;
            ctx.session.temp.jitsiRoomStep = null;
            await ctx.saveSession();

        } catch (error) {
            logger.error('Error creating Jitsi room:', error);

            await ctx.reply(
                lang === 'es'
                    ? `❌ Error al crear la sala: ${error.message}`
                    : `❌ Error creating room: ${error.message}`,
                Markup.inlineKeyboard([
                    [Markup.button.callback(t('back', lang), 'show_jitsi')]
                ])
            );

            // Clear session
            ctx.session.temp.creatingJitsiRoom = false;
            await ctx.saveSession();
        }
    }

    // Command shortcut
    bot.command('jitsi', async (ctx) => {
        const lang = getLanguage(ctx);
        const userId = ctx.from.id.toString();

        const hasPremium = await JitsiService.hasPremiumAccess(userId);

        if (!hasPremium) {
            await ctx.reply(
                lang === 'es'
                    ? '🔒 *Acceso Premium Requerido*\n\nLas salas de Jitsi están disponibles solo para miembros premium.'
                    : '🔒 *Premium Access Required*\n\nJitsi rooms are available only for premium members.',
                {
                    parse_mode: 'Markdown',
                    ...Markup.inlineKeyboard([
                        [Markup.button.callback(lang === 'es' ? '⭐ Ver Planes' : '⭐ View Plans', 'show_plans')]
                    ])
                }
            );
            return;
        }

        await ctx.reply(
            lang === 'es'
                ? '📹 *Salas de Jitsi Meet*\n\nCrea salas de videollamadas para tus reuniones.'
                : '📹 *Jitsi Meet Rooms*\n\nCreate video call rooms for your meetings.',
            {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard([
                    [Markup.button.callback(lang === 'es' ? '➕ Crear Sala' : '➕ Create Room', 'jitsi_create')],
                    [Markup.button.callback(lang === 'es' ? '🔗 Unirse' : '🔗 Join', 'jitsi_join')],
                    [Markup.button.callback(lang === 'es' ? '📋 Mis Salas' : '📋 My Rooms', 'jitsi_my_rooms')]
                ])
            }
        );
    });
};

module.exports = registerJitsiHandlers;
