-- P16.1 (§17.7): "files are served only via 10-minute signed URLs scoped
-- to a participant check." The PRD's own media DDL has no FK from media
-- to conversations/messages (attachment linkage flows the other way,
-- via messages.attachments), so there's nothing to check membership
-- against for a message_image/message_file upload. This nullable,
-- optionally-set-at-commit-time column is the minimum needed to make
-- "participant check" a real, checkable thing for that case; every
-- other kind (avatar, resume, export, voice) has conversation_id NULL
-- and falls back to an owner-only check.
ALTER TABLE media
  ADD COLUMN conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL;

CREATE INDEX idx_media_conversation ON media(conversation_id) WHERE conversation_id IS NOT NULL;
