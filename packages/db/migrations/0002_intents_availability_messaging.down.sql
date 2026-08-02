-- Reverses 0002_intents_availability_messaging.sql. Drops all message
-- partitions along with the parent (CASCADE handles partitions implicitly
-- since they are child tables of `messages`).
DROP TABLE IF EXISTS notifications;
DROP TABLE IF EXISTS message_edits;
DROP TABLE IF EXISTS message_hides;
DROP TABLE IF EXISTS message_reactions;
DROP TABLE IF EXISTS messages;
DROP TYPE IF EXISTS message_type;
DROP TABLE IF EXISTS conversation_participants;
DROP TABLE IF EXISTS conversations;
DROP TABLE IF EXISTS match_suppressions;
DROP TABLE IF EXISTS blocks;
DROP TABLE IF EXISTS connection_requests;
DROP TYPE IF EXISTS request_status;
DROP TABLE IF EXISTS connections;
DROP TABLE IF EXISTS availability_live;
DROP TABLE IF EXISTS availability_session_intents;
DROP TABLE IF EXISTS availability_sessions;
DROP TABLE IF EXISTS availability_schedules;
DROP TYPE IF EXISTS availability_state;
DROP TABLE IF EXISTS inbound_intent_filters;
DROP TABLE IF EXISTS intent_complementarity;
DROP TABLE IF EXISTS user_intents;
DROP TYPE IF EXISTS intent_type;
