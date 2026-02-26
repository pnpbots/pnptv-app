const { Markup } = require('telegraf');
const NearbyPlaceService = require('../../services/nearbyPlaceService');
const NearbyPlaceCategoryModel = require('../../../models/nearbyPlaceCategoryModel');
const NearbyPlaceModel = require('../../../models/nearbyPlaceModel');
const PermissionService = require('../../services/permissionService');
const { parse } = require('csv-parse/sync');
const logger = require('../../../utils/logger');

/**
 * Nearby Places Admin Handlers
 * @param {Telegraf} bot - Bot instance
 */
const registerNearbyPlacesAdminHandlers = (bot) => {
  // ===========================================
  // ADMIN PANEL ENTRY
  // ===========================================
  bot.action('admin_nearby_places', async (ctx) => {
    try {
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) return;

      const stats = await NearbyPlaceService.getStats();
      const pendingCount = await NearbyPlaceService.countPending();

      let text = '`📍 Nearby Places Admin`\n\n';
      text += '*Statistics:*\n';

      if (stats.places) {
        text += `├ Total places: ${stats.places.total || 0}\n`;
        text += `├ Approved: ${stats.places.approved || 0}\n`;
        text += `├ Pending: ${stats.places.pending || 0}\n`;
        text += `├ Rejected: ${stats.places.rejected || 0}\n`;
        text += `└ Total views: ${stats.places.total_views || 0}\n\n`;
      }

      if (stats.submissions) {
        text += '*Submissions:*\n';
        text += `├ Total: ${stats.submissions.total || 0}\n`;
        text += `├ Pending: ${stats.submissions.pending || 0}\n`;
        text += `├ Approved: ${stats.submissions.approved || 0}\n`;
        text += `└ Rejected: ${stats.submissions.rejected || 0}\n`;
      }

      const buttons = [
        [Markup.button.callback(
          `📥 Review Submissions (${pendingCount})`,
          'admin_review_place_submissions'
        )],
        [Markup.button.callback('📋 All Places', 'admin_all_places')],
        [Markup.button.callback('📊 Statistics', 'admin_places_stats')],
        [Markup.button.callback('📤 Bulk Upload', 'admin_bulk_upload_places')],
        [Markup.button.callback('🔙 Back', 'admin_panel')],
      ];

      await ctx.editMessageText(text, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard(buttons),
      });
    } catch (error) {
      logger.error('Error showing nearby places admin:', error);
    }
  });

  // ===========================================
  // REVIEW SUBMISSIONS LIST
  // ===========================================
  bot.action('admin_review_place_submissions', async (ctx) => {
    try {
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) return;

      const submissions = await NearbyPlaceService.getPendingSubmissions(15);

      if (submissions.length === 0) {
        await ctx.editMessageText(
          '`✅ No Pending Submissions`\n\n' +
          'All submissions have been reviewed.',
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
              [Markup.button.callback('🔄 Refresh', 'admin_review_place_submissions')],
              [Markup.button.callback('🔙 Back', 'admin_nearby_places')],
            ]),
          }
        );
        return;
      }

      let text = '`📥 Pending Submissions`\n\n';
      text += `Found ${submissions.length} pending submissions:\n\n`;

      const buttons = submissions.slice(0, 10).map((s, i) => [
        Markup.button.callback(
          `${i + 1}. ${s.categoryEmoji || '📍'} ${s.name.substring(0, 25)}${s.name.length > 25 ? '...' : ''} - @${s.submitterUsername || 'unknown'}`,
          `admin_review_sub_${s.id}`
        ),
      ]);

      if (submissions.length > 10) {
        text += `_...and ${submissions.length - 10} more_\n`;
      }

      buttons.push([Markup.button.callback('🔄 Refresh', 'admin_review_place_submissions')]);
      buttons.push([Markup.button.callback('🔙 Back', 'admin_nearby_places')]);

      await ctx.editMessageText(text, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard(buttons),
      });
    } catch (error) {
      logger.error('Error showing pending submissions:', error);
    }
  });

  // ===========================================
  // REVIEW SINGLE SUBMISSION
  // ===========================================
  bot.action(/^admin_review_sub_(\d+)$/, async (ctx) => {
    try {
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) return;

      const submissionId = parseInt(ctx.match[1]);
      const submissions = await NearbyPlaceService.getPendingSubmissions(100);
      const submission = submissions.find(s => s.id === submissionId);

      if (!submission) {
        await ctx.answerCbQuery('Submission not found or already processed');
        return;
      }

      let text = '`📋 Submission Review`\n\n';
      text += `*Name:* ${escapeMarkdown(submission.name)}\n`;
      text += `*Category:* ${submission.categoryEmoji || '📍'} ${submission.categoryName || 'N/A'}\n`;
      text += `*Type:* ${submission.placeType}\n\n`;

      if (submission.description) {
        text += `*Description:*\n${escapeMarkdown(submission.description.substring(0, 300))}${submission.description.length > 300 ? '...' : ''}\n\n`;
      }

      text += `*Address:* ${submission.address || 'N/A'}\n`;
      text += `*City:* ${submission.city || 'N/A'}\n`;

      if (submission.location) {
        text += `*Location:* ${submission.location.lat}, ${submission.location.lng}\n`;
      }

      text += '\n*Contact Info:*\n';
      text += `├ Phone: ${submission.phone || 'N/A'}\n`;
      text += `├ Website: ${submission.website || 'N/A'}\n`;
      text += `├ Telegram: @${submission.telegramUsername || 'N/A'}\n`;
      text += `└ Instagram: @${submission.instagram || 'N/A'}\n\n`;

      text += `*Submitted by:* @${submission.submitterUsername || submission.submittedByUserId}\n`;
      text += `*Submitted:* ${submission.submittedAt ? new Date(submission.submittedAt).toLocaleDateString() : 'N/A'}\n`;

      const buttons = [
        [
          Markup.button.callback('✅ Approve', `admin_approve_place_sub_${submissionId}`),
          Markup.button.callback('❌ Reject', `admin_reject_place_sub_${submissionId}`),
        ],
      ];

      // Add map link if location available
      if (submission.location) {
        buttons.push([
          Markup.button.url(
            '🗺️ View on Map',
            `https://www.google.com/maps/search/?api=1&query=${submission.location.lat},${submission.location.lng}`
          ),
        ]);
      }

      buttons.push([Markup.button.callback('🔙 Back to List', 'admin_review_place_submissions')]);

      await ctx.editMessageText(text, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard(buttons),
      });
    } catch (error) {
      logger.error('Error showing submission review:', error);
    }
  });

  // ===========================================
  // APPROVE SUBMISSION
  // ===========================================
  bot.action(/^admin_approve_place_sub_(\d+)$/, async (ctx) => {
    try {
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) return;

      const submissionId = parseInt(ctx.match[1]);
      const adminUserId = ctx.from.id.toString();

      await ctx.editMessageText('`⏳ Processing approval...`', { parse_mode: 'Markdown' });

      const result = await NearbyPlaceService.approveSubmission(submissionId, adminUserId);

      if (result.success) {
        // Try to notify the submitter
        try {
          await ctx.telegram.sendMessage(
            result.submission.submittedByUserId,
            `✅ *Great news!*\n\n` +
            `Your place submission "${escapeMarkdown(result.place.name)}" has been approved and is now live!\n\n` +
            `Thank you for contributing to the community.`,
            { parse_mode: 'Markdown' }
          );
        } catch (notifyError) {
          logger.error('Error notifying user of approval:', notifyError);
        }

        await ctx.editMessageText(
          '`✅ Submission Approved`\n\n' +
          `Place "${escapeMarkdown(result.place.name)}" has been added to the directory.\n\n` +
          `Place ID: ${result.place.id}`,
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
              [Markup.button.callback('📥 Review More', 'admin_review_place_submissions')],
              [Markup.button.callback('🔙 Back', 'admin_nearby_places')],
            ]),
          }
        );
      } else {
        await ctx.editMessageText(
          '`❌ Error`\n\n' +
          `Failed to approve: ${result.error}`,
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
              [Markup.button.callback('🔙 Back to Review', `admin_review_sub_${submissionId}`)],
            ]),
          }
        );
      }
    } catch (error) {
      logger.error('Error approving submission:', error);
      await ctx.answerCbQuery('Error approving submission');
    }
  });

  // ===========================================
  // REJECT SUBMISSION - Show Options
  // ===========================================
  bot.action(/^admin_reject_place_sub_(\d+)$/, async (ctx) => {
    try {
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) return;

      const submissionId = parseInt(ctx.match[1]);

      // Store in session for custom reason
      ctx.session.temp = ctx.session.temp || {};
      ctx.session.temp.rejectingSubmissionId = submissionId;
      await ctx.saveSession();

      await ctx.editMessageText(
        '`❌ Reject Submission`\n\n' +
        'Select a rejection reason:\n\n' +
        '_This reason will be sent to the submitter._',
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('🔄 Duplicate place', `admin_reject_reason_duplicate_${submissionId}`)],
            [Markup.button.callback('⚠️ Inappropriate content', `admin_reject_reason_inappropriate_${submissionId}`)],
            [Markup.button.callback('📍 Invalid/missing location', `admin_reject_reason_location_${submissionId}`)],
            [Markup.button.callback('📝 Incomplete information', `admin_reject_reason_incomplete_${submissionId}`)],
            [Markup.button.callback('🔞 Age-restricted violation', `admin_reject_reason_age_${submissionId}`)],
            [Markup.button.callback('✏️ Custom reason...', `admin_reject_custom_${submissionId}`)],
            [Markup.button.callback('🔙 Back', `admin_review_sub_${submissionId}`)],
          ]),
        }
      );
    } catch (error) {
      logger.error('Error showing rejection options:', error);
    }
  });

  // Quick rejection with preset reason
  bot.action(/^admin_reject_reason_(duplicate|inappropriate|location|incomplete|age)_(\d+)$/, async (ctx) => {
    try {
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) return;

      const reasonType = ctx.match[1];
      const submissionId = parseInt(ctx.match[2]);
      const adminUserId = ctx.from.id.toString();

      const reasonMap = {
        duplicate: 'This place already exists in our directory.',
        inappropriate: 'This submission does not meet our community guidelines.',
        location: 'The location information provided is invalid or incomplete.',
        incomplete: 'The submission is missing required information. Please resubmit with more details.',
        age: 'This place was submitted to the wrong category. Age-restricted venues must be properly categorized.',
      };

      const reason = reasonMap[reasonType] || 'Your submission was not approved.';

      await ctx.editMessageText('`⏳ Processing rejection...`', { parse_mode: 'Markdown' });

      const result = await NearbyPlaceService.rejectSubmission(submissionId, adminUserId, reason);

      if (result.success) {
        // Try to notify the submitter
        try {
          await ctx.telegram.sendMessage(
            result.submission.submittedByUserId,
            `❌ *Submission Not Approved*\n\n` +
            `Your place submission was not approved.\n\n` +
            `*Reason:* ${reason}\n\n` +
            `You can submit a new place with the corrected information.`,
            { parse_mode: 'Markdown' }
          );
        } catch (notifyError) {
          logger.error('Error notifying user of rejection:', notifyError);
        }

        await ctx.editMessageText(
          '`❌ Submission Rejected`\n\n' +
          `Reason: ${reason}`,
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
              [Markup.button.callback('📥 Review More', 'admin_review_place_submissions')],
              [Markup.button.callback('🔙 Back', 'admin_nearby_places')],
            ]),
          }
        );
      } else {
        await ctx.answerCbQuery(`Error: ${result.error}`, { show_alert: true });
      }
    } catch (error) {
      logger.error('Error rejecting submission:', error);
    }
  });

  // Custom rejection reason - prompt for text
  bot.action(/^admin_reject_custom_(\d+)$/, async (ctx) => {
    try {
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) return;

      const submissionId = parseInt(ctx.match[1]);

      ctx.session.temp = ctx.session.temp || {};
      ctx.session.temp.awaitingCustomRejection = true;
      ctx.session.temp.rejectingSubmissionId = submissionId;
      await ctx.saveSession();

      await ctx.editMessageText(
        '`✏️ Custom Rejection Reason`\n\n' +
        'Please type your rejection reason:\n\n' +
        '_This will be sent to the submitter._',
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('❌ Cancel', `admin_reject_place_sub_${submissionId}`)],
          ]),
        }
      );
    } catch (error) {
      logger.error('Error showing custom rejection prompt:', error);
    }
  });

  // Handle custom rejection reason text
  bot.on('text', async (ctx, next) => {
    try {
      if (ctx.chat?.type && ctx.chat.type !== 'private') return next();
      if (!ctx.session?.temp?.awaitingCustomRejection) {
        return next();
      }

      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) {
        delete ctx.session.temp.awaitingCustomRejection;
        await ctx.saveSession();
        return next();
      }

      const submissionId = ctx.session.temp.rejectingSubmissionId;
      const reason = ctx.message.text.trim();
      const adminUserId = ctx.from.id.toString();

      // Clear session
      delete ctx.session.temp.awaitingCustomRejection;
      delete ctx.session.temp.rejectingSubmissionId;
      await ctx.saveSession();

      if (reason.length < 5) {
        await ctx.reply('Rejection reason is too short. Please try again.');
        return;
      }

      const result = await NearbyPlaceService.rejectSubmission(submissionId, adminUserId, reason);

      if (result.success) {
        // Notify submitter
        try {
          await ctx.telegram.sendMessage(
            result.submission.submittedByUserId,
            `❌ *Submission Not Approved*\n\n` +
            `Your place submission was not approved.\n\n` +
            `*Reason:* ${escapeMarkdown(reason)}\n\n` +
            `You can submit a new place with the corrected information.`,
            { parse_mode: 'Markdown' }
          );
        } catch (notifyError) {
          logger.error('Error notifying user of rejection:', notifyError);
        }

        await ctx.reply(
          '`❌ Submission Rejected`\n\n' +
          `Reason: ${escapeMarkdown(reason)}`,
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
              [Markup.button.callback('📥 Review More', 'admin_review_place_submissions')],
              [Markup.button.callback('🔙 Back', 'admin_nearby_places')],
            ]),
          }
        );
      } else {
        await ctx.reply(`Error rejecting submission: ${result.error}`);
      }
    } catch (error) {
      logger.error('Error handling custom rejection:', error);
      return next();
    }
  });

  // ===========================================
  // ALL PLACES
  // ===========================================
  bot.action('admin_all_places', async (ctx) => {
    try {
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) return;

      await ctx.editMessageText(
        '`📋 Browse Places`\n\n' +
        'Select a filter:',
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [
              Markup.button.callback('✅ Approved', 'admin_places_filter_approved'),
              Markup.button.callback('⏳ Pending', 'admin_places_filter_pending'),
            ],
            [
              Markup.button.callback('❌ Rejected', 'admin_places_filter_rejected'),
              Markup.button.callback('🚫 Suspended', 'admin_places_filter_suspended'),
            ],
            [Markup.button.callback('📋 All', 'admin_places_filter_all')],
            [Markup.button.callback('🔙 Back', 'admin_nearby_places')],
          ]),
        }
      );
    } catch (error) {
      logger.error('Error showing all places menu:', error);
    }
  });

  // Filter places by status
  bot.action(/^admin_places_filter_(approved|pending|rejected|suspended|all)$/, async (ctx) => {
    try {
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) return;

      const filterType = ctx.match[1];
      const filters = filterType !== 'all' ? { status: filterType } : {};

      const places = await NearbyPlaceService.getAllPlaces(filters, 20, 0);

      if (places.length === 0) {
        await ctx.editMessageText(
          `\`📋 ${filterType.charAt(0).toUpperCase() + filterType.slice(1)} Places\`\n\n` +
          'No places found with this filter.',
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
              [Markup.button.callback('🔙 Back', 'admin_all_places')],
            ]),
          }
        );
        return;
      }

      let text = `\`📋 ${filterType.charAt(0).toUpperCase() + filterType.slice(1)} Places\`\n\n`;
      text += `Found ${places.length} places:\n\n`;

      const buttons = places.slice(0, 10).map((p, i) => {
        const statusEmoji = p.status === 'approved' ? '✅'
          : p.status === 'pending' ? '⏳'
          : p.status === 'rejected' ? '❌'
          : '🚫';
        return [
          Markup.button.callback(
            `${statusEmoji} ${p.categoryEmoji || '📍'} ${p.name.substring(0, 25)}`,
            `admin_view_place_${p.id}`
          ),
        ];
      });

      buttons.push([Markup.button.callback('🔙 Back', 'admin_all_places')]);

      await ctx.editMessageText(text, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard(buttons),
      });
    } catch (error) {
      logger.error('Error filtering places:', error);
    }
  });

  // View single place (admin)
  bot.action(/^admin_view_place_(\d+)$/, async (ctx) => {
    try {
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) return;

      const placeId = parseInt(ctx.match[1]);
      const place = await NearbyPlaceService.getPlaceDetails(placeId, false);

      if (!place) {
        await ctx.answerCbQuery('Place not found');
        return;
      }

      const statusEmoji = place.status === 'approved' ? '✅'
        : place.status === 'pending' ? '⏳'
        : place.status === 'rejected' ? '❌'
        : '🚫';

      let text = `\`📋 Place Details\`\n\n`;
      text += `*Name:* ${escapeMarkdown(place.name)}\n`;
      text += `*Status:* ${statusEmoji} ${place.status}\n`;
      text += `*Category:* ${place.categoryEmoji || '📍'} ${place.categoryName || 'N/A'}\n`;
      text += `*Type:* ${place.placeType}\n\n`;

      if (place.description) {
        text += `*Description:*\n${escapeMarkdown(place.description.substring(0, 200))}${place.description.length > 200 ? '...' : ''}\n\n`;
      }

      text += `*Address:* ${place.address || 'N/A'}\n`;
      text += `*City:* ${place.city || 'N/A'}\n\n`;

      text += `*Stats:*\n`;
      text += `├ Views: ${place.viewCount || 0}\n`;
      text += `├ Favorites: ${place.favoriteCount || 0}\n`;
      text += `└ Reports: ${place.reportCount || 0}\n`;

      const buttons = [];

      // Status change buttons
      if (place.status === 'approved') {
        buttons.push([Markup.button.callback('🚫 Suspend', `admin_suspend_place_${placeId}`)]);
      } else if (place.status === 'suspended') {
        buttons.push([Markup.button.callback('✅ Reactivate', `admin_reactivate_place_${placeId}`)]);
      } else if (place.status === 'pending') {
        buttons.push([
          Markup.button.callback('✅ Approve', `admin_approve_place_${placeId}`),
          Markup.button.callback('❌ Reject', `admin_reject_place_${placeId}`),
        ]);
      }

      buttons.push([Markup.button.callback('🗑️ Delete', `admin_delete_place_${placeId}`)]);

      if (place.location) {
        buttons.push([Markup.button.url(
          '🗺️ View on Map',
          `https://www.google.com/maps/search/?api=1&query=${place.location.lat},${place.location.lng}`
        )]);
      }

      buttons.push([Markup.button.callback('🔙 Back', 'admin_all_places')]);

      await ctx.editMessageText(text, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard(buttons),
      });
    } catch (error) {
      logger.error('Error viewing place details:', error);
    }
  });

  // Suspend place
  bot.action(/^admin_suspend_place_(\d+)$/, async (ctx) => {
    try {
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) return;

      const placeId = parseInt(ctx.match[1]);
      const adminUserId = ctx.from.id.toString();

      const result = await NearbyPlaceService.toggleSuspend(placeId, true, adminUserId);

      if (result.success) {
        await ctx.answerCbQuery('Place suspended');
        // Refresh view
        ctx.match[1] = placeId.toString();
        await ctx.editMessageText(
          '`🚫 Place Suspended`\n\n' +
          'The place has been suspended and is no longer visible to users.',
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
              [Markup.button.callback('✅ Reactivate', `admin_reactivate_place_${placeId}`)],
              [Markup.button.callback('🔙 Back', 'admin_all_places')],
            ]),
          }
        );
      } else {
        await ctx.answerCbQuery(`Error: ${result.error}`, { show_alert: true });
      }
    } catch (error) {
      logger.error('Error suspending place:', error);
    }
  });

  // Reactivate place
  bot.action(/^admin_reactivate_place_(\d+)$/, async (ctx) => {
    try {
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) return;

      const placeId = parseInt(ctx.match[1]);
      const adminUserId = ctx.from.id.toString();

      const result = await NearbyPlaceService.toggleSuspend(placeId, false, adminUserId);

      if (result.success) {
        await ctx.answerCbQuery('Place reactivated');
        await ctx.editMessageText(
          '`✅ Place Reactivated`\n\n' +
          'The place is now visible to users again.',
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
              [Markup.button.callback('👁️ View Details', `admin_view_place_${placeId}`)],
              [Markup.button.callback('🔙 Back', 'admin_all_places')],
            ]),
          }
        );
      } else {
        await ctx.answerCbQuery(`Error: ${result.error}`, { show_alert: true });
      }
    } catch (error) {
      logger.error('Error reactivating place:', error);
    }
  });

  // Delete place - confirmation
  bot.action(/^admin_delete_place_(\d+)$/, async (ctx) => {
    try {
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) return;

      const placeId = parseInt(ctx.match[1]);

      await ctx.editMessageText(
        '`⚠️ Confirm Deletion`\n\n' +
        'Are you sure you want to permanently delete this place?\n\n' +
        '_This action cannot be undone._',
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('🗑️ Yes, Delete', `admin_confirm_delete_place_${placeId}`)],
            [Markup.button.callback('❌ Cancel', `admin_view_place_${placeId}`)],
          ]),
        }
      );
    } catch (error) {
      logger.error('Error showing delete confirmation:', error);
    }
  });

  // Confirm delete place
  bot.action(/^admin_confirm_delete_place_(\d+)$/, async (ctx) => {
    try {
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) return;

      const placeId = parseInt(ctx.match[1]);

      const result = await NearbyPlaceService.deletePlace(placeId);

      if (result.success) {
        await ctx.editMessageText(
          '`🗑️ Place Deleted`\n\n' +
          'The place has been permanently removed.',
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
              [Markup.button.callback('🔙 Back', 'admin_all_places')],
            ]),
          }
        );
      } else {
        await ctx.answerCbQuery(`Error: ${result.error}`, { show_alert: true });
      }
    } catch (error) {
      logger.error('Error deleting place:', error);
    }
  });

  // ===========================================
  // STATISTICS
  // ===========================================
  bot.action('admin_places_stats', async (ctx) => {
    try {
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) return;

      const stats = await NearbyPlaceService.getStats();

      let text = '`📊 Nearby Places Statistics`\n\n';

      if (stats.places) {
        text += '*Places:*\n';
        text += `├ Total: ${stats.places.total || 0}\n`;
        text += `├ Approved: ${stats.places.approved || 0}\n`;
        text += `├ Pending: ${stats.places.pending || 0}\n`;
        text += `├ Rejected: ${stats.places.rejected || 0}\n`;
        text += `├ Businesses: ${stats.places.businesses || 0}\n`;
        text += `├ Places of Interest: ${stats.places.places_of_interest || 0}\n`;
        text += `└ Total Views: ${stats.places.total_views || 0}\n\n`;
      }

      if (stats.submissions) {
        text += '*Submissions:*\n';
        text += `├ Total: ${stats.submissions.total || 0}\n`;
        text += `├ Pending: ${stats.submissions.pending || 0}\n`;
        text += `├ Approved: ${stats.submissions.approved || 0}\n`;
        text += `└ Rejected: ${stats.submissions.rejected || 0}\n`;
      }

      await ctx.editMessageText(text, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('🔄 Refresh', 'admin_places_stats')],
          [Markup.button.callback('🔙 Back', 'admin_nearby_places')],
        ]),
      });
    } catch (error) {
      logger.error('Error showing statistics:', error);
    }
  });

  // ===========================================
  // BULK UPLOAD
  // ===========================================

  const VALID_CATEGORY_SLUGS = [
    'wellness', 'cruising', 'adult_entertainment', 'pnp_friendly',
    'help_centers', 'saunas', 'bars_clubs', 'community_business',
  ];

  bot.action('admin_bulk_upload_places', async (ctx) => {
    try {
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) return;

      let text = '`📤 Bulk Upload Places`\n\n';
      text += '*CSV Format:*\n';
      text += 'Upload a CSV file with the following columns:\n\n';
      text += '*Required:* `name`, `place_type`, `category_slug`\n';
      text += '*Optional:* `address`, `city`, `country`, `lat`, `lng`, `description`, `phone`, `email`, `website`, `telegram_username`, `instagram`, `price_range`, `is_community_owned`\n\n';
      text += '*Valid place types:* `business`, `place_of_interest`\n\n';
      text += '*Valid category slugs:*\n';
      text += VALID_CATEGORY_SLUGS.map(s => `• \`${s}\``).join('\n');
      text += '\n\n_Download the template for the exact format._';

      await ctx.editMessageText(text, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('📄 Download Template', 'admin_bulk_template')],
          [Markup.button.callback('📤 Upload CSV', 'admin_bulk_upload_start')],
          [Markup.button.callback('🔙 Back', 'admin_nearby_places')],
        ]),
      });
    } catch (error) {
      logger.error('Error showing bulk upload panel:', error);
    }
  });

  bot.action('admin_bulk_template', async (ctx) => {
    try {
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) return;

      await ctx.answerCbQuery();

      const headers = [
        'name', 'place_type', 'category_slug', 'address', 'city', 'country',
        'lat', 'lng', 'description', 'phone', 'email', 'website',
        'telegram_username', 'instagram', 'price_range', 'is_community_owned',
      ];

      const exampleRows = [
        ['Rainbow Wellness Spa', 'business', 'wellness', '123 Main St', 'Madrid', 'Spain',
          '40.4168', '-3.7038', 'A welcoming wellness center', '+34 612 345 678', 'info@example.com', 'https://example.com',
          'rainbowspa', 'rainbowspa', '$$', 'true'],
        ['Sunset Park Lookout', 'place_of_interest', 'cruising', 'Sunset Blvd', 'Barcelona', 'Spain',
          '41.3851', '2.1734', 'Popular meeting spot near the park', '', '', '',
          '', '', '', 'false'],
      ];

      const csvLines = [
        headers.join(','),
        ...exampleRows.map(row => row.map(v => `"${v}"`).join(',')),
      ];
      const csvString = csvLines.join('\n');

      await ctx.replyWithDocument({
        source: Buffer.from(csvString),
        filename: 'nearby_places_template.csv',
      }, {
        caption: 'Here is the CSV template with 2 example rows. Fill it in and upload.',
      });
    } catch (error) {
      logger.error('Error sending bulk template:', error);
    }
  });

  bot.action('admin_bulk_upload_start', async (ctx) => {
    try {
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) return;

      ctx.session.temp = ctx.session.temp || {};
      ctx.session.temp.awaitingBulkUpload = true;
      await ctx.saveSession();

      await ctx.editMessageText(
        '`📤 Bulk Upload`\n\n' +
        'Send me the CSV file now.\n\n' +
        '_Make sure it follows the template format._',
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('❌ Cancel', 'admin_bulk_upload_cancel')],
          ]),
        }
      );
    } catch (error) {
      logger.error('Error starting bulk upload:', error);
    }
  });

  bot.action('admin_bulk_upload_cancel', async (ctx) => {
    try {
      if (ctx.session?.temp) {
        delete ctx.session.temp.awaitingBulkUpload;
        await ctx.saveSession();
      }
      // Redirect back to bulk upload panel
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) return;

      await ctx.editMessageText(
        '`❌ Upload Cancelled`',
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('🔙 Back', 'admin_bulk_upload_places')],
          ]),
        }
      );
    } catch (error) {
      logger.error('Error cancelling bulk upload:', error);
    }
  });

  bot.on('document', async (ctx, next) => {
    try {
      if (ctx.chat?.type && ctx.chat.type !== 'private') return next();
      if (!ctx.session?.temp?.awaitingBulkUpload) return next();

      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) {
        delete ctx.session.temp.awaitingBulkUpload;
        await ctx.saveSession();
        return next();
      }

      const doc = ctx.message.document;

      // Validate file
      if (!doc.file_name || !doc.file_name.toLowerCase().endsWith('.csv')) {
        await ctx.reply('Please send a CSV file (.csv extension).');
        return;
      }

      if (doc.file_size > 1024 * 1024) {
        await ctx.reply('File too large. Maximum size is 1 MB.');
        return;
      }

      // Clear session flag
      delete ctx.session.temp.awaitingBulkUpload;
      await ctx.saveSession();

      await ctx.reply('Processing CSV file...');

      // Download file
      const fileLink = await ctx.telegram.getFileLink(doc.file_id);
      const response = await fetch(fileLink.href);
      const csvText = await response.text();

      // Parse CSV
      let records;
      try {
        records = parse(csvText, {
          columns: true,
          skip_empty_lines: true,
          trim: true,
          bom: true,
        });
      } catch (parseError) {
        await ctx.reply(`CSV parse error: ${parseError.message}`);
        return;
      }

      if (records.length === 0) {
        await ctx.reply('CSV file is empty (no data rows found).');
        return;
      }

      // Load categories and build slug->id map
      const categories = await NearbyPlaceCategoryModel.getAll(false);
      const categoryMap = {};
      for (const cat of categories) {
        categoryMap[cat.slug] = cat.id;
      }

      const errors = [];
      let created = 0;

      for (let i = 0; i < records.length; i++) {
        const row = records[i];
        const rowNum = i + 2; // +2 because row 1 is headers, data starts at row 2
        const rowErrors = [];

        // Validate required fields
        if (!row.name || !row.name.trim()) {
          rowErrors.push('missing name');
        }
        if (!row.place_type || !['business', 'place_of_interest'].includes(row.place_type.trim())) {
          rowErrors.push('invalid place_type (must be business or place_of_interest)');
        }
        if (!row.category_slug || !categoryMap[row.category_slug.trim()]) {
          rowErrors.push(`invalid category_slug "${row.category_slug || ''}"`);
        }

        // Validate lat/lng if provided
        let lat = null;
        let lng = null;
        if (row.lat && row.lat.trim()) {
          lat = parseFloat(row.lat);
          if (isNaN(lat) || lat < -90 || lat > 90) {
            rowErrors.push('invalid lat (must be -90 to 90)');
            lat = null;
          }
        }
        if (row.lng && row.lng.trim()) {
          lng = parseFloat(row.lng);
          if (isNaN(lng) || lng < -180 || lng > 180) {
            rowErrors.push('invalid lng (must be -180 to 180)');
            lng = null;
          }
        }

        if (rowErrors.length > 0) {
          errors.push(`Row ${rowNum}: ${rowErrors.join(', ')}`);
          continue;
        }

        // Build location object
        let location = null;
        if (lat !== null && lng !== null) {
          location = { lat, lng };
        }

        // Build place data
        const isCommunityOwned = row.is_community_owned
          && ['true', '1', 'yes'].includes(row.is_community_owned.trim().toLowerCase());

        try {
          await NearbyPlaceModel.create({
            name: row.name.trim(),
            placeType: row.place_type.trim(),
            categoryId: categoryMap[row.category_slug.trim()],
            address: row.address?.trim() || null,
            city: row.city?.trim() || null,
            country: row.country?.trim() || null,
            location,
            description: row.description?.trim() || null,
            phone: row.phone?.trim() || null,
            email: row.email?.trim() || null,
            website: row.website?.trim() || null,
            telegramUsername: row.telegram_username?.trim() || null,
            instagram: row.instagram?.trim() || null,
            priceRange: row.price_range?.trim() || null,
            isCommunityOwned,
            status: 'approved',
          });
          created++;
        } catch (createError) {
          errors.push(`Row ${rowNum}: ${createError.message}`);
        }
      }

      // Build summary
      let summary = `*Bulk Upload Complete*\n\n`;
      summary += `Created: ${created}/${records.length} places\n`;

      if (errors.length > 0) {
        summary += `\n*Errors (${errors.length}):*\n`;
        const errorText = errors.slice(0, 20).map(e => `• ${e}`).join('\n');
        summary += errorText;
        if (errors.length > 20) {
          summary += `\n_...and ${errors.length - 20} more errors_`;
        }
      }

      await ctx.reply(summary, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('📋 View Places', 'admin_all_places')],
          [Markup.button.callback('🔙 Back', 'admin_nearby_places')],
        ]),
      });
    } catch (error) {
      logger.error('Error processing bulk upload:', error);
      await ctx.reply('Error processing CSV file. Please check the format and try again.');
    }
  });

  // ===========================================
  // HELPER FUNCTIONS
  // ===========================================
  function escapeMarkdown(text) {
    if (!text) return '';
    return text.replace(/[_*[\]()~`>#+=|{}.!-]/g, '\\$&');
  }
};

module.exports = registerNearbyPlacesAdminHandlers;
