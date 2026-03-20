/**
 * Initialize default plans in the database
 */

require('dotenv').config();
const Plan = require('../src/models/planModel');
const logger = require('../src/utils/logger');

async function initPlans() {
  try {
    logger.info('Initializing default plans...');

    const success = await Plan.initializeDefaultPlans();

    if (success) {
      logger.info('✅ Default plans initialized successfully');

      // Verify plans were created
      const plans = await Plan.getAll();
      logger.info(`Found ${plans.length} plans in database:`);
      plans.forEach(plan => {
        logger.info(`- ${plan.id}: ${plan.name} ($${plan.price} for ${plan.duration} days)`);
      });

      return true;
    } else {
      logger.error('Failed to initialize plans');
      return false;
    }
  } catch (error) {
    logger.error('Error initializing plans:', error);
    return false;
  }
}

initPlans()
  .then((success) => {
    if (success) {
      console.log('\n✅ Plans initialization completed!');
      process.exit(0);
    } else {
      console.error('\n❌ Plans initialization failed');
      process.exit(1);
    }
  })
  .catch((error) => {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  });
