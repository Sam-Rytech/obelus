/**
 * spike-certik — settle how to read an audit verdict off a Skynet project page.
 *
 * Finding (Sep 22):
 *  - The page is server-rendered and not Cloudflare-blocked; a DIRECT slug fetch works,
 *    so Tavily is only the fallback (saves the 1,000-credit monthly budget).
 *  - __NEXT_DATA__ is obfuscated (pageProps is just `_e`) and holds NO audit data.
 *    Parse the rendered HTML instead.
 *  - "Code Audit History" is a STATIC SECTION HEADING present on every project page,
 *    audited or not — substring-matching it would false-positive on everything.
 *    The discriminator is the "Not Audited By CertiK" badge.
 */
import { getText, save, h, expect, done, UA } from "./_spike";

const BADGE = "Not Audited By CertiK";
const SECTION = "Code Audit History";

type Verdict = "CONTRADICTED" | "VERIFIED" | "UNVERIFIED";

/** The parse rule from §10.2, implemented once here so the spike tests the real thing. */
function readVerdict(status: number, html: string): Verdict {
  if (status === 404) return "UNVERIFIED"; // no such project page
  if (status !== 200) return "UNVERIFIED"; // fail closed (§18)
  if (html.includes(BADGE)) return "CONTRADICTED"; // page positively says not audited
  if (html.includes(SECTION)) return "VERIFIED";
  return "UNVERIFIED";
}

/** Unlike getText, we need the status code itself — 404 is a meaningful answer here. */
async function fetchPage(url: string): Promise<{ status: number; html: string }> {
  const res = await fetch(url, {
    headers: { "user-agent": UA },
    signal: AbortSignal.timeout(30_000),
  });
  return { status: res.status, html: await res.text() };
}

/** Cases chosen so the spike covers all three verdicts, not just the happy path. */
const CASES: { slug: string; expected: Verdict; why: string }[] = [
  { slug: "pancakeswap", expected: "VERIFIED", why: "genuinely CertiK-audited" },
  { slug: "polygon", expected: "VERIFIED", why: "genuinely CertiK-audited" },
  { slug: "uniswap", expected: "CONTRADICTED", why: "not CertiK-audited — badge present" },
  { slug: "aerodrome-finance", expected: "CONTRADICTED", why: "not CertiK-audited — badge present" },
  { slug: "zzzz-nonexistent-project-xyz", expected: "UNVERIFIED", why: "no such project — HTTP 404" },
];

async function main() {
  h("Skynet project pages — badge vs section heading");

  const summary: Record<string, unknown>[] = [];

  for (const c of CASES) {
    const url = `https://skynet.certik.com/projects/${c.slug}`;
    const { status, html } = await fetchPage(url);
    const badge = html.includes(BADGE);
    const section = html.includes(SECTION);
    const verdict = readVerdict(status, html);

    summary.push({ slug: c.slug, status, bytes: html.length, badge, section, verdict, expected: c.expected });

    console.log(
      `  ${c.slug.padEnd(28)} HTTP ${status}  ${String(Math.round(html.length / 1024)).padStart(4)}KB` +
        `  badge:${String(badge).padEnd(5)} section:${String(section).padEnd(5)} -> ${verdict}`,
    );
    expect(`${c.slug} -> ${c.expected}`, verdict === c.expected, c.why);
  }

  expect(
    "an unknown project returns HTTP 404, so a miss needs no HTML parsing at all",
    summary.find((s) => s.slug === "zzzz-nonexistent-project-xyz")?.status === 404,
  );

  save("certik-pages", summary);

  h("Why substring-matching the section heading would have been wrong");
  const bothMarkers = summary.filter((s) => s.badge === true && s.section === true);
  expect(
    '"Code Audit History" appears on UNAUDITED pages too',
    bothMarkers.length > 0,
    `${bothMarkers.length} pages carry both strings — the badge is the only discriminator`,
  );

  h("__NEXT_DATA__ holds no audit data");
  const html = await getText("https://skynet.certik.com/projects/uniswap");
  const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  const nextData = m?.[1] ?? "";
  console.log(`  __NEXT_DATA__ bytes: ${nextData.length}`);
  expect("__NEXT_DATA__ does not contain the badge text", !nextData.includes(BADGE), "so parse the HTML, not the JSON");

  done(
    "CertiK",
    "Works by direct slug — Tavily not needed",
    `Server-rendered, no CF block. **Discriminator is the "${BADGE}" badge**, NOT "${SECTION}" (a static heading on every page). badge -> CONTRADICTED; no badge + section -> VERIFIED; neither -> UNVERIFIED. Verified on ${CASES.length} slugs covering all 3 verdicts. __NEXT_DATA__ is obfuscated and useless.`,
  );
}

main().catch((e) => {
  console.error("spike-certik failed:", e);
  process.exit(1);
});
