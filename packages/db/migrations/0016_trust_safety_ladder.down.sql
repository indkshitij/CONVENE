DROP TABLE IF EXISTS appeals;
DROP TABLE IF EXISTS moderation_action_approvals;
ALTER TABLE moderation_actions DROP CONSTRAINT IF EXISTS chk_moderation_action_status;
ALTER TABLE moderation_actions DROP COLUMN IF EXISTS status;
ALTER TABLE moderation_actions ALTER COLUMN admin_id SET NOT NULL;
ALTER TABLE reports DROP CONSTRAINT IF EXISTS chk_report_category;
