import { pgEnum } from "drizzle-orm/pg-core";

// PRD §16.3 IDENTITY
export const userStatus = pgEnum("user_status", [
  "pending_verification",
  "active",
  "restricted",
  "shadow_limited",
  "suspended",
  "deleted",
]);

export const userRole = pgEnum("user_role", ["user", "recruiter", "admin", "moderator", "support"]);

// PRD §16.3 PROFILE
export const visibility = pgEnum("visibility", [
  "public",
  "authenticated",
  "connections_only",
  "matches_only",
  "private",
]);

export const locPrivacy = pgEnum("loc_privacy", ["exact", "city_only", "country_only", "hidden"]);

export const remotePref = pgEnum("remote_pref", ["onsite", "hybrid", "remote", "any"]);

export const employmentType = pgEnum("employment_type", [
  "full_time",
  "part_time",
  "contract",
  "freelance",
  "self_employed",
  "student",
  "unemployed",
  "founder",
]);

// PRD §10.4.8 Intents
export const intentType = pgEnum("intent_type", [
  "looking_for_job",
  "hiring",
  "need_cofounder",
  "need_mentor",
  "need_mentee",
  "internship",
  "freelancer",
  "startup_discussion",
  "ai_collaboration",
  "business_networking",
  "coffee_chat",
  "learning",
  "investment_discussion",
  "partnerships",
]);

// PRD §10.3.9 Availability
export const availabilityState = pgEnum("availability_state", [
  "available_now",
  "busy",
  "away",
  "invisible",
  "offline",
  "scheduled",
]);

// PRD §10.6.8 Connections
export const requestStatus = pgEnum("request_status", [
  "pending",
  "accepted",
  "rejected",
  "cancelled",
  "expired",
]);

// PRD §10.7.7 Messaging
export const messageType = pgEnum("message_type", [
  "text",
  "image",
  "file",
  "voice",
  "system",
  "scheduling",
]);
