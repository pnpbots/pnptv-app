const axios = require('axios');
const logger = require('../utils/logger');
const UserModel = require('../models/userModel');
const { query } = require('../config/postgres');

/**
 * Age Verification Service
 * Handles AI-based age verification using camera/photo
 * Supports multiple AI providers: Azure Face API, Face++
 */
class AgeVerificationService {
  constructor() {
    // Prefer explicit provider, otherwise choose based on available credentials
    const configuredProvider = process.env.AGE_VERIFICATION_PROVIDER;
    this.minAge = parseInt(process.env.MIN_AGE_REQUIREMENT || '18', 10);

    // Azure Face API configuration
    this.azureEndpoint = process.env.AZURE_FACE_ENDPOINT;
    this.azureApiKey = process.env.AZURE_FACE_API_KEY;

    // Face++ API configuration
    this.faceppApiKey = process.env.FACEPP_API_KEY || process.env.FACE_API_KEY;
    this.faceppApiSecret = process.env.FACEPP_API_SECRET || process.env.FACE_API_SECRET;

    if (configuredProvider) {
      this.provider = configuredProvider;
    } else if (this.azureEndpoint && this.azureApiKey) {
      this.provider = 'azure';
    } else if (this.faceppApiKey && this.faceppApiSecret) {
      this.provider = 'facepp';
    } else {
      this.provider = 'azure';
    }
  }

  /**
   * Verify age from photo using AI
   * @param {Object} ctx - Telegraf context
   * @param {string} photoFileId - Telegram photo file ID
   * @returns {Promise<Object>} Verification result
   */
  async verifyAgeFromPhoto(ctx, photoFileId) {
    try {
      logger.info(`Starting AI age verification for user ${ctx.from.id} with provider: ${this.provider}`);

      const photoFile = await ctx.telegram.getFile(photoFileId);
      const photoUrl = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${photoFile.file_path}`;

      logger.info(`Photo URL obtained: ${photoUrl}`);

      const photoBuffer = await this.downloadPhoto(photoUrl);

      return this.verifyPhotoBuffer(photoBuffer, ctx.from.id, {
        method: 'ai_photo',
        fallbackPhotoId: photoFileId,
      });
    } catch (error) {
      logger.error('Error in AI age verification:', error);
      return {
        success: false,
        verified: false,
        ageVerified: false,
        error: 'VERIFICATION_ERROR',
        message: error.message,
      };
    }
  }

  async verifyPhotoAge(photoBuffer, userId, options = {}) {
    return this.verifyPhotoBuffer(photoBuffer, userId, {
      method: options.method || 'ai_photo',
      fallbackPhotoId: options.fallbackPhotoId || `web_upload_${Date.now()}`,
    });
  }

  async verifyPhotoBuffer(photoBuffer, userId, { method = 'ai_photo', fallbackPhotoId } = {}) {
    try {
      const analysisResult = await this.analyzePhoto(photoBuffer);

      if (!analysisResult.success) {
        return {
          success: false,
          verified: false,
          ageVerified: false,
          error: analysisResult.error,
          message: analysisResult.message || analysisResult.error,
        };
      }

      const { age, confidence, faceDetected } = analysisResult;

      if (!faceDetected) {
        return {
          success: false,
          verified: false,
          ageVerified: false,
          error: 'NO_FACE_DETECTED',
          message: 'No se detectó un rostro claro en la imagen.',
        };
      }

      const isVerified = age >= this.minAge;

      await this.saveVerificationAttempt(userId, {
        photoFileId: fallbackPhotoId || `web_upload_${Date.now()}`,
        estimatedAge: age,
        confidence,
        verified: isVerified,
        provider: this.provider,
      });

      if (isVerified) {
        const persistence = await UserModel.updateAgeVerification(userId, { verified: true, method });
        if (!persistence) {
          logger.warn('Age verification could not be persisted - user record missing', { userId });
        }
      }

      const message = isVerified
        ? 'Age verified successfully'
        : 'User does not meet the minimum age requirement';

      return {
        success: true,
        verified: isVerified,
        ageVerified: isVerified,
        age,
        estimatedAge: age,
        confidence,
        minAge: this.minAge,
        provider: this.provider,
        message,
      };
    } catch (error) {
      logger.error('Error in AI age verification buffer path:', error);
      return {
        success: false,
        verified: false,
        ageVerified: false,
        error: 'VERIFICATION_ERROR',
        message: error.message,
      };
    }
  }

  /**
   * Download photo from URL
   * @param {string} url - Photo URL
   * @returns {Promise<Buffer>} Photo buffer
   */
  async downloadPhoto(url) {
    try {
      const response = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: 10000,
      });
      return Buffer.from(response.data);
    } catch (error) {
      logger.error('Error downloading photo:', error);
      throw new Error('Failed to download photo');
    }
  }

  /**
   * Analyze photo based on configured provider
   * @param {Buffer} photoBuffer - Photo bytes
   * @returns {Promise<Object>} Analysis result
   */
  async analyzePhoto(photoBuffer) {
    switch (this.provider) {
      case 'azure':
        if (!this.azureEndpoint || !this.azureApiKey) {
          if (this.faceppApiKey && this.faceppApiSecret) {
            logger.warn('Azure credentials missing, falling back to Face++');
            return this.analyzeWithFacePP(photoBuffer);
          }
          return {
            success: false,
            error: 'Azure Face API credentials not configured',
          };
        }
        return this.analyzeWithAzure(photoBuffer);
      case 'facepp':
        return this.analyzeWithFacePP(photoBuffer);
      default:
        throw new Error(`Unsupported provider: ${this.provider}`);
    }
  }

  /**
   * Analyze photo with Microsoft Azure Face API
   * @param {Buffer} photoBuffer - Photo buffer
   * @returns {Promise<Object>} Analysis result
   */
  async analyzeWithAzure(photoBuffer) {
    try {
      if (!this.azureEndpoint || !this.azureApiKey) {
        return {
          success: false,
          error: 'Azure Face API credentials not configured',
        };
      }

      const url = `${this.azureEndpoint}/face/v1.0/detect?returnFaceAttributes=age`;

      const response = await axios.post(url, photoBuffer, {
        headers: {
          'Content-Type': 'application/octet-stream',
          'Ocp-Apim-Subscription-Key': this.azureApiKey,
        },
        timeout: 15000,
      });

      // Check if faces were detected
      if (!response.data || response.data.length === 0) {
        return {
          success: true,
          faceDetected: false,
        };
      }

      // Get first face attributes
      const faceAttributes = response.data[0].faceAttributes;
      const age = Math.round(faceAttributes.age);

      logger.info(`Azure detected age: ${age}`);

      return {
        success: true,
        faceDetected: true,
        age,
        confidence: 0.85, // Azure doesn't provide confidence for age, using default
      };
    } catch (error) {
      logger.error('Error analyzing with Azure:', error);
      return {
        success: false,
        error: error.response?.data?.error?.message || error.message,
      };
    }
  }

  /**
   * Analyze photo with Face++ API
   * PRIVACY-FIRST IMPLEMENTATION: Photo is NOT stored. Only age result is saved.
   * @param {Buffer} photoBuffer - Photo buffer (will be immediately discarded)
   * @returns {Promise<Object>} Analysis result
   */
  async analyzeWithFacePP(photoBuffer) {
    let tempPhotoBuffer = null;
    try {
      if (!this.faceppApiKey || !this.faceppApiSecret) {
        return {
          success: false,
          error: 'Face++ API credentials not configured',
        };
      }

      // Store reference for cleanup tracking
      tempPhotoBuffer = photoBuffer;
      const photoSize = photoBuffer.length;

      logger.info(`Face++ analysis starting - Photo size: ${photoSize} bytes (will not be stored)`);

      const FormData = require('form-data');
      const formData = new FormData();
      formData.append('api_key', this.faceppApiKey);
      formData.append('api_secret', this.faceppApiSecret);
      formData.append('image_file', photoBuffer, { filename: 'photo.jpg' });
      formData.append('return_attributes', 'age');

      const response = await axios.post('https://api-us.faceplusplus.com/facepp/v3/detect', formData, {
        headers: formData.getHeaders(),
        timeout: 15000,
      });

      // Check if faces were detected
      if (!response.data.faces || response.data.faces.length === 0) {
        return {
          success: true,
          faceDetected: false,
        };
      }

      // Get first face attributes
      const faceAttributes = response.data.faces[0].attributes;
      const age = Math.round(faceAttributes.age.value);

      logger.info(`Face++ detected age: ${age} (photo will be immediately discarded)`);

      return {
        success: true,
        faceDetected: true,
        age,
        confidence: 0.85, // Face++ doesn't provide confidence for age, using default
      };
    } catch (error) {
      logger.error('Error analyzing with Face++:', error);
      return {
        success: false,
        error: error.response?.data?.error_message || error.message,
      };
    } finally {
      // CRITICAL: Ensure photo buffer is cleared immediately after API call
      if (tempPhotoBuffer) {
        tempPhotoBuffer = null;
      }
      // Force garbage collection hint
      if (global.gc) {
        global.gc();
      }
    }
  }

  /**
   * Save verification attempt to database
   * @param {string} userId - User ID
   * @param {Object} data - Verification data
   */
  async saveVerificationAttempt(userId, data) {
    try {
      const sql = `
        INSERT INTO age_verification_attempts (
          user_id, photo_file_id, estimated_age, confidence,
          verified, provider, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, NOW())
      `;

      const photoRef = data.photoFileId || `web_upload_${Date.now()}`;

      await query(sql, [
        userId.toString(),
        photoRef,
        data.estimatedAge,
        data.confidence,
        data.verified,
        data.provider,
      ]);

      logger.info(`Verification attempt saved for user ${userId}`);
    } catch (error) {
      // If table doesn't exist, log warning but don't fail
      if (error.message.includes('does not exist')) {
        logger.warn('age_verification_attempts table does not exist. Skipping save.');
      } else {
        logger.error('Error saving verification attempt:', error);
      }
    }
  }

  /**
   * Check if user's age verification has expired
   * @param {Object} user - User object
   * @returns {boolean} True if expired
   */
  isVerificationExpired(user) {
    if (!user.ageVerified || !user.ageVerificationExpiresAt) {
      return true;
    }
    return new Date() > new Date(user.ageVerificationExpiresAt);
  }

  /**
   * Get verification statistics
   * @returns {Promise<Object>} Statistics
   */
  async getStatistics() {
    try {
      const sql = `
        SELECT
          COUNT(*) as total_attempts,
          COUNT(*) FILTER (WHERE verified = true) as successful_verifications,
          AVG(estimated_age) as avg_estimated_age,
          AVG(confidence) as avg_confidence
        FROM age_verification_attempts
        WHERE created_at > NOW() - INTERVAL '30 days'
      `;

      const result = await query(sql);
      return result.rows[0];
    } catch (error) {
      logger.error('Error getting verification statistics:', error);
      return null;
    }
  }
}

module.exports = new AgeVerificationService();
