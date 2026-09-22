export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-6 px-6 py-16">
      <div className="flex items-baseline gap-3">
        <span aria-hidden className="text-4xl font-semibold">
          ÷
        </span>
        <h1 className="text-3xl font-semibold tracking-tight">Obelus</h1>
      </div>

      <p className="text-lg text-balance opacity-80">
        Paste a crypto announcement. We&rsquo;ll check every claim.
      </p>

      <p className="text-sm opacity-60">
        For 2,000 years, scholars marked false lines with an obelus. Now an agent
        does it for crypto announcements.
      </p>

      <p className="rounded-lg border border-current/15 px-4 py-3 text-sm opacity-60">
        Scaffold only — the checker pipeline lands on Day 2. See{" "}
        <code className="font-mono">architecture.md</code>.
      </p>
    </main>
  );
}
