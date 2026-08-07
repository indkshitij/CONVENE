// PRD §10.6/§10.10: a blocked relationship (in either direction) hides
// both parties from each other regardless of any other permission.
export function isNotBlocked(blockedUserIds: readonly string[], targetUserId: string): boolean {
  return !blockedUserIds.includes(targetUserId);
}
