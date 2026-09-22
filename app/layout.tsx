import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Obelus — fact-checker for crypto announcements",
  description:
    "Paste an announcement. Obelus checks every claim against the only source that can confirm it, and stamps it VERIFIED, CONTRADICTED or UNVERIFIED.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
