/**
 * spike-ccxt — OPEN QUESTION: which CCXT exchanges expose per-network contract
 * addresses, i.e. which can reach an unqualified VERIFIED the way WEEX can?
 *
 * Any exchange that does NOT expose addresses is limited to the
 * "Ticker listed — contract unconfirmed" branch of §10.1, exactly like BingX.
 */
import * as ccxt from "ccxt";
import { save, h, done } from "./_spike";

const EXCHANGES = ["binance", "bybit", "okx", "gate", "mexc", "kucoin", "bitget"] as const;

/** A currency's per-network info is not uniformly shaped across CCXT adapters,
 *  so look for an 0x address anywhere in the network entry. */
function findAddress(networks: unknown): string | null {
  const json = JSON.stringify(networks ?? {});
  return json.match(/0x[0-9a-fA-F]{40}/)?.[0] ?? null;
}

/**
 * Obelus only does on-chain checks on Base (§4), so "exposes a contract address"
 * is not the useful measure — "exposes a BASE contract address" is. Exchanges key
 * networks inconsistently (BASE, Base, BASEEVM, ...), so match the key loosely while
 * refusing near-misses like "BASEDAI".
 */
function findBaseAddress(networks: unknown): string | null {
  if (!networks || typeof networks !== "object") return null;
  for (const [key, value] of Object.entries(networks as Record<string, unknown>)) {
    if (!/^base(evm|chain|mainnet)?$/i.test(key.trim())) continue;
    const addr = findAddress(value);
    if (addr) return addr;
  }
  return null;
}

async function main() {
  const results: Record<string, unknown>[] = [];

  for (const id of EXCHANGES) {
    h(id);
    try {
      const ExchangeClass = (ccxt as unknown as Record<string, new (c: object) => ccxt.Exchange>)[id];
      if (!ExchangeClass) {
        console.log("  not available in this ccxt build");
        continue;
      }
      const ex = new ExchangeClass({ enableRateLimit: true, timeout: 20_000 });

      const markets = (await ex.loadMarkets()) as Record<string, { active?: boolean } | undefined>;
      const marketCount = Object.keys(markets).length;
      const active = Object.values(markets).filter((m) => m?.active).length;

      let currencyCount = 0;
      let withAddress = 0;
      let withBaseAddress = 0;
      let sample: { coin: string; address: string } | null = null;
      let baseSample: { coin: string; address: string } | null = null;
      const networkKeys = new Set<string>();

      try {
        const currencies = await ex.fetchCurrencies();
        const entries = Object.entries(currencies ?? {});
        currencyCount = entries.length;
        for (const [code, cur] of entries) {
          const networks = (cur as { networks?: unknown })?.networks;
          if (networks && typeof networks === "object") {
            for (const k of Object.keys(networks)) if (/base/i.test(k)) networkKeys.add(k);
          }
          const addr = findAddress(networks);
          if (addr) {
            withAddress++;
            sample ??= { coin: code, address: addr };
          }
          const baseAddr = findBaseAddress(networks);
          if (baseAddr) {
            withBaseAddress++;
            baseSample ??= { coin: code, address: baseAddr };
          }
        }
      } catch (e) {
        console.log(`  fetchCurrencies unavailable: ${String(e).slice(0, 70)}`);
      }

      // Only a BASE address can confirm token identity for an Obelus check.
      const verdict = withBaseAddress > 0 ? "CAN confirm contract on Base" : "ticker-only (qualified VERIFIED)";
      console.log(`  markets: ${marketCount} (${active} active)`);
      console.log(`  currencies: ${currencyCount}, with any contract address: ${withAddress}, with a BASE one: ${withBaseAddress}`);
      if (sample) console.log(`  any-network sample: ${sample.coin} -> ${sample.address}`);
      if (baseSample) console.log(`  BASE sample       : ${baseSample.coin} -> ${baseSample.address}`);
      if (networkKeys.size) console.log(`  base-ish network keys seen: ${[...networkKeys].slice(0, 6).join(", ")}`);
      console.log(`  => ${verdict}`);

      results.push({ id, marketCount, active, currencyCount, withAddress, withBaseAddress, sample, baseSample, verdict });
    } catch (e) {
      console.log(`  FAILED: ${String(e).slice(0, 120)}`);
      results.push({ id, error: String(e).slice(0, 200) });
    }
  }

  save("ccxt", results);

  const capable = results.filter((r) => (r.withBaseAddress as number) > 0);
  const anyChainOnly = results.filter(
    (r) => (r.withBaseAddress as number) === 0 && (r.withAddress as number) > 0,
  );
  const tickerOnly = results.filter((r) => r.withAddress === 0);

  h("Summary");
  console.log(`  can confirm on Base    : ${capable.map((r) => `${r.id} (${r.withBaseAddress})`).join(", ") || "none"}`);
  console.log(`  addresses but not Base : ${anyChainOnly.map((r) => r.id).join(", ") || "none"}`);
  console.log(`  ticker-only            : ${tickerOnly.map((r) => r.id).join(", ") || "none"}`);

  done(
    "CCXT",
    `${capable.length}/${EXCHANGES.length} can confirm a Base contract`,
    `Confirm on Base: ${capable.map((r) => `${r.id} (${r.withBaseAddress} coins)`).join(", ") || "none"}. Ticker-only, so qualified VERIFIED like BingX: ${[...anyChainOnly, ...tickerOnly].map((r) => r.id).join(", ") || "none"}. Note: many coins expose a contract on some OTHER chain — matching those would compare a Base token against e.g. a BSC address, so only BASE-keyed networks may enter a verdict.`,
  );
}

main().catch((e) => {
  console.error("spike-ccxt failed:", e);
  process.exit(1);
});
