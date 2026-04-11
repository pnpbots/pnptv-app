const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const creatorController = require('../controllers/creatorController');
const cmsCreatorController = require('../controllers/cmsCreatorController');
const authGuard = require('../middleware/authGuard');
const creatorGuard = require('../middleware/creatorGuard');
const roleGuard = require('../middleware/roleGuard');
const { adminGuard } = require('../../../middleware/guards');

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
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Only image files are allowed for ID document'));
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

// ── CMS routes (active creators only) ────────────────────────────────────────
router.get('/cms/profile', authGuard, cmsCreatorController.getProfile);
router.put('/cms/profile', authGuard, cmsCreatorController.updateProfile);

router.get('/cms/content', authGuard, cmsCreatorController.listContent);
router.post('/cms/content', authGuard, cmsCreatorController.createContent);
router.patch('/cms/content/:id', authGuard, cmsCreatorController.updateContent);
router.delete('/cms/content/:id', authGuard, cmsCreatorController.deleteContent);

router.get('/cms/shows', authGuard, cmsCreatorController.listShows);
router.post('/cms/shows', authGuard, cmsCreatorController.createShow);
router.patch('/cms/shows/:id', authGuard, cmsCreatorController.updateShow);
router.delete('/cms/shows/:id', authGuard, cmsCreatorController.deleteShow);

router.post('/cms/upload', authGuard, ...cmsCreatorController.uploadMedia);

// ── Channel management (active creators) ─────────────────────────────────────
router.get('/channels', authGuard, creatorController.listOwnChannels);
router.post('/channels', authGuard, creatorController.createChannel);
router.patch('/channels/:id', authGuard, creatorController.updateChannel);
router.delete('/channels/:id', authGuard, creatorController.deleteChannel);

// Direct video upload: file → creator's private Directus folder → channel post.
router.post(
  '/channels/:id/video',
  authGuard,
  cmsCreatorController.channelVideoUpload.single('video'),
  creatorController.uploadChannelVideo,
);

// ── Channel collaborators (owner-only mutation) ───────────────────────────────
router.post('/channels/:id/collaborators', authGuard, creatorController.addCollaborator);
router.delete('/channels/:id/collaborators', authGuard, creatorController.removeCollaborator);

// ── Milestone routes (auth required) ─────────────────────────────────────────
// IMPORTANT: must come BEFORE /:creatorId/* param routes
router.get('/milestones', authGuard, creatorController.getMilestones);
router.post('/milestones/:id/respond', authGuard, creatorController.respondToMilestone);

// ── Creator panel: subscribers, consents, X campaigns ────────────────────────
router.get('/subscribers', authGuard, creatorGuard, creatorController.getMySubscribers);
router.get('/consents', authGuard, creatorGuard, creatorController.getMyConsents);
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

// ── Param routes LAST ─────────────────────────────────────────────────────────
router.get('/:creatorId/strikes', authGuard, roleGuard('admin', 'superadmin'), creatorController.getStrikes);
router.post('/:creatorId/strike', authGuard, roleGuard('admin', 'superadmin'), creatorController.issueStrike);
router.get('/:creatorId/subscription-status', authGuard, creatorController.getSubscriptionStatus);
router.post('/:creatorId/subscribe', authGuard, creatorController.subscribeToCreator);
router.post('/:creatorId/unsubscribe', authGuard, creatorController.unsubscribeFromCreator);

module.exports = router;
