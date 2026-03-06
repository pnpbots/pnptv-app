-- 115: Add missing FKs, CHECK constraints, and indexes
-- Identified by comprehensive DB audit 2026-03-06

-- =============================================
-- Foreign Keys
-- =============================================

-- support_ticket_messages.user_id -> users(id)
DO $$ BEGIN
  ALTER TABLE support_ticket_messages
    ADD CONSTRAINT fk_stm_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- hangout_join_requests.user_id -> users(id)
DO $$ BEGIN
  ALTER TABLE hangout_join_requests
    ADD CONSTRAINT fk_hjr_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- hangout_join_requests.resolved_by -> users(id)
DO $$ BEGIN
  ALTER TABLE hangout_join_requests
    ADD CONSTRAINT fk_hjr_resolved_by FOREIGN KEY (resolved_by) REFERENCES users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- user_roles.user_id -> users(id)
DO $$ BEGIN
  ALTER TABLE user_roles
    ADD CONSTRAINT fk_ur_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- nearby_place_submissions.moderated_by -> users(id)
DO $$ BEGIN
  ALTER TABLE nearby_place_submissions
    ADD CONSTRAINT fk_nps_moderator FOREIGN KEY (moderated_by) REFERENCES users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- =============================================
-- CHECK Constraints
-- =============================================

-- dash_subscription_orders.status
DO $$ BEGIN
  ALTER TABLE dash_subscription_orders
    ADD CONSTRAINT chk_dso_status CHECK (status IN ('pending', 'completed', 'expired', 'invalid'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- users.subscription_status
DO $$ BEGIN
  ALTER TABLE users
    ADD CONSTRAINT chk_user_sub_status CHECK (subscription_status IN ('free', 'active', 'churned', 'expired'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- =============================================
-- Indexes
-- =============================================

CREATE INDEX IF NOT EXISTS idx_notifications_actor ON notifications (actor_id) WHERE actor_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_dso_user_status ON dash_subscription_orders (user_id, status);
CREATE INDEX IF NOT EXISTS idx_social_posts_repost_of ON social_posts (repost_of_id) WHERE repost_of_id IS NOT NULL AND is_deleted = false;
