const express = require('express');
const subscriptionPaymentController = require('../controllers/subscriptionPaymentController');
const authGuard = require('../middleware/authGuard');

const router = express.Router();

/**
 * Public Subscription Routes
 */

// GET /api/subscriptions/plans?role=user
router.get('/plans', subscriptionPaymentController.getPlans);

/**
 * Protected Subscription Routes
 */

// GET /api/subscriptions/my-subscription
router.get('/my-subscription', authGuard, subscriptionPaymentController.getMySubscription);

// POST /api/subscriptions/checkout
router.post('/checkout', authGuard, subscriptionPaymentController.createCheckout);

// POST /api/subscriptions/cancel
router.post('/cancel', authGuard, subscriptionPaymentController.cancelSubscription);

// GET /api/subscriptions/history
router.get('/history', authGuard, subscriptionPaymentController.getPaymentHistory);

// GET /api/subscriptions/feature-access?feature=unlimitedStreams
router.get('/feature-access', authGuard, subscriptionPaymentController.checkFeatureAccess);

module.exports = router;
