"use client";

import Link from "next/link";

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="wrap narrow empty-page">
      <h1 className="page-title">This page didn&rsquo;t load</h1>
      <p className="page-sub">
        Usually the report store was slow to answer. Reports are never lost, so trying again normally works.
      </p>
      <p className="page-actions">
        <button type="button" className="button" onClick={reset}>
          Try again
        </button>
        <Link href="/" className="button button-quiet">
          Go to the home page
        </Link>
      </p>
    </div>
  );
}
