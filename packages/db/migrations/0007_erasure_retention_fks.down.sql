ALTER TABLE messages DROP CONSTRAINT messages_sender_id_fkey;
ALTER TABLE messages ADD CONSTRAINT messages_sender_id_fkey
  FOREIGN KEY (sender_id) REFERENCES users(id);
ALTER TABLE messages ALTER COLUMN sender_id SET NOT NULL;

ALTER TABLE moderation_actions DROP CONSTRAINT moderation_actions_target_user_id_fkey;
ALTER TABLE moderation_actions ADD CONSTRAINT moderation_actions_target_user_id_fkey
  FOREIGN KEY (target_user_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE moderation_actions ALTER COLUMN target_user_id SET NOT NULL;

ALTER TABLE subscriptions DROP CONSTRAINT subscriptions_user_id_fkey;
ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE subscriptions ALTER COLUMN user_id SET NOT NULL;
