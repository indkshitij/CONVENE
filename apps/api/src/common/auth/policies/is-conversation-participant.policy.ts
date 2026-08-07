// PRD §10.7: only the two participants in a conversation may read/write
// to it.
export function isConversationParticipant(
  participantIds: readonly string[],
  userId: string,
): boolean {
  return participantIds.includes(userId);
}
