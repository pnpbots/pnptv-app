const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const FileType = require('../../utils/fileType');
const { query } = require('../../../config/postgres');
const logger = require('../../../utils/logger');
// Lazy-loaded to avoid circular dependency warning (bot.js -> routes -> applyController -> bot.js)
let _getBotInstance;
function getBotInstance() {
  if (!_getBotInstance) {
    _getBotInstance = require('../../core/bot').getBotInstance;
  }
  return _getBotInstance();
}

/**
 * Apply Controller
 * Handles model/creator application flow
 */
class ApplyController {
  /**
   * Check if user has an active (pending) application
   * GET /api/apply/status
   */
  static async getStatus(req, res) {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ success: false, error: 'Authentication required' });
      }

      // Fetch application AND creator status in parallel
      const [appResult, userResult] = await Promise.all([
        query(
          `SELECT id, application_type, stage_name, status, call_scheduled,
                  created_at, updated_at
           FROM model_applications
           WHERE user_id = $1
           ORDER BY created_at DESC
           LIMIT 1`,
          [userId]
        ),
        query(
          `SELECT creator_status, creator_type FROM users WHERE id = $1`,
          [userId]
        ),
      ]);

      const user = userResult.rows[0] || {};
      const creatorStatus = user.creator_status || 'none';
      const creatorType = user.creator_type || null;
      const isActiveTierCreator =
        creatorStatus === 'active' && ['ice', 'crystal', 'diamond'].includes(creatorType);

      if (appResult.rows.length === 0) {
        return res.json({
          success: true,
          hasApplication: false,
          creatorStatus,
          creatorType,
          eligibleForFullTime: isActiveTierCreator,
        });
      }

      return res.json({
        success: true,
        hasApplication: true,
        application: appResult.rows[0],
        creatorStatus,
        creatorType,
        eligibleForFullTime: isActiveTierCreator,
      });
    } catch (error) {
      logger.error('Error in getStatus:', error);
      return res.status(500).json({ success: false, error: 'Failed to check application status' });
    }
  }

  /**
   * Upload profile photo for application
   * POST /api/apply/profile-photo
   */
  static async uploadProfilePhoto(req, res) {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ success: false, error: 'Authentication required' });
      }

      if (!req.file) {
        return res.status(400).json({ success: false, error: 'No photo uploaded' });
      }

      const detected = await FileType.fromBuffer(req.file.buffer);
      if (!detected || !['image/jpeg', 'image/png', 'image/webp'].includes(detected.mime)) {
        return res.status(400).json({ success: false, error: 'Only JPEG, PNG, or WebP images allowed.' });
      }

      const uploadDir = path.join(process.cwd(), 'public', 'uploads', 'model-applications', String(userId), 'profile');
      fs.mkdirSync(uploadDir, { recursive: true });

      const filename = `profile_${Date.now()}.webp`;
      const filePath = path.join(uploadDir, filename);

      await sharp(req.file.buffer)
        .rotate()
        .withMetadata(false)
        .resize(800, 800, { fit: 'cover' })
        .webp({ quality: 85 })
        .toFile(filePath);

      const photoUrl = `/uploads/model-applications/${userId}/profile/${filename}`;

      return res.json({ success: true, photoUrl });
    } catch (error) {
      logger.error('Error uploading profile photo:', error);
      return res.status(500).json({ success: false, error: 'Failed to upload profile photo' });
    }
  }

  /**
   * Upload ID documents (front + back) for 2257 compliance
   * POST /api/apply/id-documents
   */
  static async uploadIdDocuments(req, res) {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ success: false, error: 'Authentication required' });
      }

      const front = req.files?.front?.[0];
      const back = req.files?.back?.[0];

      if (!front || !back) {
        return res.status(400).json({ success: false, error: 'Both front and back ID photos are required' });
      }

      const [detectedFront, detectedBack] = await Promise.all([
        FileType.fromBuffer(front.buffer),
        FileType.fromBuffer(back.buffer),
      ]);
      const allowedIdMimes = ['image/jpeg', 'image/png', 'image/webp'];
      if (!detectedFront || !allowedIdMimes.includes(detectedFront.mime)) {
        return res.status(400).json({ success: false, error: 'Front ID: only JPEG, PNG, or WebP images allowed.' });
      }
      if (!detectedBack || !allowedIdMimes.includes(detectedBack.mime)) {
        return res.status(400).json({ success: false, error: 'Back ID: only JPEG, PNG, or WebP images allowed.' });
      }

      const uploadDir = path.join(process.cwd(), 'public', 'uploads', 'model-applications', String(userId), 'id');
      fs.mkdirSync(uploadDir, { recursive: true });

      const ts = Date.now();
      const frontFilename = `id_front_${ts}.webp`;
      const backFilename = `id_back_${ts}.webp`;

      await Promise.all([
        sharp(front.buffer)
          .rotate()
          .withMetadata(false)
          .resize(1200, 900, { fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 90 })
          .toFile(path.join(uploadDir, frontFilename)),
        sharp(back.buffer)
          .rotate()
          .withMetadata(false)
          .resize(1200, 900, { fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 90 })
          .toFile(path.join(uploadDir, backFilename)),
      ]);

      const idFrontUrl = `/uploads/model-applications/${userId}/id/${frontFilename}`;
      const idBackUrl = `/uploads/model-applications/${userId}/id/${backFilename}`;

      return res.json({ success: true, idFrontUrl, idBackUrl });
    } catch (error) {
      logger.error('Error uploading ID documents:', error);
      return res.status(500).json({ success: false, error: 'Failed to upload ID documents' });
    }
  }

  /**
   * Submit a model application
   * POST /api/apply/submit
   */
  static async submit(req, res) {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ success: false, error: 'Authentication required' });
      }

      // Gate: user must be an active tier creator (Ice/Crystal/Diamond) to apply for full-time
      const userRes = await query(
        `SELECT creator_status, creator_type FROM users WHERE id = $1`,
        [userId]
      );
      const user = userRes.rows[0];
      if (!user) {
        return res.status(404).json({ success: false, error: 'User not found' });
      }
      const isActiveTierCreator =
        user.creator_status === 'active' && ['ice', 'crystal', 'diamond'].includes(user.creator_type);
      if (!isActiveTierCreator) {
        return res.status(403).json({
          success: false,
          error: 'You must be an active creator (Ice, Crystal, or Diamond) before applying for full-time status.',
        });
      }

      const {
        applicationType,
        stageName,
        bio,
        instagramHandle,
        twitterHandle,
        onlyfansUrl,
        profilePhotoUrl,
        legalFullName,
        dateOfBirth,
        country,
        cityState,
        idFrontUrl,
        idBackUrl,
        termsAgreed,
      } = req.body;

      // Validate required fields
      if (!applicationType || !stageName || !legalFullName || !dateOfBirth || !country || !cityState || !idFrontUrl || !idBackUrl) {
        return res.status(400).json({ success: false, error: 'Missing required fields' });
      }

      // Document URLs must point at THIS user's own upload directory under
      // /uploads/model-applications/<userId>/<kind>/<file>. This blocks IDOR
      // (linking another user's ID docs to your application) and arbitrary
      // external URL injection. Filenames are restricted to the format produced
      // by uploadProfilePhoto / uploadIdDocuments above.
      const SAFE_FILENAME_RE = /^[A-Za-z0-9._-]+$/;
      const validateAppDocUrl = (url, kind) => {
        if (typeof url !== 'string') return false;
        const prefix = `/uploads/model-applications/${userId}/${kind}/`;
        if (!url.startsWith(prefix)) return false;
        const rest = url.slice(prefix.length);
        if (!rest || rest.includes('/') || !SAFE_FILENAME_RE.test(rest)) return false;
        return true;
      };
      if (!validateAppDocUrl(idFrontUrl, 'id')) {
        return res.status(400).json({ success: false, error: 'Invalid ID front document reference' });
      }
      if (!validateAppDocUrl(idBackUrl, 'id')) {
        return res.status(400).json({ success: false, error: 'Invalid ID back document reference' });
      }
      if (profilePhotoUrl !== undefined && profilePhotoUrl !== null && profilePhotoUrl !== '') {
        if (!validateAppDocUrl(profilePhotoUrl, 'profile')) {
          return res.status(400).json({ success: false, error: 'Invalid profile photo reference' });
        }
      }

      if (!['live', 'content_creator', 'both'].includes(applicationType)) {
        return res.status(400).json({ success: false, error: 'Invalid application type' });
      }

      if (!termsAgreed) {
        return res.status(400).json({ success: false, error: 'You must agree to the creator terms' });
      }

      // Validate age >= 18 (2257 compliance — server-side enforcement)
      if (!dateOfBirth) {
        return res.status(400).json({ success: false, error: 'Valid date of birth is required' });
      }
      const dobTs = new Date(dateOfBirth).getTime();
      if (isNaN(dobTs)) {
        return res.status(400).json({ success: false, error: 'Valid date of birth is required' });
      }
      const age = Math.floor((Date.now() - dobTs) / (365.25 * 24 * 60 * 60 * 1000));
      if (age < 18) {
        return res.status(400).json({ success: false, error: 'You must be 18 or older to apply' });
      }

      // Check for duplicate pending application
      const existing = await query(
        `SELECT id FROM model_applications WHERE user_id = $1 AND status = 'pending'`,
        [userId]
      );
      if (existing.rows.length > 0) {
        return res.status(409).json({ success: false, error: 'You already have a pending application' });
      }

      // Insert application
      const result = await query(
        `INSERT INTO model_applications (
          user_id, application_type, stage_name, bio,
          instagram_handle, twitter_handle, onlyfans_url, profile_photo_url,
          legal_full_name, date_of_birth, country, city_state,
          id_front_url, id_back_url,
          terms_agreed, terms_agreed_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,NOW())
        RETURNING id, status, created_at`,
        [
          userId, applicationType, stageName.trim(), bio?.trim() || null,
          instagramHandle?.trim() || null, twitterHandle?.trim() || null,
          onlyfansUrl?.trim() || null, profilePhotoUrl || null,
          legalFullName.trim(), dateOfBirth, country.trim(), cityState.trim(),
          idFrontUrl, idBackUrl,
          termsAgreed,
        ]
      );

      const application = result.rows[0];

      // Notify admin via Telegram (fire-and-forget)
      ApplyController._notifyAdmin(userId, stageName, applicationType, application.id).catch((err) => {
        logger.warn(`Failed to send admin notification for model application: ${err.message}`);
      });

      return res.json({ success: true, application });
    } catch (error) {
      logger.error('Error submitting application:', error);
      return res.status(500).json({ success: false, error: 'Failed to submit application' });
    }
  }

  /**
   * Mark that the applicant has scheduled their onboarding call
   * POST /api/apply/mark-scheduled
   */
  static async markScheduled(req, res) {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ success: false, error: 'Authentication required' });
      }

      const { applicationId } = req.body;

      const where = applicationId
        ? `id = $1 AND user_id = $2`
        : `user_id = $1 AND status = 'pending'`;
      const params = applicationId ? [applicationId, userId] : [userId];

      const result = await query(
        `UPDATE model_applications
         SET call_scheduled = TRUE, call_scheduled_at = NOW()
         WHERE ${where}
         RETURNING id`,
        params
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ success: false, error: 'No pending application found' });
      }

      return res.json({ success: true, applicationId: result.rows[0].id });
    } catch (error) {
      logger.error('Error marking call scheduled:', error);
      return res.status(500).json({ success: false, error: 'Failed to update application' });
    }
  }

  /**
   * Send Telegram notification to admin about a new application
   */
  static async _notifyAdmin(userId, stageName, applicationType, applicationId) {
    try {
      const bot = getBotInstance();
      const adminId = process.env.ADMIN_ID;
      if (!bot || !adminId) return;

      const typeLabel = applicationType === 'both'
        ? 'Live Performer + Content Creator'
        : applicationType === 'live'
          ? 'Live Performer'
          : 'Content Creator';

      const message =
        `🎭 *New Model Application*\n\n` +
        `*Stage Name:* ${stageName}\n` +
        `*Type:* ${typeLabel}\n` +
        `*User ID:* \`${userId}\`\n` +
        `*Application ID:* \`${applicationId}\`\n\n` +
        `Review in the admin dashboard.`;

      await bot.telegram.sendMessage(adminId, message, { parse_mode: 'Markdown' });
    } catch (err) {
      logger.warn(`Admin notification failed: ${err.message}`);
    }
  }
}

module.exports = ApplyController;
