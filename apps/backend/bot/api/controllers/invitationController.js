const GroupInvitationService = require('../../services/groupInvitationService');
const logger = require('../../../utils/logger');

/**
 * Invitation Controller - Handles group invitation endpoints
 */
class InvitationController {
  /**
   * Verify and consume group invitation token
   * GET /api/join-group/:token
   */
  static async verifyGroupInvitation(req, res) {
    try {
      const { token } = req.params;

      if (!token) {
        return res.status(400).json({
          success: false,
          error: 'Invitation token is required',
        });
      }

      // Verify the invitation
      const invitationData = await GroupInvitationService.verifyInvitation(token);

      if (!invitationData) {
        logger.warn('Invalid or expired group invitation used', { tokenPrefix: token.substring(0, 8) + '...' });
        return res.status(400).json({
          success: false,
          error: 'Invalid or expired invitation link. Please contact support to get a new one.',
        });
      }

      // Consume the invitation (mark as used)
      const consumed = await GroupInvitationService.consumeInvitation(token);

      if (!consumed) {
        logger.warn('Failed to consume group invitation', { tokenPrefix: token.substring(0, 8) + '...' });
        return res.status(400).json({
          success: false,
          error: 'This invitation link has already been used.',
        });
      }

      logger.info('Group invitation verified and consumed', {
        userId: invitationData.user_id,
        groupType: invitationData.group_type,
      });

      // Return success with group information
      res.json({
        success: true,
        message: 'Invitation verified successfully',
        invitation: {
          userId: invitationData.user_id,
          groupType: invitationData.group_type,
          groupLink: `https://t.me/${invitationData.group_type === 'free' ? 'pnptv_community' : 'pnptv_premium'}`,
        },
      });
    } catch (error) {
      logger.error('Error verifying group invitation:', {
        error: error.message,
        stack: error.stack,
        token: req.params.token?.substring(0, 8) + '...',
      });

      res.status(500).json({
        success: false,
        error: 'Error processing invitation. Please try again or contact support.',
      });
    }
  }

  /**
   * Redirect to group based on invitation token
   * GET /join-group/:token
   */
  static async redirectToGroup(req, res) {
    try {
      const { token } = req.params;

      if (!token) {
        return res.status(400).send('Invalid invitation link');
      }

      // Verify the invitation
      const invitationData = await GroupInvitationService.verifyInvitation(token);

      if (!invitationData) {
        return res.status(400).send(
          'This invitation link is invalid or has expired. Please contact support.'
        );
      }

      // Consume the invitation
      const consumed = await GroupInvitationService.consumeInvitation(token);

      if (!consumed) {
        return res.status(400).send(
          'This invitation link has already been used.'
        );
      }

      logger.info('User redirected to group via invitation', {
        userId: invitationData.user_id,
        groupType: invitationData.group_type,
      });

      // Redirect to appropriate Telegram group
      const groupLink = invitationData.group_type === 'free'
        ? 'https://t.me/pnptv_community'
        : 'https://t.me/pnptv_premium';

      res.redirect(groupLink);
    } catch (error) {
      logger.error('Error processing group invitation redirect:', {
        error: error.message,
        token: req.params.token?.substring(0, 8) + '...',
      });

      res.status(500).send('Error processing invitation. Please try again.');
    }
  }
}

module.exports = InvitationController;
