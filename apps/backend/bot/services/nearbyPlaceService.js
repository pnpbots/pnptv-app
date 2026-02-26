const NearbyPlaceModel = require('../../models/nearbyPlaceModel');
const NearbyPlaceCategoryModel = require('../../models/nearbyPlaceCategoryModel');
const NearbyPlaceSubmissionModel = require('../../models/nearbyPlaceSubmissionModel');
const UserModel = require('../../models/userModel');
const logger = require('../../utils/logger');

/**
 * Nearby Place Service - Business logic for nearby places and businesses
 */
class NearbyPlaceService {
  /**
   * Get nearby places for a user
   * @param {string} userId - User ID
   * @param {number} radiusKm - Search radius in km
   * @param {Object} filters - Category, placeType filters
   * @returns {Promise<Object>} { success, places, error }
   */
  static async getNearbyPlaces(userId, radiusKm = 25, filters = {}) {
    try {
      const user = await UserModel.getById(userId);

      if (!user || !user.location || !user.location.lat || !user.location.lng) {
        return { success: false, error: 'no_location', places: [] };
      }

      const places = await NearbyPlaceModel.getNearby(user.location, radiusKm, filters);
      return { success: true, places };
    } catch (error) {
      logger.error('Error getting nearby places:', error);
      return { success: false, error: error.message, places: [] };
    }
  }

  /**
   * Get nearby businesses
   * @param {string} userId - User ID
   * @param {number} radiusKm - Search radius in km
   * @returns {Promise<Object>} { success, places, error }
   */
  static async getNearbyBusinesses(userId, radiusKm = 50) {
    return this.getNearbyPlaces(userId, radiusKm, { placeType: 'business' });
  }

  /**
   * Get nearby places of interest
   * @param {string} userId - User ID
   * @param {number} radiusKm - Search radius in km
   * @param {number} categoryId - Category ID (optional)
   * @returns {Promise<Object>} { success, places, error }
   */
  static async getNearbyPlacesOfInterest(userId, radiusKm = 50, categoryId = null) {
    const filters = { placeType: 'place_of_interest' };
    if (Array.isArray(categoryId) && categoryId.length > 0) {
      filters.categoryIds = categoryId;
    } else if (categoryId) {
      filters.categoryId = categoryId;
    }
    return this.getNearbyPlaces(userId, radiusKm, filters);
  }

  /**
   * Get all categories
   * @param {string} lang - Language code (en/es)
   * @returns {Promise<Array>} Categories with localized names
   */
  static async getCategories(lang = 'en') {
    try {
      const categories = await NearbyPlaceCategoryModel.getAll(true);
      return categories.map(cat => ({
        ...cat,
        name: lang === 'es' ? cat.nameEs : cat.nameEn,
        description: lang === 'es' ? cat.descriptionEs : cat.descriptionEn,
      }));
    } catch (error) {
      logger.error('Error getting categories:', error);
      return [];
    }
  }

  /**
   * Get category by ID
   * @param {number} categoryId - Category ID
   * @returns {Promise<Object|null>} Category object
   */
  static async getCategory(categoryId) {
    try {
      return await NearbyPlaceCategoryModel.getById(categoryId);
    } catch (error) {
      logger.error('Error getting category:', error);
      return null;
    }
  }

  /**
   * Submit a new place for review
   * @param {string} userId - Submitter user ID
   * @param {Object} placeData - Place data
   * @returns {Promise<Object>} { success, submission, error }
   */
  static async submitPlace(userId, placeData) {
    try {
      const submission = await NearbyPlaceSubmissionModel.create({
        ...placeData,
        submittedByUserId: userId,
      });

      logger.info('Place submitted for review', {
        submissionId: submission.id,
        userId,
        placeName: placeData.name,
      });

      return { success: true, submission };
    } catch (error) {
      logger.error('Error submitting place:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Approve a submission (admin)
   * @param {number} submissionId - Submission ID
   * @param {string} adminUserId - Admin user ID
   * @returns {Promise<Object>} { success, place, error }
   */
  static async approveSubmission(submissionId, adminUserId) {
    try {
      const submission = await NearbyPlaceSubmissionModel.getById(submissionId);

      if (!submission) {
        return { success: false, error: 'Submission not found' };
      }

      if (submission.status !== 'pending') {
        return { success: false, error: 'Submission already processed' };
      }

      // Create the actual place
      const place = await NearbyPlaceModel.create({
        name: submission.name,
        description: submission.description,
        address: submission.address,
        city: submission.city,
        country: submission.country,
        location: submission.location,
        categoryId: submission.categoryId,
        placeType: submission.placeType,
        phone: submission.phone,
        email: submission.email,
        website: submission.website,
        telegramUsername: submission.telegramUsername,
        instagram: submission.instagram,
        isCommunityOwned: submission.isCommunityOwned,
        recommenderUserId: submission.submittedByUserId,
        photoFileId: submission.photoFileId,
        hoursOfOperation: submission.hoursOfOperation,
        priceRange: submission.priceRange,
        status: 'approved',
      });

      // Update submission status
      await NearbyPlaceSubmissionModel.updateStatus(
        submissionId,
        'approved',
        adminUserId,
        null,
        place.id
      );

      logger.info('Submission approved', {
        submissionId,
        placeId: place.id,
        adminUserId,
      });

      return { success: true, place, submission };
    } catch (error) {
      logger.error('Error approving submission:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Reject a submission (admin)
   * @param {number} submissionId - Submission ID
   * @param {string} adminUserId - Admin user ID
   * @param {string} reason - Rejection reason
   * @returns {Promise<Object>} { success, error }
   */
  static async rejectSubmission(submissionId, adminUserId, reason) {
    try {
      const submission = await NearbyPlaceSubmissionModel.getById(submissionId);

      if (!submission) {
        return { success: false, error: 'Submission not found' };
      }

      if (submission.status !== 'pending') {
        return { success: false, error: 'Submission already processed' };
      }

      await NearbyPlaceSubmissionModel.updateStatus(
        submissionId,
        'rejected',
        adminUserId,
        reason
      );

      logger.info('Submission rejected', { submissionId, adminUserId, reason });
      return { success: true, submission };
    } catch (error) {
      logger.error('Error rejecting submission:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get place details
   * @param {number} placeId - Place ID
   * @param {boolean} incrementView - Whether to increment view count
   * @returns {Promise<Object|null>} Place object
   */
  static async getPlaceDetails(placeId, incrementView = true) {
    try {
      const place = await NearbyPlaceModel.getById(placeId);

      if (place && incrementView) {
        await NearbyPlaceModel.incrementViewCount(placeId);
      }

      return place;
    } catch (error) {
      logger.error('Error getting place details:', error);
      return null;
    }
  }

  /**
   * Get pending submissions for admin
   * @param {number} limit - Max results
   * @returns {Promise<Array>} Pending submissions
   */
  static async getPendingSubmissions(limit = 20) {
    try {
      return await NearbyPlaceSubmissionModel.getPending(limit);
    } catch (error) {
      logger.error('Error getting pending submissions:', error);
      return [];
    }
  }

  /**
   * Get submission details with enhanced information
   * @param {number} submissionId - Submission ID
   * @returns {Promise<Object|null>} Submission details
   */
  static async getSubmissionDetails(submissionId) {
    try {
      const submission = await NearbyPlaceSubmissionModel.getById(submissionId);
      
      if (!submission) return null;

      // Enhance with category information
      if (submission.categoryId) {
        const category = await NearbyPlaceCategoryModel.getById(submission.categoryId);
        if (category) {
          submission.categoryName = category.nameEn;
          submission.categoryNameEs = category.nameEs;
          submission.categoryEmoji = category.emoji;
        }
      }

      // Enhance with submitter information
      if (submission.submittedByUserId) {
        const user = await UserModel.getById(submission.submittedByUserId);
        if (user) {
          submission.submitterUsername = user.username;
          submission.userTier = user.subscriptionStatus;
        }
      }

      return submission;
    } catch (error) {
      logger.error('Error getting submission details:', error);
      return null;
    }
  }

  /**
   * Get recently approved submissions
   * @param {number} limit - Max results
   * @returns {Promise<Array>} Recently approved submissions
   */
  static async getRecentApproved(limit = 10) {
    try {
      return await NearbyPlaceSubmissionModel.getRecentApproved(limit);
    } catch (error) {
      logger.error('Error getting recent approved submissions:', error);
      return [];
    }
  }

  /**
   * Get recently rejected submissions
   * @param {number} limit - Max results
   * @returns {Promise<Array>} Recently rejected submissions
   */
  static async getRecentRejected(limit = 10) {
    try {
      return await NearbyPlaceSubmissionModel.getRecentRejected(limit);
    } catch (error) {
      logger.error('Error getting recent rejected submissions:', error);
      return [];
    }
  }

  /**
   * Count pending submissions
   * @returns {Promise<number>} Count of pending submissions
   */
  static async countPending() {
    try {
      return await NearbyPlaceSubmissionModel.countPending();
    } catch (error) {
      logger.error('Error counting pending submissions:', error);
      return 0;
    }
  }

  /**
   * Get pending places for admin
   * @param {number} limit - Max results
   * @returns {Promise<Array>} Pending places
   */
  static async getPendingPlaces(limit = 20) {
    try {
      return await NearbyPlaceModel.getPending(limit);
    } catch (error) {
      logger.error('Error getting pending places:', error);
      return [];
    }
  }

  /**
   * Get user's submissions
   * @param {string} userId - User ID
   * @param {number} limit - Max results
   * @returns {Promise<Array>} User's submissions
   */
  static async getUserSubmissions(userId, limit = 10) {
    try {
      return await NearbyPlaceSubmissionModel.getByUser(userId, limit);
    } catch (error) {
      logger.error('Error getting user submissions:', error);
      return [];
    }
  }

  /**
   * Update submission (user editing their pending submission)
   * @param {number} submissionId - Submission ID
   * @param {string} userId - User ID (must be the submitter)
   * @param {Object} updates - Fields to update
   * @returns {Promise<Object>} { success, submission, error }
   */
  static async updateSubmission(submissionId, userId, updates) {
    try {
      // Verify the submission belongs to this user and is pending
      const submission = await NearbyPlaceSubmissionModel.getById(submissionId);

      if (!submission) {
        return { success: false, error: 'Submission not found' };
      }

      if (submission.submittedByUserId !== userId) {
        return { success: false, error: 'Not authorized to edit this submission' };
      }

      if (submission.status !== 'pending') {
        return { success: false, error: 'Can only edit pending submissions' };
      }

      const updated = await NearbyPlaceSubmissionModel.update(submissionId, updates);

      if (!updated) {
        return { success: false, error: 'Failed to update submission' };
      }

      logger.info('Submission updated by user', { submissionId, userId });
      return { success: true, submission: updated };
    } catch (error) {
      logger.error('Error updating submission:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Update place (admin)
   * @param {number} placeId - Place ID
   * @param {Object} updates - Fields to update
   * @returns {Promise<Object>} { success, place, error }
   */
  static async updatePlace(placeId, updates) {
    try {
      const place = await NearbyPlaceModel.update(placeId, updates);
      if (!place) {
        return { success: false, error: 'Place not found' };
      }
      return { success: true, place };
    } catch (error) {
      logger.error('Error updating place:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Suspend/unsuspend place (admin)
   * @param {number} placeId - Place ID
   * @param {boolean} suspend - Whether to suspend
   * @param {string} adminUserId - Admin user ID
   * @returns {Promise<Object>} { success, place, error }
   */
  static async toggleSuspend(placeId, suspend, adminUserId) {
    try {
      const status = suspend ? 'suspended' : 'approved';
      const place = await NearbyPlaceModel.updateStatus(placeId, status, adminUserId);

      if (!place) {
        return { success: false, error: 'Place not found' };
      }

      logger.info(`Place ${suspend ? 'suspended' : 'unsuspended'}`, { placeId, adminUserId });
      return { success: true, place };
    } catch (error) {
      logger.error('Error toggling place suspension:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Reject place directly (admin)
   * @param {number} placeId - Place ID
   * @param {string} adminUserId - Admin user ID
   * @param {string} reason - Rejection reason
   * @returns {Promise<Object>} { success, place, error }
   */
  static async rejectPlace(placeId, adminUserId, reason) {
    try {
      const place = await NearbyPlaceModel.updateStatus(placeId, 'rejected', adminUserId, reason);

      if (!place) {
        return { success: false, error: 'Place not found' };
      }

      logger.info('Place rejected', { placeId, adminUserId, reason });
      return { success: true, place };
    } catch (error) {
      logger.error('Error rejecting place:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Delete place (admin)
   * @param {number} placeId - Place ID
   * @returns {Promise<Object>} { success, error }
   */
  static async deletePlace(placeId) {
    try {
      const deleted = await NearbyPlaceModel.delete(placeId);
      if (!deleted) {
        return { success: false, error: 'Place not found or could not be deleted' };
      }
      return { success: true };
    } catch (error) {
      logger.error('Error deleting place:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get statistics for admin dashboard
   * @returns {Promise<Object>} Stats object
   */
  static async getStats() {
    try {
      const [placeStats, submissionStats] = await Promise.all([
        NearbyPlaceModel.getStats(),
        NearbyPlaceSubmissionModel.getStats(),
      ]);

      return {
        places: placeStats,
        submissions: submissionStats,
      };
    } catch (error) {
      logger.error('Error getting stats:', error);
      return { places: null, submissions: null };
    }
  }

  /**
   * Count pending items for admin badge
   * @returns {Promise<number>} Total pending count
   */
  static async countPending() {
    try {
      const count = await NearbyPlaceSubmissionModel.countPending();
      return count;
    } catch (error) {
      logger.error('Error counting pending:', error);
      return 0;
    }
  }

  /**
   * Get all places with filters (admin)
   * @param {Object} filters - Filters
   * @param {number} limit - Max results
   * @param {number} offset - Offset for pagination
   * @returns {Promise<Array>} Places
   */
  static async getAllPlaces(filters = {}, limit = 50, offset = 0) {
    try {
      return await NearbyPlaceModel.getAll(filters, limit, offset);
    } catch (error) {
      logger.error('Error getting all places:', error);
      return [];
    }
  }
}

module.exports = NearbyPlaceService;
