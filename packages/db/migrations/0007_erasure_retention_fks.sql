-- P5.5 / §20.6 "Erasure": hard-purging a user (the retention worker that
-- will run 30 days after migrations/0004's users.deletion_requested_at is
-- set — that worker itself is a later ops phase, not built here) must not
-- destroy the documented exceptions: financial records (7 yrs),
-- safety records of upheld reports, and the counterparty's copy of shared
-- messages (anonymised to "Deleted user", not destroyed).
--
-- subscriptions.user_id and moderation_actions.target_user_id were
-- ON DELETE CASCADE, and messages.sender_id had no ON DELETE clause at all
-- (Postgres's default, NO ACTION, which would instead BLOCK a purge
-- outright for any user who ever sent a message) — all three predate this
-- retention requirement being addressed concretely. Fixed to SET NULL, an
-- expand change (nullable + a less-destructive ON DELETE action), so a
-- future purge preserves the row while detaching the identity.
ALTER TABLE subscriptions ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE subscriptions DROP CONSTRAINT subscriptions_user_id_fkey;
ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE moderation_actions ALTER COLUMN target_user_id DROP NOT NULL;
ALTER TABLE moderation_actions DROP CONSTRAINT moderation_actions_target_user_id_fkey;
ALTER TABLE moderation_actions ADD CONSTRAINT moderation_actions_target_user_id_fkey
  FOREIGN KEY (target_user_id) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE messages ALTER COLUMN sender_id DROP NOT NULL;
ALTER TABLE messages DROP CONSTRAINT messages_sender_id_fkey;
ALTER TABLE messages ADD CONSTRAINT messages_sender_id_fkey
  FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE SET NULL;
