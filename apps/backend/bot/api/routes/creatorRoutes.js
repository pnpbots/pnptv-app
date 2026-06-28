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

// Wallet/payout-address writes — 10/hr per user. Slow but not blocking; tight
// enough to prevent an attacker with a stolen session from rotating the address
// between balance-read and payout-dispatch.
const walletWriteLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  keyGenerator: (req) => req.session?.user?.id || req.ip,
  handler: (_req, res) =>
    res.status(429).json({
      success: false,
      error: 'Too many wallet updates. Please wait before retrying.',
    }),
  standardHeaders: true,
  legacyHeaders: false,
});

// X campaign mutations — 20/hr per user. The in-handler advisory-lock enforces
// the absolute 2-campaign cap, but a rate limiter is still needed to prevent
// Grok-cost attacks from concurrent create/delete cycles.
const xCampaignWriteLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  keyGenerator: (req) => req.session?.user?.id || req.ip,
  handler: (_req, res) =>
    res.status(429).json({
      success: false,
      error: 'Too many campaign requests. Please wait before retrying.',
    }),
  standardHeaders: true,
  legacyHeaders: false,
});

// Tier change — 3/hr per user. Prevents rapid toggling that could exploit
// entitlement propagation windows or confuse downstream billing state.
const changeTierLimiter = rateLimit({
  windowMs: 3600_000,
  max: 3,
  keyGenerator: (req) => String(req.session?.user?.id || req.ip),
  message: { error: 'Too many tier changes. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Subscription toggle — 5/hr per user. Prevents rapid open/close cycles
// from creating billing edge-cases on the creator's subscriber list.
const toggleSubLimiter = rateLimit({
  windowMs: 3600_000,
  max: 5,
  keyGenerator: (req) => String(req.session?.user?.id || req.ip),
  message: { error: 'Too many subscription toggles. Try again later.' },
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
      const uid = req.session?.user?.id || 'u';
      cb(null, `id-${uid}-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024, fieldSize: 250 * 1024 }, // 10 MB file, 250 KB fields
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
router.post('/enroll', authGuard, identitySubmitLimiter, enrollmentUpload.single('idDocument'), creatorController.submitEnrollment);
router.get('/enrollment', authGuard, creatorController.getEnrollment);

// Legacy direct activation — admin-only; bypasses KYC enrollment flow
router.post('/activate', adminGuard, creatorController.activateCreator);

router.get('/dashboard', authGuard, creatorController.getDashboard);

// Creator wallet routes
router.get('/wallet', authGuard, creatorController.getWalletAddress);
router.post('/wallet', authGuard, walletWriteLimiter, creatorController.saveWalletAddress);

// Creator tier change
router.post('/change-tier', authGuard, creatorGuard, changeTierLimiter, creatorController.changeTier);

// Toggle whether the creator accepts new memberships
router.post('/toggle-subscription', authGuard, creatorGuard, toggleSubLimiter, creatorController.toggleSubscription);

// ── CMS routes (active creators only) ────────────────────────────────────────
// GETs stay open so locked creators can still review their own content.
// Write operations require that the creator is not onboarding-locked.
// All /cms/* routes — even GETs — require an active creator profile.
// Without creatorGuard any authenticated user could read another creator's
// performer-scoped content list, or trigger getOrCreatePerformer (which
// mutates Directus state). creatorLockGuard still applies on writes so a
// creator pending onboarding can read drafts but not write.
router.get('/cms/profile', authGuard, creatorGuard, cmsCreatorController.getProfile);
router.put('/cms/profile', authGuard, creatorGuard, creatorLockGuard, cmsCreatorController.updateProfile);

router.get('/cms/content', authGuard, creatorGuard, cmsCreatorController.listContent);
router.post('/cms/content', authGuard, creatorGuard, creatorLockGuard, cmsCreatorController.createContent);
router.patch('/cms/content/:id', authGuard, creatorGuard, creatorLockGuard, cmsCreatorController.updateContent);
router.delete('/cms/content/:id', authGuard, creatorGuard, creatorLockGuard, cmsCreatorController.deleteContent);

router.get('/cms/shows', authGuard, creatorGuard, cmsCreatorController.listShows);
router.post('/cms/shows', authGuard, creatorGuard, creatorLockGuard, cmsCreatorController.createShow);
router.patch('/cms/shows/:id', authGuard, creatorGuard, creatorLockGuard, cmsCreatorController.updateShow);
router.delete('/cms/shows/:id', authGuard, creatorGuard, creatorLockGuard, cmsCreatorController.deleteShow);

router.post('/cms/upload', authGuard, creatorGuard, creatorLockGuard, ...cmsCreatorController.uploadMedia);

// ── Channel management (active creators) ─────────────────────────────────────
router.get('/channels', authGuard, creatorController.listOwnChannels);
router.post('/channels', authGuard, creatorLockGuard, creatorController.createChannel);
router.patch('/channels/:id', authGuard, creatorGuard, creatorLockGuard, creatorController.updateChannel);
router.delete('/channels/:id', authGuard, creatorGuard, creatorLockGuard, creatorController.deleteChannel);

// ── Channel collaborators (owner-only mutation) ───────────────────────────────
router.post('/channels/:id/collaborators', authGuard, creatorGuard, creatorLockGuard, creatorController.addCollaborator);
router.delete('/channels/:id/collaborators', authGuard, creatorGuard, creatorLockGuard, creatorController.removeCollaborator);

// ── Milestone routes (auth required) ─────────────────────────────────────────
// IMPORTANT: must come BEFORE /:creatorId/* param routes
router.get('/milestones', authGuard, creatorController.getMilestones);
router.post('/milestones/:id/respond', authGuard, creatorController.respondToMilestone);

// ── Creator panel: subscribers, consents, X campaigns ────────────────────────
router.get('/earnings', authGuard, creatorGuard, creatorController.getCreatorEarnings);
router.get('/subscribers', authGuard, creatorGuard, creatorController.getMySubscribers);
router.get('/consents', authGuard, creatorGuard, creatorController.getMyConsents);
router.post('/privacy/accept', authGuard, creatorGuard, creatorController.acceptPrivacyPolicy);
router.post('/terms/accept', authGuard, creatorGuard, creatorController.acceptCreatorTerms);
router.get('/setup/status', authGuard, creatorGuard, creatorController.getSetupStatus);
router.get('/x-account', authGuard, creatorGuard, creatorController.getMyXAccount);
router.get('/x-campaigns', authGuard, creatorGuard, creatorController.getMyXCampaigns);
router.post('/x-campaigns', authGuard, creatorGuard, xCampaignWriteLimiter, creatorController.createMyXCampaign);
router.put('/x-campaigns/:id', authGuard, creatorGuard, xCampaignWriteLimiter, creatorController.updateMyXCampaign);
router.post('/x-campaigns/:id/pause', authGuard, creatorGuard, xCampaignWriteLimiter, creatorController.pauseMyXCampaign);
router.post('/x-campaigns/:id/resume', authGuard, creatorGuard, xCampaignWriteLimiter, creatorController.resumeMyXCampaign);
router.delete('/x-campaigns/:id', authGuard, creatorGuard, xCampaignWriteLimiter, creatorController.deleteMyXCampaign);
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
router.post('/identity/submit', authGuard, identitySubmitLimiter, identity2257Upload.fields([{ name: 'idDocument', maxCount: 1 }, { name: 'idSelfie', maxCount: 1 }]), creatorController.submit2257);
router.get('/identity/status', authGuard, creatorController.get2257Status);

// Persona hosted-flow (automated government-ID verification)
router.post('/identity/persona/start', authGuard, identitySubmitLimiter, creatorController.startPersonaInquiry);
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
