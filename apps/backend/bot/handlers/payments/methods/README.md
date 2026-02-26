# Payment Methods

This directory contains isolated payment method handlers for PNPtv's subscription system.

## Structure

```
methods/
├── epayco/          # Credit/Debit Card Payments (Colombia)
├── daimo/           # Crypto Payments (USDC on Optimism)
├── lifetime100/     # Lifetime Pass Promo (Manual Activation)
├── meru/            # Meru Payment Links (Manual Verification)
└── README.md        # This file
```

## Integration Pattern

All payment methods follow a standard flow:

1. **Payment Initiated**: User starts payment process
2. **Payment Processed**: Webhook received or manual verification completed
3. **Record History**: Call `PaymentHistoryService.recordPayment()`
4. **Activate Membership**: Call `UserModel.updateSubscription()`
5. **Send Confirmation**: Notify user and admin channels

## Payment Reference Requirements

Each payment method MUST store a unique payment reference:

| Method | Reference Type | Example |
|--------|----------------|---------|
| ePayco | Transaction ID | `PAY-12345667` |
| Daimo | Blockchain Hash | `0x1234abcd...` |
| Meru | Link Code | `daq_Ak` |
| Lifetime100 | Activation Code | `CODE123ABC` |

## Recording Payments

After successful payment processing:

```javascript
const PaymentHistoryService = require('../../../services/paymentHistoryService');

await PaymentHistoryService.recordPayment({
  userId: user.id,
  paymentMethod: 'epayco',      // or 'daimo', 'meru', 'lifetime100'
  amount: 50,
  currency: 'USD',
  planId: plan.id,
  planName: plan.name,
  product: 'monthly-pass',
  paymentReference: transaction_id,   // UNIQUE identifier
  providerTransactionId: webhook_id,
  webhookData: req.body,              // Full webhook for audit
  ipAddress: req.ip,
  metadata: { promo_code: 'SAVE50' }
});
```

## Adding a New Payment Method

To add a new payment method (e.g., Stripe):

1. Create `/stripe/` directory
2. Create `handler.js` with webhook/processing logic
3. Create `config.js` with API keys and constants
4. Create `README.md` documenting the method
5. Import handler in `/src/bot/handlers/payments/index.js`
6. Add webhook route in `/src/bot/api/routes.js`
7. Call `PaymentHistoryService.recordPayment()` after processing

## Files for Reference

- **Main Handler**: `/src/bot/handlers/payments/index.js`
- **Activation Handler**: `/src/bot/handlers/payments/activation.js`
- **Payment Service**: `/src/services/paymentService.js`
- **Payment History Service**: `/src/services/paymentHistoryService.js`
- **Database Schema**: `/database/migrations/046_comprehensive_payment_history.sql`
