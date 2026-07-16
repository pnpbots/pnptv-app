-- Migration 305: seed the 4 default topics for every top-level hangout that
-- has none. Idempotent: uses ON CONFLICT DO NOTHING on a unique (parent_group_id, name)
-- pair so re-running is safe. New hangouts already receive these topics at
-- creation time (hangoutGroupController.js createGroup).

DO $$
DECLARE
  g RECORD;
  topic_names TEXT[] := ARRAY['General', 'New Members', 'PNP Media', 'Wall of Fame'];
  topic_descs TEXT[] := ARRAY[
    'General discussion',
    'Welcome new members!',
    'Share media and content',
    'Top content highlighted by the community'
  ];
  topic_positions INT[] := ARRAY[0, 1, 2, 3];
  topic_readonly  BOOL[] := ARRAY[false, false, false, true];
  topic_wof       BOOL[] := ARRAY[false, false, false, true];
  i INT;
  new_topic_id INT;
BEGIN
  FOR g IN
    SELECT id, creator_id
    FROM hangout_groups
    WHERE is_main = true
      AND parent_group_id IS NULL
      AND id NOT IN (
        SELECT DISTINCT parent_group_id
        FROM hangout_groups
        WHERE parent_group_id IS NOT NULL
      )
  LOOP
    FOR i IN 1..4 LOOP
      INSERT INTO hangout_groups
        (name, description, creator_id, is_main, is_public, max_members,
         parent_group_id, position, is_read_only, is_wall_of_fame)
      VALUES
        (topic_names[i], topic_descs[i], g.creator_id, false, true, 200000,
         g.id, topic_positions[i], topic_readonly[i], topic_wof[i])
      RETURNING id INTO new_topic_id;

      -- Add creator as owner of the topic sub-group
      INSERT INTO hangout_group_members (group_id, user_id, role)
      VALUES (new_topic_id, g.creator_id, 'owner')
      ON CONFLICT (group_id, user_id) DO NOTHING;
    END LOOP;

    RAISE NOTICE 'Seeded 4 topics for hangout id=%', g.id;
  END LOOP;
END $$;
