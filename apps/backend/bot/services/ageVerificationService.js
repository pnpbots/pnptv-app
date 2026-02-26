const axios = require('axios');
const logger = require('../../utils/logger');

/**
 * Age Verification Service - Handles AI-based age verification using Face++ API
 */
class AgeVerificationService {
  /**
   * Verify age from photo using Face++ API
   * @param {Buffer} photoBuffer - Photo file buffer
   * @param {string} userId - User ID for logging
   * @returns {Promise<Object>} Verification result
   */
  static async verifyPhotoAge(photoBuffer, userId) {
    try {
      const faceApiKey = process.env.FACE_API_KEY || process.env.FACEPP_API_KEY;
      const faceApiSecret = process.env.FACE_API_SECRET || process.env.FACEPP_API_SECRET;

      if (!faceApiKey || !faceApiSecret) {
        logger.warn('Face++ API credentials not configured', { userId });
        return {
          success: false,
          ageVerified: false,
          error: 'Age verification service not configured'
        };
      }

      // Call Face++ API to detect faces and estimate age
      const FormData = require('form-data');
      const formData = new FormData();
      formData.append('api_key', faceApiKey);
      formData.append('api_secret', faceApiSecret);
      formData.append('return_attributes', 'age,gender');
      formData.append('image_base64', photoBuffer.toString('base64'));

      const response = await axios.post(
        'https://api-us.faceplusplus.com/facepp/v3/detect',
        formData,
        {
          headers: formData.getHeaders(),
          timeout: 30000
        }
      );

      if (!response.data || !response.data.faces || response.data.faces.length === 0) {
        logger.warn('No face detected in photo', { userId });
        return {
          success: false,
          ageVerified: false,
          estimatedAge: null,
          confidence: 0,
          error: 'No face detected'
        };
      }

      const faceData = response.data.faces[0];
      const attributes = faceData.attributes || {};
      const estimatedAge = attributes.age?.value || null;
      const confidence = faceData.confidence || 0;

      // Check if age is 18 or older
      const ageVerified = estimatedAge && estimatedAge >= 18;

      logger.info('Age verification completed', {
        userId,
        estimatedAge,
        confidence,
        ageVerified
      });

      return {
        success: true,
        ageVerified,
        estimatedAge,
        confidence: Math.round(confidence),
        gender: attributes.gender?.value,
        error: null
      };

    } catch (error) {
      const errorMessage = error?.message || error?.response?.data?.error || 'Age verification failed';
      const errorDetails = {
        message: errorMessage,
        status: error?.response?.status,
        userId
      };
      logger.error('Error in age verification:', errorDetails);

      // Return graceful response based on error type
      if (error?.response?.status === 401 || error?.response?.status === 403) {
        return {
          success: false,
          ageVerified: false,
          error: 'Service temporarily unavailable - please try again or use manual verification'
        };
      }

      return {
        success: false,
        ageVerified: false,
        error: 'Could not verify age from photo - please try again or use manual verification'
      };
    }
  }

  /**
   * Fallback method - simple age confirmation without AI
   * @param {string} userId - User ID
   * @returns {Object} Confirmation result
   */
  static confirmAgeManually(userId) {
    logger.info('Manual age confirmation', { userId });
    return {
      success: true,
      ageVerified: true,
      estimatedAge: null,
      confidence: 0,
      method: 'manual'
    };
  }
}

module.exports = AgeVerificationService;
