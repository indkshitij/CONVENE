// PRD §18.2: "Chat window — Client only. Fully real-time, virtualised,
// offline-capable." The real-time client build is P19.2/P23.2's scope —
// this phase ships a Server Component placeholder shell.
export default async function ChatWindowPage({
  params,
}: {
  params: Promise<{ conversationId: string }>;
}) {
  const { conversationId } = await params;
  return (
    <div className="flex flex-col gap-[var(--spacing-16)] px-[var(--spacing-24)] py-[var(--spacing-40)]">
      <h1 className="text-[length:var(--text-heading-sm)] font-[family-name:var(--font-aeonik)] text-[color:var(--color-ink)]">
        Conversation
      </h1>
      <p className="text-[length:var(--text-body)] text-[color:var(--color-graphite)]">
        Conversation {conversationId}.
      </p>
    </div>
  );
}
