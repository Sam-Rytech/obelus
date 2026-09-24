import Link from "next/link";

import { Obelus } from "./Sign";

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="wrap footer-grid">
        <div className="footer-about">
          <Link href="/" className="wordmark">
            <Obelus />
            Obelus
          </Link>
          <p>
            Scholars at the Library of Alexandria marked lines that didn&rsquo;t hold up with an obelus. Obelus does the
            same for crypto announcements.
          </p>
        </div>
        <nav aria-label="Product" className="footer-links">
          <Link href="/check">Check an announcement</Link>
          <Link href="/examples">Examples</Link>
          <Link href="/how-it-works">How it works</Link>
          <Link href="/status">Source status</Link>
        </nav>
        <nav aria-label="Build with Obelus" className="footer-links">
          <Link href="/developers">API</Link>
          <a href="https://t.me/Obelus_the_Bot" target="_blank" rel="noreferrer">
            Telegram bot
          </a>
          <a href="https://github.com/Sam-Rytech/obelus" target="_blank" rel="noreferrer">
            Source code
          </a>
        </nav>
      </div>
    </footer>
  );
}
