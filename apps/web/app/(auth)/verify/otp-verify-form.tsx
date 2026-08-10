"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { OtpInput } from "@/components/auth/otp-input";
import { useOnlineStatus } from "@/lib/realtime/use-online-status";

// §13.2: "5 wrong attempts -> 429, 15 min lockout." A documented PRD
// constant (not a fabricated number, unlike the onboarding match
// counter in P20.3) — the server is still the sole authority on the
// actual lockout; this only drives the "N tries remaining" display.
const MAX_ATTEMPTS = 5;
const FAILURES_BEFORE_ALTERNATE_CHANNEL = 2;

function maskIdentifier(identifier: string): string {
  if (identifier.includes("@")) {
    const [name, domain] = identifier.split("@");
    if (!name || !domain) return identifier;
    return `${name.slice(0, 1)}${"•".repeat(Math.max(name.length - 1, 1))}@${domain}`;
  }
  return identifier.length > 4
    ? `${"•".repeat(identifier.length - 4)}${identifier.slice(-4)}`
    : identifier;
}

export function OtpVerifyForm({ identifier }: { identifier: string }) {
  const router = useRouter();
  const isOnline = useOnlineStatus();
  const [otp, setOtp] = useState("");
  const [status, setStatus] = useState<"idle" | "verifying" | "success">("idle");
  const [failures, setFailures] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const [resendSeconds, setResendSeconds] = useState(0);
  const submittingRef = useRef(false);

  useEffect(() => {
    if (resendSeconds <= 0) return;
    const timer = setTimeout(() => setResendSeconds((seconds) => seconds - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendSeconds]);

  async function verify(code: string) {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setStatus("verifying");
    setErrorMessage(null);

    try {
      const response = await fetch("/api/auth/otp/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier, otp: code }),
      });
      if (!response.ok) {
        const body = (await response.json()) as { error: { code: string } };
        setOtp("");
        if (body.error.code === "OTP_EXPIRED") {
          setExpired(true);
          setErrorMessage("This code expired.");
        } else if (
          body.error.code === "OTP_MAX_ATTEMPTS" ||
          body.error.code === "OTP_RATE_LIMITED"
        ) {
          setErrorMessage("Too many attempts. Try again later.");
        } else {
          setFailures((count) => count + 1);
          const remaining = Math.max(MAX_ATTEMPTS - (failures + 1), 0);
          setErrorMessage(
            `Incorrect code. ${remaining} ${remaining === 1 ? "try" : "tries"} remaining.`,
          );
        }
        setStatus("idle");
        return;
      }

      // design.md §14.5: "success (green tick then auto-advance, 400ms)."
      setStatus("success");
      setTimeout(() => router.push("/home"), 400);
    } catch {
      setErrorMessage("Something went wrong. Please try again.");
      setStatus("idle");
    } finally {
      submittingRef.current = false;
    }
  }

  async function resend() {
    setExpired(false);
    setErrorMessage(null);
    setOtp("");
    try {
      const response = await fetch("/api/auth/otp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier }),
      });
      const body = (await response.json()) as { resend_available_in?: number };
      setResendSeconds(body.resend_available_in ?? 60);
    } catch {
      setErrorMessage("Couldn't resend the code. Please try again.");
    }
  }

  function handleOtpChange(value: string) {
    setOtp(value);
    if (value.length === 6) void verify(value);
  }

  return (
    <div className="flex flex-col gap-[var(--spacing-24)]">
      <p className="text-[length:var(--text-body)] text-[color:var(--color-graphite)]">
        We sent a code to {maskIdentifier(identifier)}
      </p>

      <OtpInput
        value={otp}
        onChange={handleOtpChange}
        disabled={status === "verifying" || status === "success" || !isOnline}
        hasError={!!errorMessage}
        autoFocus
      />

      {status === "success" && (
        <p
          role="status"
          className="text-[length:var(--text-body-sm)] text-[color:var(--color-ink)]"
        >
          ✓ Verified
        </p>
      )}
      {errorMessage && (
        <p
          role="alert"
          className="text-[length:var(--text-body-sm)] text-[color:var(--color-danger-text)]"
        >
          {expired ? "This code expired — request a new one below." : errorMessage}
        </p>
      )}
      {!isOnline && (
        <p
          role="status"
          className="text-[length:var(--text-body-sm)] text-[color:var(--color-graphite)]"
        >
          You&apos;re offline — check your connection to verify.
        </p>
      )}

      <div className="flex items-center justify-between text-[length:var(--text-body-sm)]">
        <button
          type="button"
          onClick={() => void resend()}
          disabled={resendSeconds > 0 || !isOnline}
          className="min-h-11 text-[color:var(--color-iris-blue)] underline disabled:text-[color:var(--color-fog)]"
        >
          {resendSeconds > 0
            ? `Resend code in ${Math.floor(resendSeconds / 60)}:${String(resendSeconds % 60).padStart(2, "0")}`
            : "Resend code"}
        </button>
        <Link href="/signup" className="min-h-11 content-center text-[color:var(--color-graphite)]">
          Change number
        </Link>
      </div>

      {failures >= FAILURES_BEFORE_ALTERNATE_CHANNEL && (
        <Link
          href={`/verify?identifier=${encodeURIComponent(identifier)}&channel=email`}
          className="text-center text-[length:var(--text-body-sm)] text-[color:var(--color-iris-blue)] underline"
        >
          Get the code by email instead
        </Link>
      )}
    </div>
  );
}
