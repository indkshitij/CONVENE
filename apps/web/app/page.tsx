import { Button, Chip, FeatureCard, SectionHeader } from "@convene/ui";

const features = [
  {
    variant: "feature",
    title: "Declare an intent",
    description: "Cofounder search, mentorship, a quick technical chat — say what you're here for.",
  },
  {
    variant: "pastel-mint",
    title: "Go available",
    description: "A time-boxed window signals you're open to matching right now.",
  },
  {
    variant: "pastel-powder",
    title: "Connect and converse",
    description: "Explained matches, an inbound request, then a real conversation.",
  },
] as const;

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center px-[var(--spacing-24)] py-[var(--spacing-80)]">
      <div className="mx-auto flex w-full max-w-(--page-max-width) flex-col items-center gap-[var(--spacing-40)]">
        <Chip tint="lavender">Real-time · intent-based</Chip>

        <SectionHeader
          size="display"
          title="Networking, in real time"
          subtitle="Convene matches professionals by what they want to do right now, not just who they used to work with."
        />

        <Button href="/discover">Get started</Button>

        <div className="mt-[var(--spacing-56)] grid w-full grid-cols-1 gap-[var(--element-gap)] sm:grid-cols-3">
          {features.map((feature) => (
            <FeatureCard key={feature.title} {...feature} />
          ))}
        </div>
      </div>
    </main>
  );
}
