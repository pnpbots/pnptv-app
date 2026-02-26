const { getPool } = require('../../config/postgres');
const logger = require('../../utils/logger');
const { ROLES, ROLE_HIERARCHY } = require('../../config/roles.config');
const { cache } = require('../../config/redis');

class RoleService {
  static CACHE_PREFIX = 'role:';
  static CACHE_TTL = 3600;

  async assignRole(userId, roleName, assignedBy, reason = '') {
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');

      // Get role ID
      const roleQuery = 'SELECT id FROM roles WHERE name = $1';
      const roleResult = await client.query(roleQuery, [roleName]);

      if (roleResult.rows.length === 0) {
        throw new Error('Rol no encontrado');
      }

      const roleId = roleResult.rows[0].id;

      // Check if user exists
      const userQuery = 'SELECT id FROM users WHERE id = $1';
      const userResult = await client.query(userQuery, [userId]);

      if (userResult.rows.length === 0) {
        throw new Error('Usuario no encontrado');
      }

      // Check actor rank vs target rank
      const actorQuery = 'SELECT rank FROM roles WHERE name = (SELECT primary_role FROM users WHERE id = $1)';
      const actorResult = await client.query(actorQuery, [assignedBy]);
      const actorRank = actorResult.rows[0]?.rank || 0;
      const targetRank = ROLE_HIERARCHY[roleName] || 0;

      if (actorRank <= targetRank && assignedBy !== userId) {
        throw new Error('No puedes asignar roles de igual o mayor rango');
      }

      // Insert or update user_roles
      const insertQuery = `
        INSERT INTO user_roles (user_id, role_id, assigned_by, reason, assigned_at)
        VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
        ON CONFLICT (user_id, role_id) DO UPDATE SET
          assigned_by = $3,
          reason = $4,
          assigned_at = CURRENT_TIMESTAMP
        RETURNING id
      `;

      await client.query(insertQuery, [userId, roleId, assignedBy, reason]);

      // Update primary role
      await client.query('UPDATE users SET role_id = $1, primary_role = $2 WHERE id = $3', [roleId, roleName, userId]);

      await client.query('COMMIT');

      // Clear cache
      await cache.del(`${RoleService.CACHE_PREFIX}user:${userId}:roles`);

      logger.info(`Rol asignado: Usuario ${userId} <- ${roleName} (por ${assignedBy})`);

      return { success: true, userId, roleName, assignedBy, reason };
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Error asignando rol:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  async removeRole(userId, roleName, removedBy) {
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');

      const roleQuery = 'SELECT id FROM roles WHERE name = $1';
      const roleResult = await client.query(roleQuery, [roleName]);

      if (roleResult.rows.length === 0) {
        throw new Error('Rol no encontrado');
      }

      const roleId = roleResult.rows[0].id;

      await client.query('DELETE FROM user_roles WHERE user_id = $1 AND role_id = $2', [userId, roleId]);

      // Reset to user role if removing primary role
      const userQuery = 'SELECT primary_role FROM users WHERE id = $1';
      const userResult = await client.query(userQuery, [userId]);

      if (userResult.rows[0].primary_role === roleName) {
        const defaultRoleQuery = 'SELECT id FROM roles WHERE name = $1';
        const defaultRole = await client.query(defaultRoleQuery, [ROLES.USER]);

        await client.query('UPDATE users SET role_id = $1, primary_role = $2 WHERE id = $3', [
          defaultRole.rows[0].id,
          ROLES.USER,
          userId
        ]);
      }

      await client.query('COMMIT');

      await cache.del(`${RoleService.CACHE_PREFIX}user:${userId}:roles`);

      logger.info(`Rol removido: Usuario ${userId} de ${roleName} (por ${removedBy})`);

      return { success: true, userId, roleName };
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Error removiendo rol:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  async getUserRoles(userId) {
    const cacheKey = `${RoleService.CACHE_PREFIX}user:${userId}:roles`;
    const cached = await cache.get(cacheKey);

    if (cached) {
      return JSON.parse(cached);
    }

    const query = `
      SELECT r.id, r.name, r.display_name, r.rank, ur.assigned_at, ur.assigned_by, ur.reason
      FROM user_roles ur
      JOIN roles r ON ur.role_id = r.id
      WHERE ur.user_id = $1
      ORDER BY r.rank DESC
    `;

    const result = await getPool().query(query, [userId]);
    const roles = result.rows;

    await cache.setex(cacheKey, RoleService.CACHE_TTL, JSON.stringify(roles));

    return roles;
  }

  async hasPermission(userId, permissionName) {
    const query = `
      SELECT COUNT(*) as count
      FROM users u
      LEFT JOIN user_roles ur ON u.id = ur.user_id
      LEFT JOIN roles r ON COALESCE(ur.role_id, u.role_id) = r.id
      LEFT JOIN role_permissions rp ON r.id = rp.role_id
      LEFT JOIN permissions p ON rp.permission_id = p.id
      WHERE u.id = $1 AND (p.name = $2 OR r.name = $3)
    `;

    const result = await getPool().query(query, [userId, permissionName, ROLES.SUPERADMIN]);
    return result.rows[0].count > 0;
  }

  async listRoles() {
    const query = `
      SELECT r.id, r.name, r.display_name, r.description, r.rank, r.is_system,
             COUNT(ur.id) as user_count,
             COUNT(DISTINCT rp.permission_id) as permission_count
      FROM roles r
      LEFT JOIN user_roles ur ON r.id = ur.role_id
      LEFT JOIN role_permissions rp ON r.id = rp.role_id
      GROUP BY r.id
      ORDER BY r.rank DESC
    `;

    const result = await getPool().query(query);
    return result.rows;
  }

  async getPermissionsForRole(roleName) {
    const query = `
      SELECT p.id, p.name, p.display_name, p.description, p.category
      FROM role_permissions rp
      JOIN permissions p ON rp.permission_id = p.id
      JOIN roles r ON rp.role_id = r.id
      WHERE r.name = $1
      ORDER BY p.category, p.display_name
    `;

    const result = await getPool().query(query, [roleName]);
    return result.rows;
  }

  async filterUsersByRole(roleName, offset = 0, limit = 20) {
    const query = `
      SELECT DISTINCT u.id, u.email, u.username, u.telegram_id, u.status, r.name as role, r.display_name, r.rank
      FROM users u
      LEFT JOIN user_roles ur ON u.id = ur.user_id
      LEFT JOIN roles r ON COALESCE(ur.role_id, u.role_id) = r.id
      WHERE (r.name = $1 OR (r.name IS NULL AND $1 = $2))
      ORDER BY u.created_at DESC
      LIMIT $3 OFFSET $4
    `;

    const countQuery = `
      SELECT COUNT(DISTINCT u.id) as count
      FROM users u
      LEFT JOIN user_roles ur ON u.id = ur.user_id
      LEFT JOIN roles r ON COALESCE(ur.role_id, u.role_id) = r.id
      WHERE (r.name = $1 OR (r.name IS NULL AND $1 = $2))
    `;

    const [dataResult, countResult] = await Promise.all([
      getPool().query(query, [roleName, ROLES.USER, limit, offset]),
      getPool().query(countQuery, [roleName, ROLES.USER])
    ]);

    return {
      users: dataResult.rows,
      total: parseInt(countResult.rows[0].count),
      offset,
      limit
    };
  }
}

module.exports = new RoleService();
