-- P15.2 (§10.7.3 "Search": "Postgres FTS (tsvector, English + simple
-- config)"). messages.search_vector is populated by a BEFORE INSERT OR
-- UPDATE trigger rather than at the application layer so every insert
-- path (send, forward, future ones) gets FTS for free without each one
-- remembering to compute it.
CREATE FUNCTION messages_search_vector_update() RETURNS trigger AS $$
BEGIN
  NEW.search_vector := to_tsvector('english', coalesce(NEW.body, ''));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_messages_search_vector
  BEFORE INSERT OR UPDATE OF body ON messages
  FOR EACH ROW EXECUTE FUNCTION messages_search_vector_update();
