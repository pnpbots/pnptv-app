const ageVerificationService = require('../../../services/ageVerificationService');
const logger = require('../../../utils/logger');
const path = require('path');

/**
 * Age Verification Controller - Handles camera-based age verification
 */
class AgeVerificationController {
  /**
   * Verify age using camera photo
   * POST /api/verify-age
   */
  static async verifyAge(req, res) {
    try {
      // Use authenticated session user — never trust client-supplied user_id
      const userId = req.user?.id;

      if (!userId) {
        return res.status(401).json({
          success: false,
          error: 'Authentication required',
        });
      }

      if (!req.file) {
        return res.status(400).json({
          success: false,
          error: 'Photo is required',
        });
      }

      logger.info('Age verification request received', { userId });

      // Call age verification service with the photo
      const verificationResult = await ageVerificationService.verifyPhotoAge(
        req.file.buffer,
        userId,
        {
          fallbackPhotoId: `web_upload_${Date.now()}`,
        }
      );

      if (!verificationResult) {
        logger.warn('Age verification failed - no result', { userId });
        return res.status(400).json({
          success: false,
          error: 'Could not verify age from photo',
          ageVerified: false,
        });
      }

      if (verificationResult.ageVerified && req.session?.user) {
        req.session.user.ageVerified = true;
      }

      return res.json({
        success: Boolean(verificationResult.success),
        ageVerified: Boolean(verificationResult.ageVerified),
        estimatedAge: verificationResult.age || verificationResult.estimatedAge || null,
        confidence: verificationResult.confidence || null,
        error: verificationResult.error || null,
        message: verificationResult.message || (
          verificationResult.ageVerified
            ? 'Age verified successfully'
            : 'Could not verify age - please try again or use manual verification'
        ),
      });

    } catch (error) {
      logger.error('Error in age verification:', error);
      return res.status(500).json({
        success: false,
        error: 'Age verification service error',
      });
    }
  }

  /**
   * Get age verification web page
   * GET /age-verification-camera.html
   */
  static async getAgeVerificationPage(req, res) {
    try {
      const filePath = path.join(
        __dirname,
        '../../../public/age-verification-camera.html'
      );

      res.sendFile(filePath);

    } catch (error) {
      logger.error('Error getting age verification page:', error);
      res.status(500).json({
        success: false,
        error: 'Error loading age verification page'
      });
    }
  }
}

module.exports = AgeVerificationController;
