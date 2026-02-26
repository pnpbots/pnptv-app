const { query } = require('../config/postgres');
const { cache } = require('../config/redis');
const logger = require('../utils/logger');

const TABLE = 'nearby_place_categories';
const CACHE_PREFIX = 'nearby_place_cat';
const CACHE_TTL = 3600; // 1 hour for categories (rarely change)

/**
 * Nearby Place Category Model - Handles category data operations
 */
class NearbyPlaceCategoryModel {
  /**
   * Map database row to category object
   */
  static mapRowToCategory(row) {
    if (!row) return null;
    return {
      id: row.id,
      slug: row.slug,
      nameEn: row.name_en,
      nameEs: row.name_es,
      descriptionEn: row.description_en,
      descriptionEs: row.description_es,
      emoji: row.emoji,
      sortOrder: row.sort_order,
      isActive: row.is_active,
      requiresAgeVerification: row.requires_age_verification,
      parentCategoryId: row.parent_category_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Get all categories
   */
  static async getAll(activeOnly = true) {
    try {
      const cacheKey = `${CACHE_PREFIX}:all:${activeOnly}`;

      // Try cache first
      const cached = await cache.get(cacheKey);
      if (cached) return cached;

      const sql = activeOnly
        ? `SELECT * FROM ${TABLE} WHERE is_active = true ORDER BY sort_order ASC`
        : `SELECT * FROM ${TABLE} ORDER BY sort_order ASC`;

      const result = await query(sql);
      const categories = result.rows.map(row => this.mapRowToCategory(row));

      // Cache results
      if (cache.set) await cache.set(cacheKey, categories, CACHE_TTL);

      return categories;
    } catch (error) {
      logger.error('Error getting place categories:', error);
      return [];
    }
  }

  /**
   * Get category by ID
   */
  static async getById(categoryId) {
    try {
      const cacheKey = `${CACHE_PREFIX}:${categoryId}`;

      // Try cache first
      const cached = await cache.get(cacheKey);
      if (cached) return cached;

      const result = await query(`SELECT * FROM ${TABLE} WHERE id = $1`, [categoryId]);
      if (result.rows.length === 0) return null;

      const category = this.mapRowToCategory(result.rows[0]);

      // Cache result
      if (cache.set) await cache.set(cacheKey, category, CACHE_TTL);

      return category;
    } catch (error) {
      logger.error('Error getting category by ID:', error);
      return null;
    }
  }

  /**
   * Get category by slug
   */
  static async getBySlug(slug) {
    try {
      const cacheKey = `${CACHE_PREFIX}:slug:${slug}`;

      // Try cache first
      const cached = await cache.get(cacheKey);
      if (cached) return cached;

      const result = await query(`SELECT * FROM ${TABLE} WHERE slug = $1`, [slug]);
      if (result.rows.length === 0) return null;

      const category = this.mapRowToCategory(result.rows[0]);

      // Cache result
      if (cache.set) await cache.set(cacheKey, category, CACHE_TTL);

      return category;
    } catch (error) {
      logger.error('Error getting category by slug:', error);
      return null;
    }
  }

  /**
   * Create a new category (admin)
   */
  static async create(categoryData) {
    try {
      const sql = `
        INSERT INTO ${TABLE} (
          slug, name_en, name_es, description_en, description_es,
          emoji, sort_order, is_active, requires_age_verification, parent_category_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING *
      `;

      const result = await query(sql, [
        categoryData.slug,
        categoryData.nameEn,
        categoryData.nameEs,
        categoryData.descriptionEn || null,
        categoryData.descriptionEs || null,
        categoryData.emoji || null,
        categoryData.sortOrder || 0,
        categoryData.isActive !== false,
        categoryData.requiresAgeVerification || false,
        categoryData.parentCategoryId || null,
      ]);

      // Clear cache
      await cache.delPattern(`${CACHE_PREFIX}:*`);

      logger.info('Place category created', { slug: categoryData.slug });
      return this.mapRowToCategory(result.rows[0]);
    } catch (error) {
      logger.error('Error creating place category:', error);
      throw error;
    }
  }

  /**
   * Update a category
   */
  static async update(categoryId, updates) {
    try {
      const setClauses = ['updated_at = NOW()'];
      const values = [categoryId];
      let paramIndex = 2;

      const fieldMap = {
        slug: 'slug',
        nameEn: 'name_en',
        nameEs: 'name_es',
        descriptionEn: 'description_en',
        descriptionEs: 'description_es',
        emoji: 'emoji',
        sortOrder: 'sort_order',
        isActive: 'is_active',
        requiresAgeVerification: 'requires_age_verification',
        parentCategoryId: 'parent_category_id',
      };

      for (const [key, col] of Object.entries(fieldMap)) {
        if (updates[key] !== undefined) {
          setClauses.push(`${col} = $${paramIndex++}`);
          values.push(updates[key]);
        }
      }

      if (setClauses.length === 1) {
        return await this.getById(categoryId);
      }

      const result = await query(
        `UPDATE ${TABLE} SET ${setClauses.join(', ')} WHERE id = $1 RETURNING *`,
        values
      );

      // Clear cache
      await cache.delPattern(`${CACHE_PREFIX}:*`);

      logger.info('Place category updated', { categoryId });
      return result.rows.length > 0 ? this.mapRowToCategory(result.rows[0]) : null;
    } catch (error) {
      logger.error('Error updating place category:', error);
      throw error;
    }
  }
}

module.exports = NearbyPlaceCategoryModel;
