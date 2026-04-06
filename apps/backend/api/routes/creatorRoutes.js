const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const creatorController = require('../controllers/creatorController');
const cmsCreatorController = require('../controllers/cmsCreatorController');
const authGuard = require('../middleware/authGuard');
const creatorGuard = require('../middleware/creatorGuard');
const roleGuard = require('../middleware/roleGuard');
const { adminGuard } = require('../../middleware/guards');

const router = express.Router();

// ── ID document upload for enrollment ────────────────────────────────────────
const enrollmentUploadDir = path.join(__dirname, '../../../../public/uploads/creator-enrollments');
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
router.get('/cms/profile', authGuard, creatorGuard, cmsCreatorController.getProfile);
router.put('/cms/profile', authGuard, creatorGuard, cmsCreatorController.updateProfile);

router.get('/cms/content', authGuard, creatorGuard, cmsCreatorController.listContent);
router.post('/cms/content', authGuard, creatorGuard, cmsCreatorController.createContent);
router.patch('/cms/content/:id', authGuard, creatorGuard, cmsCreatorController.updateContent);
router.delete('/cms/content/:id', authGuard, creatorGuard, cmsCreatorController.deleteContent);

router.get('/cms/shows', authGuard, creatorGuard, cmsCreatorController.listShows);
router.post('/cms/shows', authGuard, creatorGuard, cmsCreatorController.createShow);
router.patch('/cms/shows/:id', authGuard, creatorGuard, cmsCreatorController.updateShow);
router.delete('/cms/shows/:id', authGuard, creatorGuard, cmsCreatorController.deleteShow);

router.post('/cms/upload', authGuard, creatorGuard, ...cmsCreatorController.uploadMedia);

// ── Channel management (active creators) ─────────────────────────────────────
router.get('/channels', authGuard, creatorGuard, creatorController.listOwnChannels);
router.post('/channels', authGuard, creatorGuard, creatorController.createChannel);
router.patch('/channels/:id', authGuard, creatorGuard, creatorController.updateChannel);
router.delete('/channels/:id', authGuard, creatorGuard, creatorController.deleteChannel);

// ── Channel collaborators (owner-only mutation) ───────────────────────────────
router.post('/channels/:id/collaborators', authGuard, creatorGuard, creatorController.addCollaborator);
router.delete('/channels/:id/collaborators', authGuard, creatorGuard, creatorController.removeCollaborator);

// ── Milestone routes (auth required) ─────────────────────────────────────────
// IMPORTANT: must come BEFORE /:creatorId/* param routes
router.get('/milestones', authGuard, creatorController.getMilestones);
router.post('/milestones/:id/respond', authGuard, creatorController.respondToMilestone);

// ── Admin routes ──────────────────────────────────────────────────────────────
// IMPORTANT: static paths must come BEFORE /:creatorId/* param routes
router.get('/applications', authGuard, roleGuard('creator', 'admin', 'superadmin'), creatorController.listApplications);
router.post('/applications/:id/approve', authGuard, roleGuard('creator', 'admin', 'superadmin'), creatorController.approveApplication);
router.post('/applications/:id/reject', authGuard, roleGuard('creator', 'admin', 'superadmin'), creatorController.rejectApplication);
router.get('/active', authGuard, roleGuard('creator', 'admin', 'superadmin'), creatorController.listActiveCreators);

// Enrollment management
router.get('/enrollments', authGuard, roleGuard('creator', 'admin', 'superadmin'), creatorController.listEnrollments);
router.post('/enrollments/:id/approve', authGuard, roleGuard('creator', 'admin', 'superadmin'), creatorController.approveEnrollment);
router.post('/enrollments/:id/reject', authGuard, roleGuard('creator', 'admin', 'superadmin'), creatorController.rejectEnrollment);

// ── Param routes LAST ─────────────────────────────────────────────────────────
router.get('/:creatorId/strikes', authGuard, roleGuard('admin', 'superadmin'), creatorController.getStrikes);
router.post('/:creatorId/strike', authGuard, roleGuard('admin', 'superadmin'), creatorController.issueStrike);
router.get('/:creatorId/subscription-status', authGuard, creatorController.getSubscriptionStatus);
router.post('/:creatorId/subscribe', authGuard, creatorController.subscribeToCreator);
router.post('/:creatorId/unsubscribe', authGuard, creatorController.unsubscribeFromCreator);

module.exports = router;
