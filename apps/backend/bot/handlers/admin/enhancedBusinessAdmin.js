const { Markup } = require('telegraf');
const NearbyPlaceService = require('../../services/nearbyPlaceService');
const UserService = require('../../services/userService');
const NotificationService = require('../../services/notificationService');
const PermissionService = require('../../services/permissionService');
const logger = require('../../../utils/logger');

/**
 * Enhanced Business Approval System - World Class Admin Interface
 * @param {Telegraf} bot - Bot instance
 */
const registerEnhancedBusinessAdminHandlers = (bot) => {
  
  // ===========================================
  // ENHANCED ADMIN DASHBOARD
  // ===========================================
  bot.action('admin_business_dashboard', async (ctx) => {
    try {
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) return;

      // Get comprehensive statistics
      const [stats, pending, recentApproved, recentRejected] = await Promise.all([
        NearbyPlaceService.getStats(),
        NearbyPlaceService.countPending(),
        NearbyPlaceService.getRecentApproved(5),
        NearbyPlaceService.getRecentRejected(5)
      ]);

      const adminName = await getAdminName(ctx.from.id);

      let text = '`🏪 Business Admin Dashboard`\n\n';
      text += `*Welcome, ${adminName}*\n\n`;
      text += '📊 *Quick Stats:*\n';
      text += `├ Total Businesses: ${stats.places?.approved || 0}\n`;
      text += `├ Pending Review: ${pending}\n`;
      text += `├ Rejected: ${stats.places?.rejected || 0}\n`;
      text += `├ Total Submissions: ${stats.submissions?.total || 0}\n`;
      text += `└ Total Views: ${stats.places?.total_views || 0}\n\n`;

      if (pending > 0) {
        text += '⚠️ *Action Required:*\n';
        text += `${pending} business${pending !== 1 ? 'es' : ''} waiting for your review\n\n`;
      }

      if (recentApproved.length > 0) {
        text += '📈 *Recently Approved:*\n';
        recentApproved.slice(0, 3).forEach(biz => {
          text += `├ ${biz.categoryEmoji || '🏪'} ${biz.name}\n`;
        });
        text += '└ ...\n\n';
      }

      const buttons = [
        [
          Markup.button.callback(
            `📥 Review Pending (${pending})`,
            'admin_review_business_submissions'
          )
        ],
        [
          Markup.button.callback('📋 All Businesses', 'admin_all_businesses'),
          Markup.button.callback('📊 Detailed Stats', 'admin_business_stats_detailed')
        ],
        [
          Markup.button.callback('⚙️ Settings', 'admin_business_settings'),
          Markup.button.callback('📋 Submission Logs', 'admin_business_submission_logs')
        ],
        [Markup.button.callback('🔙 Back to Admin Panel', 'admin_home')],
      ];

      await ctx.editMessageText(text, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard(buttons),
      });
    } catch (error) {
      logger.error('Error showing business admin dashboard:', error);
    }
  });

  // ===========================================
  // ENHANCED SUBMISSION REVIEW LIST
  // ===========================================
  bot.action('admin_review_business_submissions', async (ctx) => {
    try {
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) return;

      const submissions = await NearbyPlaceService.getPendingSubmissions(25);
      const businessSubmissions = submissions.filter(s => s.placeType === 'business');

      if (businessSubmissions.length === 0) {
        await ctx.editMessageText(
          '`✅ No Pending Business Submissions`\n\n' +
          'All business submissions have been reviewed.\n\n' +
          '*Quick Actions:*',
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
              [Markup.button.callback('🔄 Refresh', 'admin_review_business_submissions')],
              [Markup.button.callback('📋 View All Businesses', 'admin_all_businesses')],
              [Markup.button.callback('🔙 Back', 'admin_business_dashboard')],
            ]),
          }
        );
        return;
      }

      let text = '`📥 Business Submissions Pending Review`\n\n';
      text += `Found ${businessSubmissions.length} pending business submission${businessSubmissions.length !== 1 ? 's' : ''}:\n\n`;
      text += '*Sort by:* Quality Score 🌟\n\n';

      const buttons = [];
      
      // Sort by quality score (if available)
      const sortedSubmissions = businessSubmissions.sort((a, b) => {
        const scoreA = a.metadata?.submissionQuality || 1;
        const scoreB = b.metadata?.submissionQuality || 1;
        return scoreB - scoreA; // Higher quality first
      });

      sortedSubmissions.slice(0, 12).forEach((s, i) => {
        const qualityStars = getQualityStars(s.metadata?.submissionQuality || 1);
        const submitterInfo = s.submitterUsername ? `@${s.submitterUsername}` : `ID:${s.submittedByUserId}`;
        
        buttons.push([
          Markup.button.callback(
            `${i + 1}. ${qualityStars} ${s.categoryEmoji || '🏪'} ${s.name.substring(0, 20)}${s.name.length > 20 ? '...' : ''} - ${submitterInfo}`,
            `admin_review_business_sub_${s.id}`
          )
        ]);
      });

      if (businessSubmissions.length > 12) {
        text += `_...and ${businessSubmissions.length - 12} more_\n\n`;
      }

      // Add bulk actions
      if (businessSubmissions.length > 1) {
        buttons.push([
          Markup.button.callback('✅ Approve All High Quality', `admin_bulk_approve_high_quality`),
          Markup.button.callback('❌ Reject All Low Quality', `admin_bulk_reject_low_quality`)
        ]);
      }

      buttons.push([
        Markup.button.callback('🔄 Refresh List', 'admin_review_business_submissions'),
        Markup.button.callback('🔙 Back', 'admin_business_dashboard')
      ]);

      await ctx.editMessageText(text, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard(buttons),
      });
    } catch (error) {
      logger.error('Error showing business submissions review:', error);
    }
  });

  // ===========================================
  // ENHANCED SINGLE SUBMISSION REVIEW
  // ===========================================
  bot.action(/^admin_review_business_sub_(\d+)$/, async (ctx) => {
    try {
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) return;

      const submissionId = parseInt(ctx.match[1]);
      const submission = await NearbyPlaceService.getSubmissionDetails(submissionId);

      if (!submission) {
        await ctx.answerCbQuery('Submission not found or already processed');
        return;
      }

      // Calculate quality score and provide admin guidance
      const qualityScore = submission.metadata?.submissionQuality || calculateSubmissionQuality(submission);
      const qualityStars = getQualityStars(qualityScore);
      const adminGuidance = getAdminGuidance(submission, qualityScore);

      let text = '`📋 Business Submission Review`\n\n';
      text += `*${qualityStars} Quality: ${qualityScore}/5*\n\n`;
      text += `*Business Name:* ${escapeMarkdown(submission.name)}\n`;
      text += `*Category:* ${submission.categoryEmoji || '🏪'} ${submission.categoryName || 'N/A'}\n`;
      text += `*Type:* ${submission.placeType}\n\n`;

      if (submission.description) {
        text += `*Description:*\n${escapeMarkdown(submission.description)}\n\n`;
      }

      text += `*Address:* ${submission.address || 'N/A'}\n`;
      text += `*City:* ${submission.city || 'N/A'}\n`;
      text += `*Country:* ${submission.country || 'N/A'}\n`;

      if (submission.location) {
        text += `*GPS:* ${submission.location.lat.toFixed(4)}, ${submission.location.lng.toFixed(4)}\n`;
      }

      text += '\n*Contact Information:*\n';
      const contactMethods = [];
      if (submission.phone) contactMethods.push(`📞 ${submission.phone}`);
      if (submission.website) contactMethods.push(`🌐 ${submission.website}`);
      if (submission.telegramUsername) contactMethods.push(`💬 @${submission.telegramUsername}`);
      if (submission.instagram) contactMethods.push(`📸 @${submission.instagram}`);
      if (submission.email) contactMethods.push(`✉️ ${submission.email}`);
      
      if (contactMethods.length > 0) {
        text += contactMethods.join('\n') + '\n\n';
      } else {
        text += '❌ No contact information\n\n';
      }

      if (submission.hoursOfOperation) {
        text += `*Business Hours:*\n${formatBusinessHours(submission.hoursOfOperation)}\n\n`;
      }

      text += `*Submitted by:* @${submission.submitterUsername || submission.submittedByUserId}\n`;
      text += `*Submitted:* ${new Date(submission.submittedAt).toLocaleString()}\n`;
      text += `*User Tier:* ${submission.userTier || 'basic'}\n\n`;

      // Add admin guidance
      if (adminGuidance) {
        text += `*💡 Admin Guidance:*\n${adminGuidance}\n\n`;
      }

      const buttons = [
        [
          Markup.button.callback('✅ Approve', `admin_approve_business_sub_${submissionId}`),
          Markup.button.callback('❌ Reject', `admin_reject_business_sub_${submissionId}`),
        ],
      ];

      // Add quick actions based on quality
      if (qualityScore >= 4) {
        buttons.push([
          Markup.button.callback('✅ Quick Approve (High Quality)', `admin_quick_approve_${submissionId}`),
        ]);
      } else if (qualityScore <= 2) {
        buttons.push([
          Markup.button.callback('❌ Quick Reject (Low Quality)', `admin_quick_reject_${submissionId}`),
        ]);
      }

      // Add map link if location available
      if (submission.location) {
        buttons.push([
          Markup.button.url(
            '🗺️ View on Google Maps',
            `https://www.google.com/maps/search/?api=1&query=${submission.location.lat},${submission.location.lng}`
          ),
        ]);
      }

      // Add submitter profile link
      buttons.push([
        Markup.button.callback(
          '👤 View Submitter Profile',
          `admin_view_submitter_${submission.submittedByUserId}`
        ),
      ]);

      buttons.push([
        Markup.button.callback('🔙 Back to List', 'admin_review_business_submissions'),
      ]);

      // Send with photo if available
      if (submission.photoFileId) {
        try {
          await ctx.deleteMessage().catch(() => {});
          await ctx.replyWithPhoto(submission.photoFileId, {
            caption: text,
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard(buttons),
          });
        } catch (photoError) {
          logger.error('Error sending business photo in review:', photoError);
          await ctx.editMessageText(text, {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard(buttons),
          });
        }
      } else {
        await ctx.editMessageText(text, {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard(buttons),
        });
      }
    } catch (error) {
      logger.error('Error showing business submission review:', error);
    }
  });

  // ===========================================
  // ENHANCED APPROVAL PROCESS
  // ===========================================
  bot.action(/^admin_approve_business_sub_(\d+)$/, async (ctx) => {
    try {
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) return;

      const submissionId = parseInt(ctx.match[1]);
      const adminUserId = ctx.from.id.toString();

      await ctx.editMessageText('`⏳ Processing approval...`', { parse_mode: 'Markdown' });

      const result = await NearbyPlaceService.approveSubmission(submissionId, adminUserId);

      if (result.success) {
        // Send enhanced notification to submitter
        try {
          await NotificationService.notifySubmissionStatus(
            result.submission.submittedByUserId,
            submissionId,
            'approved'
          );
        } catch (notifyError) {
          logger.error('Error notifying user of approval:', notifyError);
        }

        // Send admin confirmation
        const adminName = await getAdminName(adminUserId);
        
        await ctx.editMessageText(
          '`✅ Business Approved Successfully`\n\n' +
          `🏪 *${escapeMarkdown(result.place.name)}*\n\n` +
          `*Place ID:* ${result.place.id}\n` +
          `*Category:* ${result.place.categoryEmoji || '🏪'} ${result.place.categoryName}\n` +
          `*Approved by:* ${adminName}\n\n` +
          '*Next Steps:*\n' +
          '✅ Business is now live in the directory\n' +
          '✅ Submitter has been notified\n' +
          '✅ Submitter gains community recognition\n\n' +
          '*Quick Actions:*',
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
              [Markup.button.callback('📥 Review Next', 'admin_review_business_submissions')],
              [Markup.button.callback('👁️ View Live Business', `view_place_${result.place.id}`)],
              [Markup.button.callback('📊 View Stats', 'admin_business_dashboard')],
              [Markup.button.callback('🔙 Back', 'admin_business_dashboard')],
            ]),
          }
        );
      } else {
        await ctx.editMessageText(
          '`❌ Approval Failed`\n\n' +
          `*Error:* ${result.error}\n\n` +
          '*Options:*',
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
              [Markup.button.callback('🔄 Try Again', `admin_approve_business_sub_${submissionId}`)],
              [Markup.button.callback('📋 View Submission', `admin_review_business_sub_${submissionId}`)],
              [Markup.button.callback('🆘 Report Issue', 'admin_report_issue')],
            ]),
          }
        );
      }
    } catch (error) {
      logger.error('Error approving business submission:', error);
      await ctx.answerCbQuery('Error approving submission');
    }
  });

  // Quick approve for high-quality submissions
  bot.action(/^admin_quick_approve_(\d+)$/, async (ctx) => {
    try {
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) return;

      const submissionId = parseInt(ctx.match[1]);
      const adminUserId = ctx.from.id.toString();

      await ctx.answerCbQuery('Quick approving high-quality submission...');
      
      // Call regular approval
      ctx.callbackQuery.data = `admin_approve_business_sub_${submissionId}`;
      await bot.handleUpdate(ctx.update);
    } catch (error) {
      logger.error('Error quick approving submission:', error);
    }
  });

  // ===========================================
  // ENHANCED REJECTION PROCESS
  // ===========================================
  bot.action(/^admin_reject_business_sub_(\d+)$/, async (ctx) => {
    try {
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) return;

      const submissionId = parseInt(ctx.match[1]);
      const submission = await NearbyPlaceService.getSubmissionDetails(submissionId);

      // Store in session for custom reason
      ctx.session.temp = ctx.session.temp || {};
      ctx.session.temp.rejectingSubmissionId = submissionId;
      ctx.session.temp.rejectingSubmissionName = submission?.name || 'Unknown';
      await ctx.saveSession();

      // Provide smart rejection reasons based on submission quality
      const qualityScore = submission.metadata?.submissionQuality || calculateSubmissionQuality(submission);
      const smartReasons = getSmartRejectionReasons(submission, qualityScore);

      await ctx.editMessageText(
        '`❌ Reject Business Submission`\n\n' +
        `*Business:* ${escapeMarkdown(submission.name)}\n` +
        `*Quality Score:* ${qualityScore}/5\n\n` +
        'Select a rejection reason:\n' +
        '_This reason will be sent to the submitter with guidance for improvement._',
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('🔄 Duplicate Business', `admin_reject_reason_duplicate_${submissionId}`)],
            [Markup.button.callback('⚠️ Inappropriate Content', `admin_reject_reason_inappropriate_${submissionId}`)],
            [Markup.button.callback('📍 Invalid Location', `admin_reject_reason_location_${submissionId}`)],
            [Markup.button.callback('📝 Incomplete Information', `admin_reject_reason_incomplete_${submissionId}`)],
            [Markup.button.callback('📞 Invalid Contact Info', `admin_reject_reason_contact_${submissionId}`)],
            [Markup.button.callback('🔞 Wrong Category', `admin_reject_reason_category_${submissionId}`)],
            [Markup.button.callback('🖼️ Poor Quality Media', `admin_reject_reason_media_${submissionId}`)],
            ...smartReasons,
            [Markup.button.callback('✏️ Custom Reason...', `admin_reject_custom_${submissionId}`)],
            [Markup.button.callback('🔙 Back', `admin_review_business_sub_${submissionId}`)],
          ]),
        }
      );
    } catch (error) {
      logger.error('Error showing business rejection options:', error);
    }
  });

  // Smart rejection with preset reasons
  bot.action(/^admin_reject_reason_(duplicate|inappropriate|location|incomplete|contact|category|media)_(\d+)$/, async (ctx) => {
    try {
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) return;

      const reasonType = ctx.match[1];
      const submissionId = parseInt(ctx.match[2]);
      const adminUserId = ctx.from.id.toString();

      const reasonMap = {
        duplicate: {
          en: 'This business already exists in our directory. Please check existing listings before submitting.',
          es: 'Este negocio ya existe en nuestro directorio. Por favor verifica los listados existentes antes de enviar.'
        },
        inappropriate: {
          en: 'This submission violates our community guidelines. Please review our guidelines and resubmit if appropriate.',
          es: 'Esta propuesta viola nuestras guías comunitarias. Por favor revisa nuestras guías y vuelve a enviar si es apropiado.'
        },
        location: {
          en: 'The location information is invalid or incomplete. Please provide a complete, accurate address with GPS coordinates.',
          es: 'La información de ubicación es inválida o incompleta. Por favor proporciona una dirección completa y exacta con coordenadas GPS.'
        },
        incomplete: {
          en: 'The submission is missing required information. Please provide complete details including description, contact info, and business hours.',
          es: 'La propuesta está faltando información requerida. Por favor proporciona detalles completos incluyendo descripción, información de contacto y horario.'
        },
        contact: {
          en: 'The contact information provided is invalid or incomplete. Please provide at least 2 valid contact methods.',
          es: 'La información de contacto proporcionada es inválida o incompleta. Por favor proporciona al menos 2 métodos de contacto válidos.'
        },
        category: {
          en: 'This business was submitted to the wrong category. Please select the appropriate category for this type of business.',
          es: 'Este negocio fue enviado a la categoría equivocada. Por favor selecciona la categoría apropiada para este tipo de negocio.'
        },
        media: {
          en: 'The submitted media does not meet our quality standards. Please provide clear, well-lit photos of the business.',
          es: 'El material enviado no cumple con nuestros estándares de calidad. Por favor proporciona fotos claras y bien iluminadas del negocio.'
        }
      };

      const submission = await NearbyPlaceService.getSubmissionDetails(submissionId);
      const lang = submission?.metadata?.language || 'en';
      const langKey = ['en', 'es'].includes(lang) ? lang : 'en';
      const reason = reasonMap[reasonType][langKey];

      await ctx.editMessageText('`⏳ Processing rejection...`', { parse_mode: 'Markdown' });

      const result = await NearbyPlaceService.rejectSubmission(submissionId, adminUserId, reason);

      if (result.success) {
        // Send enhanced notification to submitter
        try {
          await NotificationService.notifySubmissionStatus(
            result.submission.submittedByUserId,
            submissionId,
            'rejected',
            reason
          );
        } catch (notifyError) {
          logger.error('Error notifying user of rejection:', notifyError);
        }

        const adminName = await getAdminName(adminUserId);
        
        await ctx.editMessageText(
          '`❌ Business Rejected`\n\n' +
          `*Business:* ${escapeMarkdown(submission.name)}\n` +
          `*Reason:* ${reasonType}\n` +
          `*Rejected by:* ${adminName}\n\n` +
          '*Actions Taken:*\n' +
          '✅ Submitter has been notified with improvement guidance\n' +
          '✅ Submission moved to rejected archive\n' +
          '✅ Admin logs updated\n\n' +
          '*Next Steps:*',
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
              [Markup.button.callback('📥 Review Next', 'admin_review_business_submissions')],
              [Markup.button.callback('📋 View All Rejected', 'admin_rejected_submissions')],
              [Markup.button.callback('🔙 Back', 'admin_business_dashboard')],
            ]),
          }
        );
      } else {
        await ctx.editMessageText(
          '`❌ Rejection Failed`\n\n' +
          `*Error:* ${result.error}`,
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
              [Markup.button.callback('🔄 Try Again', `admin_reject_business_sub_${submissionId}`)],
              [Markup.button.callback('📋 View Submission', `admin_review_business_sub_${submissionId}`)],
            ]),
          }
        );
      }
    } catch (error) {
      logger.error('Error rejecting business submission:', error);
      await ctx.answerCbQuery('Error rejecting submission');
    }
  });

  // ===========================================
  // HELPER FUNCTIONS
  // ===========================================

  async function getAdminName(adminUserId) {
    try {
      const admin = await UserService.getById(adminUserId);
      return admin?.firstName || admin?.username || `Admin ${adminUserId}`;
    } catch (error) {
      logger.error('Error getting admin name:', error);
      return `Admin ${adminUserId}`;
    }
  }

  function getQualityStars(score) {
    const fullStars = Math.floor(score);
    const halfStar = score % 1 >= 0.5 ? '✩' : '';
    const emptyStars = 5 - Math.ceil(score);
    
    return '🌟'.repeat(fullStars) + halfStar + '✩'.repeat(emptyStars);
  }

  function calculateSubmissionQuality(submission) {
    let score = 1; // Base score
    
    // Add points for completeness
    if (submission.description && submission.description.length > 50) score += 0.5;
    if (submission.description && submission.description.length > 100) score += 0.5;
    if (submission.address && submission.address.length > 10) score += 0.5;
    if (submission.city) score += 0.3;
    if (submission.country) score += 0.2;
    if (submission.location) score += 0.5;
    if (submission.hoursOfOperation) score += 0.5;
    if (submission.photoFileId) score += 0.8;
    
    // Add points for contact methods
    const contactMethods = [];
    if (submission.phone) contactMethods.push('phone');
    if (submission.email) contactMethods.push('email');
    if (submission.website) contactMethods.push('website');
    if (submission.telegramUsername) contactMethods.push('telegram');
    if (submission.instagram) contactMethods.push('instagram');
    
    if (contactMethods.length >= 1) score += 0.5;
    if (contactMethods.length >= 2) score += 0.5;
    if (contactMethods.length >= 3) score += 0.3;
    
    return Math.min(5, Math.round(score * 10) / 10); // Max 5, rounded to 1 decimal
  }

  function getAdminGuidance(submission, qualityScore) {
    const guidance = [];
    
    if (qualityScore >= 4) {
      guidance.push('✅ High-quality submission - ready for approval!');
    }
    
    if (!submission.photoFileId) {
      guidance.push('⚠️ No photo provided - businesses with photos get 3x more views');
    }
    
    const contactMethods = [];
    if (submission.phone) contactMethods.push('phone');
    if (submission.email) contactMethods.push('email');
    if (submission.website) contactMethods.push('website');
    if (submission.telegramUsername) contactMethods.push('telegram');
    if (submission.instagram) contactMethods.push('instagram');
    
    if (contactMethods.length < 2) {
      guidance.push(`⚠️ Only ${contactMethods.length} contact method${contactMethods.length === 1 ? '' : 's'} - recommend at least 2`);
    }
    
    if (!submission.hoursOfOperation) {
      guidance.push('ℹ️ No business hours provided - consider requesting this information');
    }
    
    if (!submission.description || submission.description.length < 50) {
      guidance.push('⚠️ Description is too short - should be 50+ characters for good SEO');
    }
    
    return guidance.length > 0 ? guidance.join('\n') : null;
  }

  function getSmartRejectionReasons(submission, qualityScore) {
    const reasons = [];
    
    // If quality is very low, suggest quick rejection
    if (qualityScore <= 1) {
      reasons.push([
        Markup.button.callback('❌ Quick Reject (Very Low Quality)', `admin_reject_reason_incomplete_${submission.id}`)
      ]);
    }
    
    // If no photo and quality is medium
    if (qualityScore <= 3 && !submission.photoFileId) {
      reasons.push([
        Markup.button.callback('🖼️ Reject: No Photo', `admin_reject_reason_media_${submission.id}`)
      ]);
    }
    
    // If description is too short
    if (submission.description && submission.description.length < 30) {
      reasons.push([
        Markup.button.callback('📝 Reject: Poor Description', `admin_reject_reason_incomplete_${submission.id}`)
      ]);
    }
    
    return reasons;
  }

  function formatBusinessHours(hours) {
    if (typeof hours === 'string') return hours;
    if (!hours || typeof hours !== 'object') return 'Not specified';
    
    try {
      return Object.entries(hours).map(([day, time]) => {
        if (!time || time === 'closed') return `${day}: Closed`;
        return `${day}: ${time}`;
      }).join('\n');
    } catch (error) {
      return 'Not specified';
    }
  }

  function escapeMarkdown(text) {
    if (!text) return '';
    return text.replace(/[_*\\[\]()~`>#+=|{}.!-]/g, '\\$&');
  }
};

module.exports = registerEnhancedBusinessAdminHandlers;
