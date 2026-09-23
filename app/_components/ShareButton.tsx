"use client";

import { useState } from "react";

/** Uses the native share sheet on phones (judges may open this on one), else copies. */
export function ShareButton({ title }: { title: string }) {
  const [copied, setCopied] = useState(false);

  async function share() {
    const url = window.location.href.replace(/\/verify$/, "");
    if (navigator.share) {
      try {
        await navigator.share({ title, url });
        return;
      } catch {
        /* dismissed — fall through to copying */
      }
    }
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <button type="button" className="linkish" onClick={share}>
      {copied ? "Link copied" : "Share this report"}
    </button>
  );
}
