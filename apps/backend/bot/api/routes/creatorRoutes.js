const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const creatorController = require('../controllers/creatorController');
const cmsCreatorController = require('../controllers/cmsCreatorController');
const authGuard = require('../middleware/authGuard');
const creatorGuard = require('../middleware/creatorGuard');
const { creatorLockGuard } = require('../middleware/creatorGuard');
const roleGuard = require('../middleware/roleGuard');
const { adminGuard } = require('../../../middleware/guards');

// M-03: rate-limit identity submission — 5 attempts per user per hour
const identitySubmitLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  keyGenerator: (req) => req.session?.user?.id || req.ip,
  handler: (_req, res) =>
    res.status(429).json({
      success: false,
      error: 'Too many submission attempts. Please wait before resubmitting.',
    }),
  standardHeaders: true,
  legacyHeaders: false,
});

const router = express.Router();

// ── ID document upload for enrollment ────────────────────────────────────────
const enrollmentUploadDir = path.join(__dirname, '../../../../../public/uploads/creator-enrollments');
if (!fs.existsSync(enrollmentUploadDir)) {
  fs.mkdirSync(enrollmentUploadDir, { recursive: true });
}
const enrollmentUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, enrollmentUploadDir),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
      cb(null, `id-${Date.now()}${ext}`);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Only JPEG, PNG, or WebP images are allowed for ID document'));
  },
});

// ── ID document upload for 2257 identity verification ────────────────────────
const identity2257UploadDir = path.join(__dirname, '../../../../../public/uploads/creator-2257');
if (!fs.existsSync(identity2257UploadDir)) {
  fs.mkdirSync(identity2257UploadDir, { recursive: true });
}
const identity2257Upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, identity2257UploadDir),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
      cb(null, `id2257-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Only JPEG, PNG, or WebP images are allowed for ID document'));
  },
});

// ── User routes (auth required) ───────────────────────────────────────────────
router.get('/eligibility', authGuard, creatorController.getEligibility);

// Enrollment flow (replaces old /activate for new users)
router.post('/enroll', authGuard, enrollmentUpload.single('idDocument'), creatorController.submitEnrollment);
router.get('/enrollment', authGuard, creatorController.getEnrollment);

// Legacy direct activation — admin-only; bypasses KYC enrollment flow
router.post('/activate', adminGuard, creatorController.activateCreator);

router.get('/dashboard', authGuard, creatorController.getDashboard);

// Creator wallet routes
router.get('/wallet', authGuard, creatorController.getWalletAddress);
router.post('/wallet', authGuard, creatorController.saveWalletAddress);

// Creator tier change
router.post('/change-tier', authGuard, creatorController.changeTier);

// Toggle whether the creator accepts new memberships
router.post('/toggle-subscription', authGuard, creatorController.toggleSubscription);

// ── CMS routes (active creators only) ────────────────────────────────────────
// GETs stay open so locked creators can still review their own content.
// Write operations require that the creator is not onboarding-locked.
router.get('/cms/profile', authGuard, cmsCreatorController.getProfile);
router.put('/cms/profile', authGuard, creatorLockGuard, cmsCreatorController.updateProfile);

router.get('/cms/content', authGuard, cmsCreatorController.listContent);
router.post('/cms/content', authGuard, creatorLockGuard, cmsCreatorController.createContent);
router.patch('/cms/content/:id', authGuard, creatorLockGuard, cmsCreatorController.updateContent);
router.delete('/cms/content/:id', authGuard, creatorLockGuard, cmsCreatorController.deleteContent);

router.get('/cms/shows', authGuard, cmsCreatorController.listShows);
router.post('/cms/shows', authGuard, creatorLockGuard, cmsCreatorController.createShow);
router.patch('/cms/shows/:id', authGuard, creatorLockGuard, cmsCreatorController.updateShow);
router.delete('/cms/shows/:id', authGuard, creatorLockGuard, cmsCreatorController.deleteShow);

router.post('/cms/upload', authGuard, creatorLockGuard, ...cmsCreatorController.uploadMedia);

// ── Channel management (active creators) ─────────────────────────────────────
router.get('/channels', authGuard, creatorController.listOwnChannels);
router.post('/channels', authGuard, creatorLockGuard, creatorController.createChannel);
router.patch('/channels/:id', authGuard, creatorLockGuard, creatorController.updateChannel);
router.delete('/channels/:id', authGuard, creatorLockGuard, creatorController.deleteChannel);

// ── Channel collaborators (owner-only mutation) ───────────────────────────────
router.post('/channels/:id/collaborators', authGuard, creatorLockGuard, creatorController.addCollaborator);
router.delete('/channels/:id/collaborators', authGuard, creatorLockGuard, creatorController.removeCollaborator);

// ── Milestone routes (auth required) ─────────────────────────────────────────
// IMPORTANT: must come BEFORE /:creatorId/* param routes
router.get('/milestones', authGuard, creatorController.getMilestones);
router.post('/milestones/:id/respond', authGuard, creatorController.respondToMilestone);

// ── Creator panel: subscribers, consents, X campaigns ────────────────────────
router.get('/subscribers', authGuard, creatorGuard, creatorController.getMySubscribers);
router.get('/consents', authGuard, creatorGuard, creatorController.getMyConsents);
router.post('/privacy/accept', authGuard, creatorController.acceptPrivacyPolicy);
router.get('/setup/status', authGuard, creatorController.getSetupStatus);
router.get('/x-account', authGuard, creatorGuard, creatorController.getMyXAccount);
router.get('/x-campaigns', authGuard, creatorGuard, creatorController.getMyXCampaigns);
router.post('/x-campaigns', authGuard, creatorGuard, creatorController.createMyXCampaign);
router.put('/x-campaigns/:id', authGuard, creatorGuard, creatorController.updateMyXCampaign);
router.post('/x-campaigns/:id/pause', authGuard, creatorGuard, creatorController.pauseMyXCampaign);
router.post('/x-campaigns/:id/resume', authGuard, creatorGuard, creatorController.resumeMyXCampaign);
router.delete('/x-campaigns/:id', authGuard, creatorGuard, creatorController.deleteMyXCampaign);
router.get('/x-campaigns/:campId/history', authGuard, creatorGuard, creatorController.getMyXCampaignHistory);

// ── Admin routes ──────────────────────────────────────────────────────────────
// IMPORTANT: static paths must come BEFORE /:creatorId/* param routes
router.get('/applications', authGuard, roleGuard('admin', 'superadmin'), creatorController.listApplications);
router.post('/applications/:id/approve', authGuard, roleGuard('admin', 'superadmin'), creatorController.approveApplication);
router.post('/applications/:id/reject', authGuard, roleGuard('admin', 'superadmin'), creatorController.rejectApplication);
router.get('/active', authGuard, roleGuard('admin', 'superadmin'), creatorController.listActiveCreators);

// Enrollment management
router.get('/enrollments', authGuard, roleGuard('admin', 'superadmin'), creatorController.listEnrollments);
router.post('/enrollments/:id/approve', authGuard, roleGuard('admin', 'superadmin'), creatorController.approveEnrollment);
router.post('/enrollments/:id/reject', authGuard, roleGuard('admin', 'superadmin'), creatorController.rejectEnrollment);

// ── Identity verification (2257) — user-facing ───────────────────────────────
// IMPORTANT: must come BEFORE /:creatorId/* param routes
router.post('/identity/submit', authGuard, identitySubmitLimiter, identity2257Upload.single('idDocument'), creatorController.submit2257);
router.get('/identity/status', authGuard, creatorController.get2257Status);

// Persona hosted-flow (automated government-ID verification)
router.post('/identity/persona/start', authGuard, creatorController.startPersonaInquiry);
router.get('/identity/persona/status', authGuard, creatorController.getPersonaStatus);

// ── Identity verification (2257) — admin management ──────────────────────────
// IMPORTANT: export route must come BEFORE /:userId param route
router.get('/2257/records/export', adminGuard, creatorController.export2257Records);
router.get('/2257/records', adminGuard, creatorController.list2257Records);
router.post('/2257/records/:userId/approve', adminGuard, creatorController.approve2257);
router.post('/2257/records/:userId/reject', adminGuard, creatorController.reject2257);

// ── Param routes LAST ─────────────────────────────────────────────────────────
// Note: /:creatorId/subscription-status, /:creatorId/subscribe, and /:creatorId/unsubscribe
// are registered in routes.js (with rate limiting) and must NOT be duplicated here.
router.get('/:creatorId/strikes', authGuard, roleGuard('admin', 'superadmin'), creatorController.getStrikes);
router.post('/:creatorId/strike', authGuard, roleGuard('admin', 'superadmin'), creatorController.issueStrike);

module.exports = router;
