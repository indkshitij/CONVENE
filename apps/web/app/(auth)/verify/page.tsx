import { AuthCardHeading } from "@/components/shared/auth-card-heading";
import { OtpVerifyForm } from "./otp-verify-form";

export default async function VerifyPage({
  searchParams,
}: {
  searchParams: Promise<{ identifier?: string }>;
}) {
  const { identifier } = await searchParams;

  if (!identifier) {
    return (
      <AuthCardHeading
        title="Verification link expired"
        subtitle="Please sign up again to receive a new code."
      />
    );
  }

  return (
    <div className="flex flex-col gap-[var(--spacing-24)]">
      <AuthCardHeading title="Verify your account" subtitle="Enter the code we sent you." />
      <OtpVerifyForm identifier={identifier} />
    </div>
  );
}
