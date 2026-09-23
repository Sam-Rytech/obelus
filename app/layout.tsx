import type { Metadata, Viewport } from "next";
import { Alegreya, Alegreya_SC, IBM_Plex_Mono } from "next/font/google";
import Link from "next/link";

import { Obelus } from "./_components/Sign";
import "./globals.css";

const alegreya = Alegreya({
  subsets: ["latin"],
  weight: ["400", "700"],
  style: ["normal", "italic"],
  variable: "--font-alegreya",
  display: "swap",
});

// True small caps for the verdict stamps — not tracked-out capitals.
const alegreyaSC = Alegreya_SC({
  subsets: ["latin"],
  weight: ["700"],
  variable: "--font-alegreya-sc",
  display: "swap",
});

// Only for addresses, hashes and raw source excerpts.
const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400"],
  variable: "--font-plex-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Obelus — fact-checker for crypto announcements",
    template: "%s — Obelus",
  },
  description:
    "Paste a crypto announcement. Obelus checks each claim against the only source that can confirm it, and marks it verified, contradicted or unverified — with the proof.",
  metadataBase: new URL(process.env.PUBLIC_BASE_URL || "http://localhost:3000"),
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#edebe3" },
    { media: "(prefers-color-scheme: dark)", color: "#1d2025" },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${alegreya.variable} ${alegreyaSC.variable} ${plexMono.variable}`}>
      <body>
        <div className="page">
          <header className="masthead">
            <Link href="/" className="wordmark" aria-label="Obelus home">
              Obelus
              <Obelus />
            </Link>
            <nav aria-label="Main">
              <Link href="/method">How it checks</Link>
            </nav>
          </header>
          <main>{children}</main>
          <footer className="footer">
            Scholars at the Library of Alexandria marked lines that didn&rsquo;t hold up with an obelus.
            Obelus does the same for crypto announcements, and shows the source for every mark.
          </footer>
        </div>
      </body>
    </html>
  );
}
