const { v4: uuidv4 } = require('uuid');
const MenuConfigModel = require('../../models/menuConfigModel');
const UserModel = require('../../models/userModel');
const logger = require('../../utils/logger');

/**
 * Menu Config Service - Business logic for menu configuration
 */
class MenuConfigService {
  /**
   * Get all menu configurations
   * @returns {Promise<Array>} All menu configs
   */
  static async getAllMenus() {
    return await MenuConfigModel.getAll();
  }

  /**
   * Get menu by ID
   * @param {string} menuId - Menu ID
   * @returns {Promise<Object|null>} Menu config
   */
  static async getMenu(menuId) {
    return await MenuConfigModel.getById(menuId);
  }

  /**
   * Get menus available for a user based on their tier
   * @param {number|string} userId - User ID
   * @returns {Promise<Array>} Available menus
   */
  static async getAvailableMenusForUser(userId) {
    try {
      const user = await UserModel.getById(userId);
      const userPlanId = user?.planId || 'free';

      // Admins have access to all menus
      const PermissionService = require('../services/permissionService');
      const isAdmin = await PermissionService.isAdmin(userId);
      
      if (isAdmin) {
        return await MenuConfigModel.getAll();
      }

      if (!user?.onboardingComplete) {
        return [];
      }

      return await MenuConfigModel.getAvailableMenusForTier(userPlanId);
    } catch (error) {
      logger.error('Error getting available menus for user:', error);
      return [];
    }
  }

  /**
   * Check if a menu is available for a user
   * @param {string} menuId - Menu ID
   * @param {number|string} userId - User ID
   * @returns {Promise<boolean>} True if menu is available
   */
  static async isMenuAvailableForUser(menuId, userId) {
    try {
      const user = await UserModel.getById(userId);
      const userPlanId = user?.planId || 'free';

      // Admins have access to all menus
      const PermissionService = require('../services/permissionService');
      const isAdmin = await PermissionService.isAdmin(userId);
      
      if (isAdmin) {
        return true;
      }

      if (!user?.onboardingComplete) {
        return false;
      }

      return await MenuConfigModel.isMenuAvailable(menuId, userPlanId);
    } catch (error) {
      logger.error('Error checking menu availability for user:', error);
      return false;
    }
  }

  /**
   * Update menu configuration (status, tiers, etc.)
   * @param {string} menuId - Menu ID
   * @param {Object} updates - Updates to apply
   * @param {number|string} updatedBy - Admin userId making the change
   * @returns {Promise<{success: boolean, message: string, menu?: Object}>} Result
   */
  static async updateMenuConfig(menuId, updates, updatedBy) {
    try {
      const menu = await MenuConfigModel.getById(menuId);

      if (!menu) {
        return {
          success: false,
          message: 'Menu not found',
        };
      }

      // Check if menu is customizable
      if (!menu.customizable && menu.type === 'default') {
        return {
          success: false,
          message: 'This system menu cannot be modified',
        };
      }

      // Prepare update data
      const updateData = {
        ...updates,
        updatedBy,
      };

      // Update in database
      const updatedMenu = await MenuConfigModel.createOrUpdate(menuId, updateData);

      logger.info(`Menu updated: ${menuId} by ${updatedBy}`);

      return {
        success: true,
        message: 'Menu updated successfully',
        menu: updatedMenu,
      };
    } catch (error) {
      logger.error('Error updating menu config:', error);
      return {
        success: false,
        message: 'Failed to update menu',
      };
    }
  }

  /**
   * Set menu status (active, disabled, tier_restricted)
   * @param {string} menuId - Menu ID
   * @param {string} status - Status to set
   * @param {Array<string>} allowedTiers - Allowed tiers (for tier_restricted)
   * @param {number|string} updatedBy - Admin userId
   * @returns {Promise<{success: boolean, message: string}>} Result
   */
  static async setMenuStatus(menuId, status, allowedTiers = [], updatedBy) {
    try {
      const validStatuses = ['active', 'disabled', 'tier_restricted'];

      if (!validStatuses.includes(status)) {
        return {
          success: false,
          message: `Invalid status. Must be one of: ${validStatuses.join(', ')}`,
        };
      }

      const updates = {
        status,
        allowedTiers: status === 'tier_restricted' ? allowedTiers : [],
      };

      return await this.updateMenuConfig(menuId, updates, updatedBy);
    } catch (error) {
      logger.error('Error setting menu status:', error);
      return {
        success: false,
        message: 'Failed to set menu status',
      };
    }
  }

  /**
   * Create custom menu
   * @param {Object} menuData - Menu data
   * @param {number|string} createdBy - Admin userId creating the menu
   * @returns {Promise<{success: boolean, message: string, menu?: Object}>} Result
   */
  static async createCustomMenu(menuData, createdBy) {
    try {
      // Validate required fields
      const requiredFields = ['name', 'icon', 'actionType'];
      const missingFields = requiredFields.filter((field) => !menuData[field]);

      if (missingFields.length > 0) {
        return {
          success: false,
          message: `Missing required fields: ${missingFields.join(', ')}`,
        };
      }

      // Generate unique menu ID
      const menuId = `custom_${uuidv4().substring(0, 8)}`;

      // Get current max order
      const allMenus = await MenuConfigModel.getAll();
      const maxOrder = Math.max(...allMenus.map((m) => m.order || 0), 0);

      // Prepare menu data
      const menu = {
        menuId,
        name: menuData.name,
        nameEs: menuData.nameEs || menuData.name,
        parentId: menuData.parentId || null,
        status: menuData.status || 'active',
        allowedTiers: menuData.allowedTiers || [],
        order: menuData.order || maxOrder + 1,
        icon: menuData.icon,
        action: `custom_${menuId}`,
        type: 'custom',
        actionType: menuData.actionType,
        actionData: menuData.actionData || {},
        customizable: true,
        deletable: true,
        createdBy,
      };

      // Create in database
      const createdMenu = await MenuConfigModel.createOrUpdate(menuId, menu);

      logger.info(`Custom menu created: ${menuId} by ${createdBy}`);

      return {
        success: true,
        message: 'Custom menu created successfully',
        menu: createdMenu,
      };
    } catch (error) {
      logger.error('Error creating custom menu:', error);
      return {
        success: false,
        message: 'Failed to create custom menu',
      };
    }
  }

  /**
   * Delete custom menu
   * @param {string} menuId - Menu ID
   * @param {number|string} deletedBy - Admin userId deleting the menu
   * @returns {Promise<{success: boolean, message: string}>} Result
   */
  static async deleteCustomMenu(menuId, deletedBy) {
    try {
      const menu = await MenuConfigModel.getById(menuId);

      if (!menu) {
        return {
          success: false,
          message: 'Menu not found',
        };
      }

      if (!menu.deletable) {
        return {
          success: false,
          message: 'This system menu cannot be deleted',
        };
      }

      const deleted = await MenuConfigModel.delete(menuId);

      if (deleted) {
        logger.info(`Menu deleted: ${menuId} by ${deletedBy}`);
        return {
          success: true,
          message: 'Menu deleted successfully',
        };
      }

      return {
        success: false,
        message: 'Failed to delete menu',
      };
    } catch (error) {
      logger.error('Error deleting menu:', error);
      return {
        success: false,
        message: 'Failed to delete menu',
      };
    }
  }

  /**
   * Reorder menus
   * @param {Array<string>} menuIds - Menu IDs in desired order
   * @param {number|string} reorderedBy - Admin userId reordering
   * @returns {Promise<{success: boolean, message: string}>} Result
   */
  static async reorderMenus(menuIds, reorderedBy) {
    try {
      const reordered = await MenuConfigModel.reorderMenus(menuIds);

      if (reordered) {
        logger.info(`Menus reordered by ${reorderedBy}`);
        return {
          success: true,
          message: 'Menus reordered successfully',
        };
      }

      return {
        success: false,
        message: 'Failed to reorder menus',
      };
    } catch (error) {
      logger.error('Error reordering menus:', error);
      return {
        success: false,
        message: 'Failed to reorder menus',
      };
    }
  }

  /**
   * Duplicate menu (clone existing menu)
   * @param {string} sourceMenuId - Menu ID to duplicate
   * @param {number|string} createdBy - Admin userId creating the duplicate
   * @returns {Promise<{success: boolean, message: string, menu?: Object}>} Result
   */
  static async duplicateMenu(sourceMenuId, createdBy) {
    try {
      const sourceMenu = await MenuConfigModel.getById(sourceMenuId);

      if (!sourceMenu) {
        return {
          success: false,
          message: 'Source menu not found',
        };
      }

      // Create new menu data from source
      const menuData = {
        name: `${sourceMenu.name} (Copy)`,
        nameEs: `${sourceMenu.nameEs} (Copia)`,
        icon: sourceMenu.icon,
        actionType: sourceMenu.actionType,
        actionData: sourceMenu.actionData,
        status: sourceMenu.status,
        allowedTiers: sourceMenu.allowedTiers,
        parentId: sourceMenu.parentId,
      };

      return await this.createCustomMenu(menuData, createdBy);
    } catch (error) {
      logger.error('Error duplicating menu:', error);
      return {
        success: false,
        message: 'Failed to duplicate menu',
      };
    }
  }

  /**
   * Get menu statistics (for admin dashboard)
   * @returns {Promise<Object>} Menu statistics
   */
  static async getMenuStatistics() {
    try {
      const allMenus = await MenuConfigModel.getAll();

      const stats = {
        total: allMenus.length,
        active: allMenus.filter((m) => m.status === 'active').length,
        disabled: allMenus.filter((m) => m.status === 'disabled').length,
        tierRestricted: allMenus.filter((m) => m.status === 'tier_restricted').length,
        custom: allMenus.filter((m) => m.type === 'custom').length,
        system: allMenus.filter((m) => m.type === 'default').length,
      };

      return stats;
    } catch (error) {
      logger.error('Error getting menu statistics:', error);
      return {
        total: 0,
        active: 0,
        disabled: 0,
        tierRestricted: 0,
        custom: 0,
        system: 0,
      };
    }
  }

  /**
   * Validate menu data
   * @param {Object} menuData - Menu data to validate
   * @returns {{valid: boolean, errors: Array<string>}} Validation result
   */
  static validateMenuData(menuData) {
    const errors = [];

    // Required fields
    if (!menuData.name || menuData.name.trim() === '') {
      errors.push('Name is required');
    }

    if (!menuData.icon || menuData.icon.trim() === '') {
      errors.push('Icon is required');
    }

    if (!menuData.actionType) {
      errors.push('Action type is required');
    } else {
      // Validate action type
      const validActionTypes = ['message', 'url', 'submenu', 'command'];
      if (!validActionTypes.includes(menuData.actionType)) {
        errors.push(`Invalid action type. Must be one of: ${validActionTypes.join(', ')}`);
      }

      // Validate action data based on type
      if (menuData.actionType === 'message' && !menuData.actionData?.text) {
        errors.push('Message text is required for message action type');
      }

      if (menuData.actionType === 'url' && !menuData.actionData?.url) {
        errors.push('URL is required for URL action type');
      }

      if (menuData.actionType === 'command' && !menuData.actionData?.command) {
        errors.push('Command is required for command action type');
      }
    }

    // Validate status
    if (menuData.status) {
      const validStatuses = ['active', 'disabled', 'tier_restricted'];
      if (!validStatuses.includes(menuData.status)) {
        errors.push(`Invalid status. Must be one of: ${validStatuses.join(', ')}`);
      }
    }

    // Validate allowed tiers
    if (menuData.allowedTiers && Array.isArray(menuData.allowedTiers)) {
      const validTiers = ['free', 'basic', 'premium', 'gold'];
      const invalidTiers = menuData.allowedTiers.filter((tier) => !validTiers.includes(tier));

      if (invalidTiers.length > 0) {
        errors.push(`Invalid tiers: ${invalidTiers.join(', ')}. Valid tiers: ${validTiers.join(', ')}`);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Initialize default menus in database
   * @returns {Promise<boolean>} Success status
   */
  static async initializeDefaultMenus() {
    return await MenuConfigModel.initializeDefaultMenus();
  }
}

module.exports = MenuConfigService;
