DROP INDEX IF EXISTS idx_media_conversation;
ALTER TABLE media DROP COLUMN IF EXISTS conversation_id;
