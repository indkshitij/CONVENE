import type { Metadata } from "next";
import { Geist, Inter } from "next/font/google";
import { ToastViewport } from "@/components/shared/toast-viewport";
import "./globals.css";

// Loaded into their own variables (not --font-geist/--font-aeonik directly,
// which packages/tokens already defines as portable font-stacks) — globals.css
// layers these on top of the token so the token stays meaningful outside Next too.
const geist = Geist({
  variable: "--font-geist-loaded",
  subsets: ["latin"],
});

// Aeonik (display/heading face) is not a freely licensed webfont; Inter is
// MAIN_DESIGN.md's own documented substitute.
const aeonik = Inter({
  variable: "--font-aeonik-loaded",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Convene",
  description: "Real-time intent-based professional networking.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${geist.variable} ${aeonik.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        {children}
        <ToastViewport />
      </body>
    </html>
  );
}
