/**
 * Verify every domain in the auditor and partner registries — architecture §9.
 *
 * "Visit each domain before adding" is not bureaucracy: the partnership check (§10.5)
 * treats a page on a partner-controlled domain as proof. A typo'd, parked or
 * hijacked domain would therefore turn into a VERIFIED partnership. Nothing is
 * admitted to a registry on the strength of memory.
 *
 *   pnpm spike scripts/verify-domains.ts
 *
 * Prints a row per domain and exits non-zero if any registered domain is unreachable.
 */
import { auditors, partners } from "../src/registry/index";
import { save, h, UA } from "./_spike";

type Row = { owner: string; domain: string; status: number | string; finalHost: string; ok: boolean };

async function check(domain: string): Promise<{ status: number | string; finalHost: string; ok: boolean }> {
  const url = `https://${domain.replace(/^https?:\/\//, "").split("/")[0]}/`;
  try {
    const res = await fetch(url, {
      redirect: "follow",
      headers: { "user-agent": UA, accept: "text/html,*/*" },
      signal: AbortSignal.timeout(20_000),
    });
    const finalHost = new URL(res.url || url).hostname;
    // 403/429 still proves the domain exists and is served — enough for registry use.
    return { status: res.status, finalHost, ok: res.status < 500 };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { status: /aborted|timeout/i.test(msg) ? "TIMEOUT" : "UNREACHABLE", finalHost: "-", ok: false };
  }
}

async function main() {
  const rows: Row[] = [];

  for (const [label, entries] of [
    ["AUDITORS", auditors],
    ["PARTNERS", partners],
  ] as const) {
    h(label);
    if (entries.length === 0) {
      console.log("  (none registered)");
      continue;
    }
    for (const entry of entries) {
      for (const domain of entry.domains) {
        const res = await check(domain);
        rows.push({ owner: entry.id, domain, ...res });
        console.log(
          `  ${res.ok ? "ok  " : "FAIL"} ${entry.id.padEnd(16)} ${domain.padEnd(28)} ` +
            `HTTP ${String(res.status).padEnd(11)} -> ${res.finalHost}`,
        );
      }
    }
  }

  save("domains", rows);

  const failed = rows.filter((r) => !r.ok);
  h("Summary");
  console.log(`  ${rows.length - failed.length}/${rows.length} domains reachable`);
  if (failed.length) {
    console.log(`  unreachable: ${failed.map((f) => f.domain).join(", ")}`);
    console.log(`  NOTE: some exchange/partner domains are DNS-blocked from this network.`);
    console.log(`  Re-run from the deployment before trusting a failure here.`);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error("verify-domains failed:", e);
  process.exit(1);
});
