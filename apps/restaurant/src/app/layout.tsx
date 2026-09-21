import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/**
 * CP10: the description still said "scaffold placeholder (CP0)" and every
 * route shared one title, so "Tonight — Inbound", the pass and the menu
 * admin were indistinguishable in a tab strip, in history and to a screen
 * reader's page-title announcement (WCAG 2.4.2). `template` lets each page
 * name itself; `default` covers routes that don't.
 */
export const metadata: Metadata = {
  title: { template: "%s — RAISE", default: "RAISE for restaurants" },
  description: "Tonight's bookings, the pass, and your menu.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
