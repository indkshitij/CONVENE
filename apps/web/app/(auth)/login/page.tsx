import Link from "next/link";
import { Suspense } from "react";
import { AuthCardHeading } from "@/components/shared/auth-card-heading";
import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <div className="flex flex-col gap-[var(--spacing-24)]">
      <AuthCardHeading title="Log in" subtitle="Welcome back to Convene." />
      {/* LoginForm reads useSearchParams() (the post-login redirect
          destination) — Next requires a Suspense boundary around any
          client component that does, so a static shell can still be
          prerendered around it. */}
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
      <p className="text-center text-[length:var(--text-body-sm)] text-[color:var(--color-graphite)]">
        Don&apos;t have an account?{" "}
        <Link className="text-[color:var(--color-iris-blue)] underline" href="/signup">
          Sign up
        </Link>
      </p>
    </div>
  );
}
