import Link from "next/link";
import { AuthCardHeading } from "@/components/shared/auth-card-heading";
import { SignupForm } from "./signup-form";

export default function SignupPage() {
  return (
    <div className="flex flex-col gap-[var(--spacing-24)]">
      <AuthCardHeading
        title="Create your account"
        subtitle="Join Convene to start matching in real time."
      />
      <SignupForm />
      <p className="text-center text-[length:var(--text-body-sm)] text-[color:var(--color-graphite)]">
        Already have an account?{" "}
        <Link className="text-[color:var(--color-iris-blue)] underline" href="/login">
          Log in
        </Link>
      </p>
    </div>
  );
}
