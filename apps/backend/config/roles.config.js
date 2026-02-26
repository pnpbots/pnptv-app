const ROLES = {
  SUPERADMIN: 'superadmin',
  ADMIN: 'admin',
  MODERATOR: 'moderator',
  MODEL: 'model',
  USER: 'user'
};

const PERMISSIONS = {
  // Content
  UPLOAD_CONTENT: 'upload_content',
  EDIT_CONTENT: 'edit_content',
  APPROVE_CONTENT: 'approve_content',
  REJECT_CONTENT: 'reject_content',
  DELETE_CONTENT: 'delete_content',
  VIEW_CONTENT_REPORTS: 'view_content_reports',

  // Users
  VIEW_USERS: 'view_users',
  EDIT_USERS: 'edit_users',
  SUSPEND_USERS: 'suspend_users',
  DELETE_USERS: 'delete_users',
  VIEW_USER_REPORTS: 'view_user_reports',

  // Roles
  ASSIGN_ROLES: 'assign_roles',
  MANAGE_MODERATORS: 'manage_moderators',
  MANAGE_ADMINS: 'manage_admins',

  // Radio & Media
  MANAGE_RADIO: 'manage_radio',
  MANAGE_VIDEORAMA: 'manage_videorama',

  // Platform
  VIEW_REPORTS: 'view_reports',
  MANAGE_SETTINGS: 'manage_settings',
  VIEW_AUDIT_LOGS: 'view_audit_logs',
  VIEW_ANALYTICS: 'view_analytics'
};

const ROLE_HIERARCHY = {
  [ROLES.SUPERADMIN]: 4,
  [ROLES.ADMIN]: 3,
  [ROLES.MODERATOR]: 2,
  [ROLES.MODEL]: 1,
  [ROLES.USER]: 0
};

module.exports = {
  ROLES,
  PERMISSIONS,
  ROLE_HIERARCHY
};
