const { Markup } = require('telegraf');
const { t } = require('../../../utils/i18n');
const UserService = require('../../services/userService');
const LiveStreamModel = require('../../../models/liveStreamModel');
const { CATEGORIES } = require('../../../models/liveStreamModel');
const UserModel = require('../../../models/userModel');
const logger = require('../../../utils/logger');
const { getLanguage, validateUserInput } = require('../../utils/helpers');

/**
 * Live streaming handlers
 * @param {Telegraf} bot - Bot instance
 */
const registerLiveHandlers = (bot) => {
  // Show live streams menu
  bot.action('show_live', async (ctx) => {
    try {
      const lang = getLanguage(ctx);

      const liveText = lang === 'es'
        ? '`🎤 Transmisiones en Vivo`\n\n' +
          '¡Mira o inicia tu propio show en vivo! 🔥\n\n' +
          '**Cristina**, nuestra asistente IA, está aquí para ayudarte.\n\n' +
          '`Elige una opción abajo 💜`'
        : '`🎤 Live Streams`\n\n' +
          'Watch or start your own live show! 🔥\n\n' +
          '**Cristina**, our AI assistant, is here to help.\n\n' +
          '`Choose an option below 💜`';

      await ctx.editMessageText(
        liveText,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback(t('startLive', lang), 'live_start')],
            [Markup.button.callback(t('viewStreams', lang), 'live_view')],
            [
              Markup.button.callback(lang === 'es' ? '📁 Categorías' : '📁 Browse Categories', 'live_browse_categories'),
              Markup.button.callback('🎬 VODs', 'live_view_vods'),
            ],
            [Markup.button.callback(t('myStreams', lang), 'live_my_streams')],
            [Markup.button.callback(t('back', lang), 'back_to_main')],
          ]),
        }
      );
    } catch (error) {
      logger.error('Error showing live menu:', error);
    }
  });

  // Start live stream
  bot.action('live_start', async (ctx) => {
    try {
      const lang = getLanguage(ctx);
      const hasSubscription = await UserService.hasActiveSubscription(ctx.from.id);

      if (!hasSubscription) {
        await ctx.editMessageText(
          t('subscriptionRequired', lang),
          Markup.inlineKeyboard([
            [Markup.button.callback(t('subscribe', lang), 'show_subscription_plans')],
            [Markup.button.callback(t('back', lang), 'show_live')],
          ]),
        );
        return;
      }

      ctx.session.temp.creatingLiveStream = true;
      ctx.session.temp.liveStreamStep = 'title';
      await ctx.saveSession();

      await ctx.editMessageText(
        t('enterStreamTitle', lang),
        Markup.inlineKeyboard([
          [Markup.button.callback(t('cancel', lang), 'show_live')],
        ]),
      );
    } catch (error) {
      logger.error('Error starting live stream:', error);
    }
  });

  // View active streams
  bot.action('live_view', async (ctx) => {
    const lang = getLanguage(ctx);
    try {

      // Fetch active streams from database
      const activeStreams = await LiveStreamModel.getActiveStreams(20);

      if (activeStreams.length === 0) {
        await ctx.editMessageText(
          t('noActiveStreams', lang),
          Markup.inlineKeyboard([
            [Markup.button.callback(t('back', lang), 'show_live')],
          ]),
        );
        return;
      }

      let message = `${t('viewStreams', lang)}\n\n`;
      const buttons = [];

      activeStreams.forEach((stream) => {
        const priceTag = stream.isPaid ? ` 💰$${stream.price}` : ' 🆓';
        message += `🎤 ${stream.title}${priceTag}\n👤 ${stream.hostName}\n👥 ${stream.currentViewers} viewers\n\n`;
        buttons.push([
          Markup.button.callback(`▶️ ${stream.title}`, `live_join_${stream.streamId}`),
        ]);
      });

      buttons.push([Markup.button.callback(t('back', lang), 'show_live')]);

      await ctx.editMessageText(message, Markup.inlineKeyboard(buttons));
    } catch (error) {
      logger.error('Error viewing streams:', error);
      await ctx.reply(t('error', getLanguage(ctx)));
    }
  });

  // My streams
  bot.action('live_my_streams', async (ctx) => {
    const lang = getLanguage(ctx);
    try {
      const userId = ctx.from.id;

      // Fetch user's streams
      const myStreams = await LiveStreamModel.getByHostId(userId, 10);

      if (myStreams.length === 0) {
        await ctx.editMessageText(
          `${t('myStreams', lang)}\n\n${t('noStreamsYet', lang)}`,
          Markup.inlineKeyboard([
            [Markup.button.callback(t('startLive', lang), 'live_start')],
            [Markup.button.callback(t('back', lang), 'show_live')],
          ]),
        );
        return;
      }

      let message = `${t('myStreams', lang)}\n\n`;
      const buttons = [];

      myStreams.forEach((stream) => {
        const statusEmoji = stream.status === 'active' ? '🔴' : stream.status === 'scheduled' ? '🗓' : '⚫';
        const viewsText = `👁 ${stream.totalViews} views`;
        const likesText = `❤️ ${stream.likes} likes`;

        message += `${statusEmoji} ${stream.title}\n${viewsText} | ${likesText}\n`;

        if (stream.status === 'active') {
          message += `👥 ${stream.currentViewers} watching now\n`;
        }

        if (stream.startedAt) {
          message += `📅 ${stream.startedAt.toLocaleDateString()}\n`;
        }

        message += '\n';

        // Add manage button for active streams
        if (stream.status === 'active') {
          buttons.push([
            Markup.button.callback(`⚙️ ${stream.title}`, `live_manage_${stream.streamId}`),
          ]);
        }
      });

      buttons.push([Markup.button.callback(t('back', lang), 'show_live')]);

      await ctx.editMessageText(message, Markup.inlineKeyboard(buttons));
    } catch (error) {
      logger.error('Error showing my streams:', error);
      await ctx.reply(t('error', getLanguage(ctx)));
    }
  });

  // Join stream
  bot.action(/^live_join_(.+)$/, async (ctx) => {
    const lang = getLanguage(ctx);
    try {
      // Validate match result exists
      if (!ctx.match || !ctx.match[1]) {
        logger.error('Invalid stream join action format');
        return;
      }

      const streamId = ctx.match[1];
      const userId = ctx.from.id;

      // Get user info
      const user = await UserModel.getById(userId);

      if (!user) {
        await ctx.editMessageText(t('userNotFound', lang));
        return;
      }

      // Join the stream
      try {
        const { stream, viewerToken } = await LiveStreamModel.joinStream(
          streamId,
          userId,
          user.firstName || user.username || 'Anonymous',
        );

        // Check if stream is paid and user hasn't paid (future payment integration)
        if (stream.isPaid && stream.price > 0) {
          // For now, show payment required message
          // In future, integrate with PaymentModel
          await ctx.editMessageText(
            `${t('paidStreamNotice', lang)}\n\n💰 Price: $${stream.price}\n\n${t('paymentIntegrationPending', lang)}`,
            Markup.inlineKeyboard([
              [Markup.button.callback(t('back', lang), 'live_view')],
            ]),
          );
          return;
        }

        // Generate stream URL with token
        const streamUrl = `https://stream.pnptv.com/live/${streamId}?token=${viewerToken}`;

        const categoryEmoji = LiveStreamModel.getCategoryEmoji(stream.category);

        // Check if user is subscribed to streamer
        const isSubscribed = stream.hostId !== String(userId) ?
          await LiveStreamModel.isSubscribedToStreamer(userId, stream.hostId) : false;

        const buttons = [
          [Markup.button.url('📺 Watch Stream', streamUrl)],
          [
            Markup.button.callback('❤️ Like', `live_like_${streamId}`),
            Markup.button.callback('💬 Comments', `live_comments_${streamId}`),
          ],
          [Markup.button.callback('🔗 Share', `live_share_${streamId}`)],
        ];

        // Add subscribe/unsubscribe button if not own stream
        if (stream.hostId !== String(userId)) {
          buttons.push([
            Markup.button.callback(
              isSubscribed ? '🔕 Unfollow' : '🔔 Follow',
              `live_${isSubscribed ? 'unsubscribe' : 'subscribe'}_${stream.hostId}`
            ),
          ]);
        }

        buttons.push(
          [Markup.button.callback('👋 Leave', `live_leave_${streamId}`)],
          [Markup.button.callback(t('back', lang), 'live_view')]
        );

        await ctx.editMessageText(
          `${t('joinedStream', lang)}\n\n`
            + `🎤 ${stream.title}\n`
            + `👤 ${stream.hostName}\n`
            + `👥 ${stream.currentViewers} watching\n\n`
            + `${t('streamInstructions', lang)}`,
          Markup.inlineKeyboard([
            [Markup.button.url('📺 Watch Stream', streamUrl)],
            [Markup.button.callback('❤️ Like', `live_like_${streamId}`)],
            [Markup.button.callback('👋 Leave', `live_leave_${streamId}`)],
            [Markup.button.callback(t('back', lang), 'live_view')],
          ]),
          `${t('joinedStream', lang)}\n\n` +
            `🎤 ${stream.title}\n` +
            `👤 ${stream.hostName}\n` +
            `${categoryEmoji} ${stream.category}\n` +
            `👥 ${stream.currentViewers} watching\n` +
            `💬 ${stream.totalComments || 0} comments\n\n` +
            `${t('streamInstructions', lang)}`,
          Markup.inlineKeyboard(buttons),
        );

        logger.info('User joined stream', { userId, streamId });
      } catch (joinError) {
        if (joinError.message === 'Stream not found') {
          await ctx.editMessageText(
            t('streamNotFound', lang),
            Markup.inlineKeyboard([
              [Markup.button.callback(t('back', lang), 'live_view')],
            ]),
          );
        } else if (joinError.message === 'Stream is not active') {
          await ctx.editMessageText(
            t('streamNotActive', lang),
            Markup.inlineKeyboard([
              [Markup.button.callback(t('back', lang), 'live_view')],
            ]),
          );
        } else if (joinError.message === 'Stream has reached maximum viewers') {
          await ctx.editMessageText(
            t('streamFull', lang),
            Markup.inlineKeyboard([
              [Markup.button.callback(t('back', lang), 'live_view')],
            ]),
          );
        } else {
          throw joinError;
        }
      }
    } catch (error) {
      logger.error('Error joining stream:', error);
      await ctx.reply(t('error', getLanguage(ctx)));
    }
  });

  // Handle stream creation text input
  bot.on('text', async (ctx, next) => {
    // Handle commenting on stream
    if (ctx.session.temp?.commentingOnStream) {
      try {
        const lang = getLanguage(ctx);
        const streamId = ctx.session.temp.commentingOnStream;
        const userId = ctx.from.id;
        const user = await UserModel.getById(userId);

        if (!user) {
          await ctx.reply(t('userNotFound', lang));
          ctx.session.temp.commentingOnStream = null;
          await ctx.saveSession();
          return;
        }

        const commentText = validateUserInput(ctx.message.text, 500);

        if (!commentText) {
          await ctx.reply(t('invalidInput', lang));
          return;
        }

        try {
          await LiveStreamModel.addComment(
            streamId,
            userId,
            user.firstName || user.username || 'Anonymous',
            commentText
          );

          // Clear commenting state
          ctx.session.temp.commentingOnStream = null;
          await ctx.saveSession();

          const responseMessage = `${t('commentAdded', lang)} ✅`;

          await ctx.reply(
            responseMessage,
            Markup.inlineKeyboard([
              [Markup.button.callback('💬 View Comments', `live_comments_${streamId}`)],
              [Markup.button.callback(t('back', lang), `live_join_${streamId}`)],
            ]),
          );

          logger.info('Comment added', { userId, streamId });
        } catch (commentError) {
          if (commentError.message.includes('banned')) {
            await ctx.reply(t('bannedFromCommenting', lang));
          } else if (commentError.message.includes('wait')) {
            await ctx.reply(commentError.message); // Slow mode message
          } else if (commentError.message.includes('disabled')) {
            await ctx.reply(t('commentsDisabled', lang));
          } else {
            await ctx.reply(t('error', getLanguage(ctx)));
          }

          ctx.session.temp.commentingOnStream = null;
          await ctx.saveSession();
        }
      } catch (error) {
        logger.error('Error processing comment:', error);
        await ctx.reply(t('error', getLanguage(ctx)));
      }
      return;
    }

    if (ctx.session.temp?.creatingLiveStream) {
      const lang = getLanguage(ctx);
      try {
        const step = ctx.session.temp.liveStreamStep;

        if (step === 'title') {
          const title = validateUserInput(ctx.message.text, 100);

          if (!title) {
            await ctx.reply(`${t('invalidInput', lang)}\n${t('enterStreamTitle', lang)}`);
            return;
          }

          ctx.session.temp.liveStreamTitle = title;
          ctx.session.temp.liveStreamStep = 'category';
          await ctx.saveSession();

          // Show category selection
          const categoryButtons = [
            [
              Markup.button.callback('🎵 Music', 'live_category_music'),
              Markup.button.callback('🎮 Gaming', 'live_category_gaming'),
            ],
            [
              Markup.button.callback('🎙 Talk Show', 'live_category_talk_show'),
              Markup.button.callback('📚 Education', 'live_category_education'),
            ],
            [
              Markup.button.callback('🎭 Entertainment', 'live_category_entertainment'),
              Markup.button.callback('⚽ Sports', 'live_category_sports'),
            ],
            [
              Markup.button.callback('📰 News', 'live_category_news'),
              Markup.button.callback('📁 Other', 'live_category_other'),
            ],
            [Markup.button.callback(t('cancel', lang), 'show_live')],
          ];

          await ctx.reply(
            t('selectStreamCategory', lang),
            Markup.inlineKeyboard(categoryButtons),
          );
          return;
        }

        // Price is now selected via buttons, no text input needed
      } catch (error) {
        logger.error('Error in live stream creation:', error);
      }
      return;
    }

    return next();
  });

  // Handle paid/free selection
  bot.action('live_paid_yes', async (ctx) => {
    try {
      const lang = getLanguage(ctx);
      ctx.session.temp.liveStreamIsPaid = true;
      ctx.session.temp.liveStreamStep = 'price';
      await ctx.saveSession();

      await ctx.editMessageText(
        '💰 *Select Show Type*\n\n'
        + '🎭 *Regular Show* - $10\n'
        + '⏰ Duration: 6-8 hours\n'
        + '👥 Standard access\n\n'
        + '👑 *VIP Show* - $20\n'
        + '⏰ Duration: 6-8 hours\n'
        + '⭐ VIP exclusive content\n'
        + '💎 Premium experience\n\n'
        + 'Choose your show type:',
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [
              Markup.button.callback('🎭 Regular Show - $10', 'live_price_10'),
            ],
            [
              Markup.button.callback('👑 VIP Show - $20', 'live_price_20'),
            ],
            [Markup.button.callback(t('cancel', lang), 'show_live')],
          ]),
        },
      );
    } catch (error) {
      logger.error('Error in paid stream:', error);
    }
  });

  bot.action('live_paid_no', async (ctx) => {
    try {
      ctx.session.temp.liveStreamIsPaid = false;
      ctx.session.temp.liveStreamPrice = 0;
      ctx.session.temp.liveStreamShowType = 'free';
      await ctx.saveSession();

      await createLiveStream(ctx);
    } catch (error) {
      logger.error('Error in free stream:', error);
    }
  });

  // Handle price selection for Regular Show ($10)
  bot.action('live_price_10', async (ctx) => {
    try {
      ctx.session.temp.liveStreamPrice = 10;
      ctx.session.temp.liveStreamShowType = 'regular';
      await ctx.saveSession();

      await createLiveStream(ctx);
    } catch (error) {
      logger.error('Error in regular show selection:', error);
    }
  });

  // Handle price selection for VIP Show ($20)
  bot.action('live_price_20', async (ctx) => {
    try {
      ctx.session.temp.liveStreamPrice = 20;
      ctx.session.temp.liveStreamShowType = 'vip';
      await ctx.saveSession();

      await createLiveStream(ctx);
    } catch (error) {
      logger.error('Error in VIP show selection:', error);
    }
  });

  // Category selection handlers
  bot.action(/^live_category_(.+)$/, async (ctx) => {
    try {
      if (!ctx.match || !ctx.match[1]) {
        logger.error('Invalid category action format');
        return;
      }

      const categoryKey = ctx.match[1];
      const lang = getLanguage(ctx);

      // Map button action to CATEGORIES constant
      const categoryMap = {
        music: CATEGORIES.MUSIC,
        gaming: CATEGORIES.GAMING,
        talk_show: CATEGORIES.TALK_SHOW,
        education: CATEGORIES.EDUCATION,
        entertainment: CATEGORIES.ENTERTAINMENT,
        sports: CATEGORIES.SPORTS,
        news: CATEGORIES.NEWS,
        other: CATEGORIES.OTHER,
      };

      ctx.session.temp.liveStreamCategory = categoryMap[categoryKey] || CATEGORIES.OTHER;
      ctx.session.temp.liveStreamStep = 'paid';
      await ctx.saveSession();

      await ctx.editMessageText(
        t('streamPaid', lang),
        Markup.inlineKeyboard([
          [
            Markup.button.callback('✅ Yes', 'live_paid_yes'),
            Markup.button.callback('❌ No (Free)', 'live_paid_no'),
          ],
          [Markup.button.callback(t('cancel', lang), 'show_live')],
        ]),
      );
    } catch (error) {
      logger.error('Error selecting category:', error);
    }
  });

  // Browse streams by category
  bot.action('live_browse_categories', async (ctx) => {
    try {
      const lang = getLanguage(ctx);

      const categoryButtons = [
        [
          Markup.button.callback('🎵 Music', 'live_view_category_music'),
          Markup.button.callback('🎮 Gaming', 'live_view_category_gaming'),
        ],
        [
          Markup.button.callback('🎙 Talk Show', 'live_view_category_talk_show'),
          Markup.button.callback('📚 Education', 'live_view_category_education'),
        ],
        [
          Markup.button.callback('🎭 Entertainment', 'live_view_category_entertainment'),
          Markup.button.callback('⚽ Sports', 'live_view_category_sports'),
        ],
        [
          Markup.button.callback('📰 News', 'live_view_category_news'),
          Markup.button.callback('📁 Other', 'live_view_category_other'),
        ],
        [Markup.button.callback(t('back', lang), 'show_live')],
      ];

      await ctx.editMessageText(
        t('browseByCategory', lang),
        Markup.inlineKeyboard(categoryButtons),
      );
    } catch (error) {
      logger.error('Error showing categories:', error);
    }
  });

  // View streams in category
  bot.action(/^live_view_category_(.+)$/, async (ctx) => {
    try {
      if (!ctx.match || !ctx.match[1]) {
        logger.error('Invalid view category action format');
        return;
      }

      const categoryKey = ctx.match[1];
      const lang = getLanguage(ctx);

      const categoryMap = {
        music: CATEGORIES.MUSIC,
        gaming: CATEGORIES.GAMING,
        talk_show: CATEGORIES.TALK_SHOW,
        education: CATEGORIES.EDUCATION,
        entertainment: CATEGORIES.ENTERTAINMENT,
        sports: CATEGORIES.SPORTS,
        news: CATEGORIES.NEWS,
        other: CATEGORIES.OTHER,
      };

      const category = categoryMap[categoryKey];
      const streams = await LiveStreamModel.getByCategory(category, 20);

      if (streams.length === 0) {
        await ctx.editMessageText(
          t('noStreamsInCategory', lang),
          Markup.inlineKeyboard([
            [Markup.button.callback(t('back', lang), 'live_browse_categories')],
          ]),
        );
        return;
      }

      let message = `📺 ${t('streamsInCategory', lang)}\n\n`;
      const buttons = [];

      streams.forEach((stream) => {
        const priceTag = stream.isPaid ? ` 💰$${stream.price}` : ' 🆓';
        message += `🎤 ${stream.title}${priceTag}\n👤 ${stream.hostName}\n👥 ${stream.currentViewers} viewers\n\n`;
        buttons.push([
          Markup.button.callback(`▶️ ${stream.title}`, `live_join_${stream.streamId}`),
        ]);
      });

      buttons.push([Markup.button.callback(t('back', lang), 'live_browse_categories')]);

      await ctx.editMessageText(message, Markup.inlineKeyboard(buttons));
    } catch (error) {
      logger.error('Error viewing category streams:', error);
      await ctx.reply(t('error', getLanguage(ctx)));
    }
  });

  // Stream comments
  bot.action(/^live_comments_(.+)$/, async (ctx) => {
    try {
      if (!ctx.match || !ctx.match[1]) {
        logger.error('Invalid comments action format');
        return;
      }

      const streamId = ctx.match[1];
      const lang = getLanguage(ctx);

      // Get latest comments
      const comments = await LiveStreamModel.getComments(streamId, 10);
      const stream = await LiveStreamModel.getById(streamId);

      if (!stream) {
        await ctx.editMessageText(t('streamNotFound', lang));
        return;
      }

      let message = `💬 ${t('streamComments', lang)}\n\n🎤 ${stream.title}\n\n`;

      if (comments.length === 0) {
        message += t('noCommentsYet', lang);
      } else {
        comments.forEach((comment, index) => {
          if (index < 5) { // Show last 5 comments
            message += `👤 ${comment.userName}: ${comment.text}\n`;
          }
        });

        if (comments.length > 5) {
          message += `\n...and ${comments.length - 5} more comments`;
        }
      }

      await ctx.editMessageText(
        message,
        Markup.inlineKeyboard([
          [Markup.button.callback('💬 Add Comment', `live_add_comment_${streamId}`)],
          [Markup.button.callback(t('back', lang), `live_join_${streamId}`)],
        ]),
      );
    } catch (error) {
      logger.error('Error showing comments:', error);
      await ctx.reply(t('error', getLanguage(ctx)));
    }
  });

  // Add comment to stream
  bot.action(/^live_add_comment_(.+)$/, async (ctx) => {
    try {
      if (!ctx.match || !ctx.match[1]) {
        logger.error('Invalid add comment action format');
        return;
      }

      const streamId = ctx.match[1];
      const lang = getLanguage(ctx);

      // Validate stream exists
      const stream = await LiveStreamModel.getById(streamId);
      if (!stream) {
        await ctx.answerCbQuery(t('streamNotFound', lang));
        return;
      }

      ctx.session.temp = ctx.session.temp || {};
      ctx.session.temp.commentingOnStream = streamId;
      await ctx.saveSession();

      const buttons = [
        [Markup.button.callback(t('cancel', lang), `live_comments_${streamId}`)],
      ];

      await ctx.editMessageText(
        t('enterComment', lang),
        Markup.inlineKeyboard(buttons),
      );
    } catch (error) {
      logger.error('Error initiating comment:', error);
    }
  });

  // Like stream
  bot.action(/^live_like_(.+)$/, async (ctx) => {
    try {
      if (!ctx.match || !ctx.match[1]) {
        logger.error('Invalid like action format');
        return;
      }

      const streamId = ctx.match[1];
      const lang = getLanguage(ctx);

      await LiveStreamModel.likeStream(streamId);
      await ctx.answerCbQuery(t('streamLiked', lang));

      logger.info('Stream liked', { userId: ctx.from.id, streamId });
    } catch (error) {
      logger.error('Error liking stream:', error);
      await ctx.answerCbQuery('Error');
    }
  });

  // Leave stream
  bot.action(/^live_leave_(.+)$/, async (ctx) => {
    const lang = getLanguage(ctx);
    try {
      if (!ctx.match || !ctx.match[1]) {
        logger.error('Invalid leave action format');
        return;
      }

      const streamId = ctx.match[1];
      const userId = ctx.from.id;

      await LiveStreamModel.leaveStream(streamId, userId);

      await ctx.editMessageText(
        t('leftStream', lang),
        Markup.inlineKeyboard([
          [Markup.button.callback(t('viewStreams', lang), 'live_view')],
          [Markup.button.callback(t('back', lang), 'show_live')],
        ]),
      );

      logger.info('User left stream', { userId, streamId });
    } catch (error) {
      logger.error('Error leaving stream:', error);
      await ctx.reply(t('error', getLanguage(ctx)));
    }
  });

  // Manage stream
  bot.action(/^live_manage_(.+)$/, async (ctx) => {
    const lang = getLanguage(ctx);
    try {
      if (!ctx.match || !ctx.match[1]) {
        logger.error('Invalid manage action format');
        return;
      }

      const streamId = ctx.match[1];
      const userId = ctx.from.id;

      const stream = await LiveStreamModel.getById(streamId);

      if (!stream) {
        await ctx.editMessageText(t('streamNotFound', lang));
        return;
      }

      if (stream.hostId !== String(userId)) {
        await ctx.answerCbQuery(t('unauthorized', lang));
        return;
      }

      await ctx.editMessageText(
        `⚙️ ${t('manageStream', lang)}\n\n`
          + `🎤 ${stream.title}\n`
          + `👥 ${stream.currentViewers} watching\n`
          + `👁 ${stream.totalViews} total views\n`
          + `❤️ ${stream.likes} likes`,
        Markup.inlineKeyboard([
          [Markup.button.callback('🛑 End Stream', `live_end_${streamId}`)],
          [Markup.button.callback(t('back', lang), 'live_my_streams')],
        ]),
      );
    } catch (error) {
      logger.error('Error managing stream:', error);
      await ctx.reply(t('error', getLanguage(ctx)));
    }
  });

  // End stream
  bot.action(/^live_end_(.+)$/, async (ctx) => {
    const lang = getLanguage(ctx);
    try {
      if (!ctx.match || !ctx.match[1]) {
        logger.error('Invalid end action format');
        return;
      }

      const streamId = ctx.match[1];
      const userId = ctx.from.id;

      await LiveStreamModel.endStream(streamId, userId);

      const stream = await LiveStreamModel.getById(streamId);

      await ctx.editMessageText(
        `✅ ${t('streamEnded', lang)}\n\n`
          + `🎤 ${stream.title}\n`
          + `👁 ${stream.totalViews} total views\n`
          + `❤️ ${stream.likes} likes`,
        Markup.inlineKeyboard([
          [Markup.button.callback(t('myStreams', lang), 'live_my_streams')],
          [Markup.button.callback(t('back', lang), 'show_live')],
        ]),
      );

      logger.info('Stream ended by host', { userId, streamId });
    } catch (error) {
      logger.error('Error ending stream:', error);
      await ctx.reply(t('error', getLanguage(ctx)));
    }
  });

  // View VODs
  bot.action('live_view_vods', async (ctx) => {
    try {
      const lang = getLanguage(ctx);

      const vods = await LiveStreamModel.getVODs({}, 20);

      if (vods.length === 0) {
        await ctx.editMessageText(
          t('noVODsAvailable', lang),
          Markup.inlineKeyboard([
            [Markup.button.callback(t('back', lang), 'show_live')],
          ]),
        );
        return;
      }

      let message = `🎬 ${t('availableVODs', lang)}\n\n`;
      const buttons = [];

      vods.forEach((vod, index) => {
        if (index < 10) { // Show max 10
          const categoryEmoji = LiveStreamModel.getCategoryEmoji(vod.category);
          message +=
            `${categoryEmoji} ${vod.title}\n` +
            `👤 ${vod.hostName}\n` +
            `⏱ ${vod.duration} min | 👁 ${vod.totalViews} views\n\n`;

          buttons.push([
            Markup.button.callback(`▶️ ${vod.title.substring(0, 30)}`, `live_play_vod_${vod.streamId}`),
          ]);
        }
      });

      buttons.push([Markup.button.callback(t('back', lang), 'show_live')]);

      await ctx.editMessageText(message, Markup.inlineKeyboard(buttons));
    } catch (error) {
      logger.error('Error viewing VODs:', error);
      await ctx.reply(t('error', getLanguage(ctx)));
    }
  });

  // Play VOD
  bot.action(/^live_play_vod_(.+)$/, async (ctx) => {
    try {
      if (!ctx.match || !ctx.match[1]) {
        logger.error('Invalid play VOD action format');
        return;
      }

      const streamId = ctx.match[1];
      const lang = getLanguage(ctx);

      const vod = await LiveStreamModel.getById(streamId);

      if (!vod || !vod.recordingUrl) {
        await ctx.editMessageText(
          t('vodNotFound', lang),
          Markup.inlineKeyboard([
            [Markup.button.callback(t('back', lang), 'live_view_vods')],
          ]),
        );
        return;
      }

      const categoryEmoji = LiveStreamModel.getCategoryEmoji(vod.category);

      await ctx.editMessageText(
        `🎬 ${t('watchVOD', lang)}\n\n` +
          `🎤 ${vod.title}\n` +
          `👤 ${vod.hostName}\n` +
          `${categoryEmoji} ${vod.category}\n` +
          `⏱ Duration: ${vod.duration} minutes\n` +
          `👁 ${vod.totalViews} views\n` +
          `❤️ ${vod.likes} likes\n` +
          `💬 ${vod.totalComments || 0} comments\n`,
        Markup.inlineKeyboard([
          [Markup.button.url('▶️ Play Recording', vod.recordingUrl)],
          [Markup.button.callback('🔗 Share', `live_share_${streamId}`)],
          [Markup.button.callback(t('back', lang), 'live_view_vods')],
        ]),
      );
    } catch (error) {
      logger.error('Error playing VOD:', error);
      await ctx.reply(t('error', getLanguage(ctx)));
    }
  });

  // Share stream
  bot.action(/^live_share_(.+)$/, async (ctx) => {
    try {
      if (!ctx.match || !ctx.match[1]) {
        logger.error('Invalid share action format');
        return;
      }

      const streamId = ctx.match[1];
      const lang = getLanguage(ctx);

      // Get bot username
      const botInfo = await ctx.telegram.getMe();
      const shareLink = LiveStreamModel.generateShareLink(streamId, botInfo.username);

      // Increment share count
      await LiveStreamModel.incrementShareCount(streamId);

      await ctx.answerCbQuery(t('shareLinkCopied', lang));

      // Send share message
      await ctx.reply(
        `🔗 ${t('shareStream', lang)}\n\n${shareLink}\n\n${t('shareInstructions', lang)}`,
        Markup.inlineKeyboard([
          [
            Markup.button.url(
              t('shareToTelegram', lang),
              `https://t.me/share/url?url=${encodeURIComponent(shareLink)}`
            ),
          ],
          [Markup.button.callback(t('back', lang), `live_join_${streamId}`)],
        ]),
      );

      logger.info('Stream shared', { userId: ctx.from.id, streamId });
    } catch (error) {
      logger.error('Error sharing stream:', error);
      await ctx.answerCbQuery('Error');
    }
  });

  // Subscribe to streamer
  bot.action(/^live_subscribe_(.+)$/, async (ctx) => {
    try {
      if (!ctx.match || !ctx.match[1]) {
        logger.error('Invalid subscribe action format');
        return;
      }

      const streamerId = ctx.match[1];
      const lang = getLanguage(ctx);
      const userId = ctx.from.id;

      await LiveStreamModel.subscribeToStreamer(userId, streamerId);

      await ctx.answerCbQuery(t('subscribedToStreamer', lang));

      logger.info('User subscribed to streamer', { userId, streamerId });
    } catch (error) {
      logger.error('Error subscribing to streamer:', error);
      await ctx.answerCbQuery('Error');
    }
  });

  // Unsubscribe from streamer
  bot.action(/^live_unsubscribe_(.+)$/, async (ctx) => {
    try {
      if (!ctx.match || !ctx.match[1]) {
        logger.error('Invalid unsubscribe action format');
        return;
      }

      const streamerId = ctx.match[1];
      const lang = getLanguage(ctx);
      const userId = ctx.from.id;

      await LiveStreamModel.unsubscribeFromStreamer(userId, streamerId);

      await ctx.answerCbQuery(t('unsubscribedFromStreamer', lang));

      logger.info('User unsubscribed from streamer', { userId, streamerId });
    } catch (error) {
      logger.error('Error unsubscribing from streamer:', error);
      await ctx.answerCbQuery('Error');
    }
  });

};

/**
 * Create live stream
 * @param {Context} ctx - Telegraf context
 */
const createLiveStream = async (ctx) => {
  try {
    const lang = getLanguage(ctx);

    // Validate title exists
    const title = ctx.session.temp?.liveStreamTitle;
    if (!title || typeof title !== 'string' || title.trim().length === 0) {
      logger.error('Missing or invalid live stream title');
      await ctx.reply(`${t('error', lang)}\nPlease try creating the stream again.`);
      ctx.session.temp.creatingLiveStream = false;
      await ctx.saveSession();
      return;
    }

    const isPaid = ctx.session.temp.liveStreamIsPaid;
    const price = ctx.session.temp.liveStreamPrice || 0;
    const category = ctx.session.temp.liveStreamCategory || CATEGORIES.OTHER;
    const userId = ctx.from.id;

    // Get user info
    const user = await UserModel.getById(userId);

    if (!user) {
      await ctx.reply(t('userNotFound', lang));
      ctx.session.temp.creatingLiveStream = false;
      await ctx.saveSession();
      return;
    }

    // Send loading message (use reply instead of edit since this comes from text input)
    const loadingMsg = await ctx.reply(t('loading', lang));

    // Create stream in database with Agora integration
    const stream = await LiveStreamModel.create({
      hostId: userId,
      hostName: user.firstName || user.username || 'Anonymous',
      title,
      description: '',
      category,
      tags: [],
      isPaid,
      price,
      maxViewers: 1000,
      allowComments: true,
      recordStream: false,
      language: lang,
    });

    // Generate stream URL with host token
    const streamUrl = `https://stream.pnptv.com/live/${stream.streamId}?token=${stream.hostToken}`;

    // Store show type before clearing session
    const showType = ctx.session.temp.liveStreamShowType;

    // Clear session temp data
    ctx.session.temp.creatingLiveStream = false;
    ctx.session.temp.liveStreamTitle = null;
    ctx.session.temp.liveStreamIsPaid = null;
    ctx.session.temp.liveStreamPrice = null;
    ctx.session.temp.liveStreamShowType = null;
    await ctx.saveSession();

    // Delete loading message and send success message
    try {
      await ctx.telegram.deleteMessage(ctx.chat.id, loadingMsg.message_id);
    } catch (err) {
      // Ignore if message is too old or already deleted
    }

    // Build show type description
    let showDescription = '';
    if (showType === 'regular') {
      showDescription = '\n🎭 *Regular Show* - $10\n⏰ Duration: 6-8 hours\n';
    } else if (showType === 'vip') {
      showDescription = '\n👑 *VIP Show* - $20\n⏰ Duration: 6-8 hours\n⭐ Premium experience\n';
    }

    // Prepare buttons
    const buttons = [
      [Markup.button.url('🎥 Start Broadcasting', streamUrl)],
    ];

    // Add payment button if paid stream
    if (isPaid && price > 0) {
      const paymentUrl = `${process.env.BOT_WEBHOOK_DOMAIN}/stream-payment/${stream.streamId}`;
      buttons.push([Markup.button.url(`💳 Payment Link ($${price})`, paymentUrl)]);
    }

    buttons.push(
      [Markup.button.callback('⚙️ Manage', `live_manage_${stream.streamId}`)],
      [Markup.button.callback(t('back', lang), 'show_live')]
    );

    await ctx.reply(
      `${t('streamCreated', lang)}\n\n`
        + `🎤 ${stream.title}\n`
        + showDescription
        + `🔴 ${t('liveNow', lang)}\n\n`
        + `${t('streamHostInstructions', lang)}`
        + (isPaid ? `\n\n💰 *Ticket Price:* $${price}\n📎 Share the payment link with your audience!` : ''),
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard(buttons),
      },
    );

    // Notify followers asynchronously (don't await to not block user)
    LiveStreamModel.notifyFollowers(
      userId,
      {
        hostName: stream.hostName,
        title: stream.title,
        category: stream.category,
        streamId: stream.streamId,
      },
      async (subscriberId, message, streamId) => {
        try {
          await ctx.telegram.sendMessage(
            subscriberId,
            message,
            Markup.inlineKeyboard([
              [Markup.button.callback('📺 Join Stream', `live_join_${streamId}`)],
            ])
          );
        } catch (error) {
          // Silently fail if user blocked bot
          logger.warn('Failed to send notification', { subscriberId, error: error.message });
        }
      }
    ).catch(err => logger.error('Error notifying followers:', err));

    logger.info('Live stream created', {
      userId, streamId: stream.streamId, title, isPaid, price,
    });
  } catch (error) {
    logger.error('Error creating live stream:', error);
    const lang = getLanguage(ctx);
    await ctx.reply(t('error', lang));
  }
};

module.exports = registerLiveHandlers;
