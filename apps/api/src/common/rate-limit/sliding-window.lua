-- Atomic sliding-window-log rate limiter (PRD §17.6/P3.4).
--
-- KEYS[1] = rate limit key
-- ARGV[1] = now, in milliseconds
-- ARGV[2] = window size, in milliseconds
-- ARGV[3] = limit (max requests allowed within the window)
-- ARGV[4] = unique member id for this attempt (caller-generated, e.g. a
--           uuidv7 — required because ZADD would silently coalesce two
--           requests that landed on the same millisecond if they shared a
--           member string)
--
-- Returns { allowed (1/0), count } where count is the number of requests
-- recorded in the window *after* this attempt (including it, if allowed).
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local member = ARGV[4]

redis.call('ZREMRANGEBYSCORE', key, '-inf', now - window)
local count = redis.call('ZCARD', key)

if count < limit then
  redis.call('ZADD', key, now, member)
  redis.call('PEXPIRE', key, window)
  return { 1, count + 1 }
else
  return { 0, count }
end
