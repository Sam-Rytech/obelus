"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { Obelus } from "./Sign";

const NAV = [
  { href: "/examples", label: "Examples" },
  { href: "/how-it-works", label: "How it works" },
  { href: "/developers", label: "Developers" },
];

export function SiteHeader() {
  const path = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => setOpen(false), [path]);

  return (
    <header className="site-header">
      <div className="wrap site-bar">
        <Link href="/" className="wordmark" aria-label="Obelus home">
          <Obelus />
          Obelus
        </Link>

        <button
          type="button"
          className="menu-toggle"
          aria-expanded={open}
          aria-controls="site-nav"
          onClick={() => setOpen((o) => !o)}
        >
          {open ? "Close" : "Menu"}
        </button>

        <nav id="site-nav" className="site-nav" data-open={open || undefined} aria-label="Main">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} aria-current={path.startsWith(n.href) ? "page" : undefined}>
              {n.label}
            </Link>
          ))}
          <Link href="/check" className="button button-small" aria-current={path === "/check" ? "page" : undefined}>
            Check an announcement
          </Link>
        </nav>
      </div>
    </header>
  );
}
