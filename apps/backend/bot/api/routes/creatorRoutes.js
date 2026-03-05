const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const creatorController = require('../controllers/creatorController');
const authGuard = require('../middleware/authGuard');
const roleGuard = require('../middleware/roleGuard');

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

// Legacy direct activation (kept for admin/script use)
router.post('/activate', authGuard, creatorController.activateCreator);

router.get('/dashboard', authGuard, creatorController.getDashboard);

// Creator wallet routes
router.get('/wallet', authGuard, creatorController.getWalletAddress);
router.post('/wallet', authGuard, creatorController.saveWalletAddress);

// Creator tier change
router.post('/change-tier', authGuard, creatorController.changeTier);

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
