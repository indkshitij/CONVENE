-- P18.1 (§10.10): eight report categories with SLAs, the enforcement
-- ladder, and two-admin approval for permanent bans.

-- §10.10.2's eight categories, transcribed as stable snake_case slugs.
-- The pre-existing automated report writer (messages.repository.ts's
-- createModerationCase, P15.2) used a free-text "inappropriate_content"
-- category — updated in the same change that adds this constraint (see
-- moderation-deep-scan.service.ts) to "other", the closest of the eight
-- ("Other / inappropriate content"), so this CHECK doesn't break it.
ALTER TABLE reports
  ADD CONSTRAINT chk_report_category CHECK (
    category IN (
      'child_safety',
      'threats_violence',
      'harassment_hate',
      'scam_fraud',
      'sexual_content',
      'impersonation',
      'spam',
      'other'
    )
  );

-- Automated auto-actions (§10.10.2's "auto-action pending review" column)
-- have no acting human admin — relaxed from the original NOT NULL so a
-- system-triggered moderation_actions row can carry NULL here. This is a
-- pure expand (widens what's allowed), so every existing row (all
-- human-actioned so far) keeps working unchanged.
ALTER TABLE moderation_actions
  ALTER COLUMN admin_id DROP NOT NULL;

-- §10.10.3: "all actions are reversible except a Critical ban, which
-- requires two-admin approval." A ban starts life as pending_approval
-- (recorded, not yet enforced) until a second, distinct admin approves it
-- via moderation_action_approvals below; every other action type goes
-- straight to active.
ALTER TABLE moderation_actions
  ADD COLUMN status TEXT NOT NULL DEFAULT 'active';

ALTER TABLE moderation_actions
  ADD CONSTRAINT chk_moderation_action_status CHECK (status IN ('pending_approval', 'active', 'reversed'));

-- One row per admin who has approved a pending ban. The unique
-- constraint on (moderation_action_id, admin_id) is what makes "the same
-- admin approving twice" structurally impossible, not just service-layer
-- logic — the row count of distinct admin_ids (including the original
-- actor, tracked via moderation_actions.admin_id itself) is what the
-- service checks to decide when 2 has been reached.
CREATE TABLE moderation_action_approvals (
  id UUID PRIMARY KEY DEFAULT public.uuidv7(),
  moderation_action_id UUID NOT NULL REFERENCES moderation_actions(id) ON DELETE CASCADE,
  admin_id UUID NOT NULL,
  rationale TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_moderation_action_approval UNIQUE (moderation_action_id, admin_id)
);

-- §10.10.3: "Appeal (all levels) -> SLA 72h, human review", "Appeals are
-- reviewed by a different admin than the one who acted." The
-- different-reviewer rule is a cross-row comparison (this row's
-- reviewer_admin_id against moderation_actions.admin_id) that a single-
-- table CHECK can't express, so it's enforced in the service layer
-- (AppealsService.review) — same division of labour as every other
-- request-time invariant in this codebase (e.g. connections' monotonic
-- last_read_seq).
CREATE TABLE appeals (
  id UUID PRIMARY KEY DEFAULT public.uuidv7(),
  moderation_action_id UUID NOT NULL REFERENCES moderation_actions(id),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  reviewer_admin_id UUID,
  decision_rationale TEXT,
  decided_at TIMESTAMPTZ,
  sla_due_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_appeal_status CHECK (status IN ('pending', 'upheld', 'overturned'))
);

CREATE INDEX idx_appeals_queue ON appeals(status, sla_due_at) WHERE status = 'pending';
CREATE INDEX idx_appeals_action ON appeals(moderation_action_id);
