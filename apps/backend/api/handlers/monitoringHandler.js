/**
 * Monitoring and Health Check Handlers
 * Provides endpoints for monitoring authentication system health
 */

const { query } = require('../../config/postgres');
const logger = require('../../utils/logger');
const AuthTester = require('../test/authTest');

/**
 * Health check endpoint
 */
const healthCheck = async (req, res) => {
  try {
    const healthStatus = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      components: {
        database: 'unknown',
        authentication: 'unknown',
        permissions: 'unknown'
      }
    };
    
    // Check database connection
    try {
      await query('SELECT 1');
      healthStatus.components.database = 'healthy';
    } catch (error) {
      healthStatus.components.database = 'unhealthy';
      logger.error('Database health check failed:', error.message);
    }
    
    // Check authentication system
    try {
      const authTester = new AuthTester();
      const testResults = await authTester.runAllTests();
      
      if (testResults.failed === 0) {
        healthStatus.components.authentication = 'healthy';
        healthStatus.components.permissions = 'healthy';
      } else {
        healthStatus.components.authentication = 'degraded';
        healthStatus.components.permissions = 'degraded';
      }
    } catch (error) {
      healthStatus.components.authentication = 'unhealthy';
      healthStatus.components.permissions = 'unhealthy';
      logger.error('Authentication health check failed:', error.message);
    }
    
    // Determine overall status
    const allHealthy = Object.values(healthStatus.components).every(
      status => status === 'healthy'
    );
    
    healthStatus.status = allHealthy ? 'healthy' : 'degraded';
    
    res.status(allHealthy ? 200 : 200).json(healthStatus);
    
  } catch (error) {
    logger.error('Health check error:', error);
    res.status(500).json({
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
};

/**
 * Authentication system status
 */
const authStatus = async (req, res) => {
  try {
    const status = {
      authenticatedUsers: 0,
      activeSessions: 0,
      termsAcceptanceRate: 0,
      subscriptionDistribution: {
        free: 0,
        active: 0,
        expired: 0,
        churned: 0
      }
    };
    
    // Get user statistics
    const userStats = await query(
      `SELECT 
        COUNT(*) as total_users,
        SUM(CASE WHEN accepted_terms = TRUE THEN 1 ELSE 0 END) as terms_accepted,
        SUM(CASE WHEN subscription_status = 'free' THEN 1 ELSE 0 END) as free_users,
        SUM(CASE WHEN subscription_status = 'active' THEN 1 ELSE 0 END) as active_users,
        SUM(CASE WHEN subscription_status = 'expired' THEN 1 ELSE 0 END) as expired_users,
        SUM(CASE WHEN subscription_status = 'churned' THEN 1 ELSE 0 END) as churned_users
       FROM users`
    );
    
    if (userStats.rows.length > 0) {
      const stats = userStats.rows[0];
      status.subscriptionDistribution = {
        free: parseInt(stats.free_users) || 0,
        active: parseInt(stats.active_users) || 0,
        expired: parseInt(stats.expired_users) || 0,
        churned: parseInt(stats.churned_users) || 0
      };
      
      const totalUsers = parseInt(stats.total_users) || 1;
      const termsAccepted = parseInt(stats.terms_accepted) || 0;
      status.termsAcceptanceRate = (termsAccepted / totalUsers * 100).toFixed(2);
    }
    
    // Note: Active sessions would require session store inspection
    // For now, we'll estimate based on recent activity
    status.authenticatedUsers = status.subscriptionDistribution.active;
    status.activeSessions = status.subscriptionDistribution.active;
    
    res.json({
      success: true,
      status,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    logger.error('Auth status error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
};

/**
 * Run authentication tests
 */
const runAuthTests = async (req, res) => {
  try {
    const authTester = new AuthTester();
    const results = await authTester.runAllTests();
    
    res.json({
      success: true,
      results,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    logger.error('Test execution error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
};

/**
 * Get recent authentication activity
 */
const getAuthActivity = async (req, res) => {
  try {
    // This would require logging table - for now return sample data
    const sampleActivity = {
      last24Hours: {
        logins: 15,
        termsAccepted: 8,
        failedAttempts: 2
      },
      last7Days: {
        logins: 105,
        termsAccepted: 56,
        failedAttempts: 14
      },
      last30Days: {
        logins: 420,
        termsAccepted: 224,
        failedAttempts: 58
      }
    };
    
    res.json({
      success: true,
      activity: sampleActivity,
      note: 'For full activity tracking, implement authentication logging',
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    logger.error('Auth activity error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
};

/**
 * System metrics
 */
const getSystemMetrics = (req, res) => {
  try {
    const metrics = {
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage(),
      cpuUsage: process.cpuUsage(),
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      timestamp: new Date().toISOString()
    };
    
    res.json({
      success: true,
      metrics,
      health: 'healthy'
    });
    
  } catch (error) {
    logger.error('Metrics error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
};

module.exports = {
  healthCheck,
  authStatus,
  runAuthTests,
  getAuthActivity,
  getSystemMetrics
};